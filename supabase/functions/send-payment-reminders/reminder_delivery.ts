import type { ReminderOffset } from './reminder_logic.ts'

export type ClaimReminderInput = {
  student_id: string | null
  recipient_email: string
  subject: string
  idempotency_key: string
  membership_id: string
  due_date: string
  offset_days: ReminderOffset
  synthetic_e2e: boolean
}

export type ClaimReminderResponse = {
  claimed: boolean
  log_id: string | null
  reason: string
  attempt: number
}

export type ReminderMailMessage = {
  toEmail: string
  toName: string
  subject: string
  textPart: string
  htmlPart: string
}

export type ReminderMailResult =
  | {
      outcome: 'accepted'
      provider_message_id: string | null
    }
  | {
      outcome: 'rejected'
      error: string
    }
  | {
      outcome: 'uncertain'
      error: string
    }

export type ReminderFinalStatus = 'sent' | 'failed' | 'uncertain'

export type ReminderDeliveryCertainty =
  | 'accepted'
  | 'rejected'
  | 'uncertain'

export type FinalizeReminderInput = {
  log_id: string
  idempotency_key: string
  status: ReminderFinalStatus
  provider_message_id: string | null
  error: string | null
  metadata: Record<string, unknown>
}

export type FinalizeReminderResponse = {
  finalized: boolean
  log_id: string | null
  reason: string
  final_status: ReminderFinalStatus | null
}

export type ReminderDeliveryDependencies = {
  claim: (input: ClaimReminderInput) => Promise<ClaimReminderResponse>
  sendMail: (message: ReminderMailMessage) => Promise<ReminderMailResult>
  finalize: (
    input: FinalizeReminderInput,
  ) => Promise<FinalizeReminderResponse>
}

export type ReminderDeliveryRequest = {
  claim: ClaimReminderInput
  message: ReminderMailMessage
  finalizeMetadata?: Record<string, unknown>
}

export type ClaimedDelivery = {
  state: 'claimed'
  log_id: string
  attempt: number
}

export type SkippedDelivery = {
  state: 'skipped'
  log_id: string | null
  reason: string
  attempt: number
}

export type SentDelivery = {
  state: 'sent'
  log_id: string
  attempt: number
  provider_message_id: string | null
}

export type FailedDelivery = {
  state: 'failed'
  log_id: string
  attempt: number
  error: string
}

export type UncertainDelivery = {
  state: 'uncertain'
  log_id: string
  attempt: number
  error: string
}

export type ReminderDeliveryResult =
  | SkippedDelivery
  | SentDelivery
  | FailedDelivery
  | UncertainDelivery

const MAX_ERROR_LENGTH = 1_000
const SENSITIVE_HEADER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(\b(?:authorization|(?:mailjet[_ -]?)?api[_ -]?(?:key|secret)|(?:supabase[_ -]?)?service[_ -]?role(?:[_ -]?key)?|token|password)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi

function boundedErrorMessage(
  error: unknown,
  fallback = 'No se pudo enviar el recordatorio.',
) {
  const candidate =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const message = candidate.trim() || fallback

  return message
    .replace(SENSITIVE_HEADER_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1[REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .slice(0, MAX_ERROR_LENGTH)
}

export class ReminderReconciliationRequiredError extends Error {
  readonly code = 'reconciliation_required' as const
  readonly reconciliation_required = true as const
  readonly log_id: string
  readonly idempotency_key: string
  readonly desired_status: ReminderFinalStatus
  readonly provider_message_id: string | null
  readonly bounded_error: string

  constructor(
    input: FinalizeReminderInput,
    error: unknown,
  ) {
    super('La entrega requiere reconciliacion explicita.')
    this.name = 'ReminderReconciliationRequiredError'
    this.log_id = input.log_id
    this.idempotency_key = input.idempotency_key
    this.desired_status = input.status
    this.provider_message_id = input.provider_message_id
    this.bounded_error = boundedErrorMessage(
      error,
      'No se pudo confirmar la finalizacion de la entrega.',
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMailResult(result: unknown): ReminderMailResult {
  if (
    isRecord(result) &&
    result.outcome === 'accepted' &&
    (result.provider_message_id === null ||
      typeof result.provider_message_id === 'string')
  ) {
    return {
      outcome: 'accepted',
      provider_message_id:
        typeof result.provider_message_id === 'string'
          ? result.provider_message_id.slice(0, MAX_ERROR_LENGTH)
          : null,
    }
  }

  if (
    isRecord(result) &&
    (result.outcome === 'rejected' || result.outcome === 'uncertain') &&
    typeof result.error === 'string' &&
    result.error.trim()
  ) {
    return {
      outcome: result.outcome,
      error: boundedErrorMessage(result.error),
    }
  }

  throw new Error('El adaptador Mailjet devolvio una respuesta invalida.')
}

function assertValidClaimResponse(
  response: ClaimReminderResponse,
): asserts response is ClaimReminderResponse {
  if (
    typeof response.claimed !== 'boolean' ||
    typeof response.reason !== 'string' ||
    !Number.isSafeInteger(response.attempt) ||
    response.attempt < 1 ||
    (response.log_id !== null && typeof response.log_id !== 'string')
  ) {
    throw new Error('La RPC claim devolvio una respuesta invalida.')
  }

  if (response.claimed && response.log_id === null) {
    throw new Error('La RPC claim no devolvio el log reservado.')
  }
}

export async function claimReminderDelivery(
  input: ClaimReminderInput,
  claim: ReminderDeliveryDependencies['claim'],
): Promise<ClaimedDelivery | SkippedDelivery> {
  const response = await claim(input)
  assertValidClaimResponse(response)

  if (!response.claimed) {
    return {
      state: 'skipped',
      log_id: response.log_id,
      reason: response.reason,
      attempt: response.attempt,
    }
  }

  return {
    state: 'claimed',
    log_id: response.log_id as string,
    attempt: response.attempt,
  }
}

async function finalizeOrThrow(
  input: FinalizeReminderInput,
  finalize: ReminderDeliveryDependencies['finalize'],
) {
  try {
    const response = await finalize(input)

    if (!isRecord(response)) {
      throw new Error('La RPC finalize devolvio una respuesta invalida.')
    }

    if (response.finalized !== true) {
      const reason =
        typeof response.reason === 'string' && response.reason.trim()
          ? response.reason.trim()
          : 'rejected'
      throw new Error(`No se pudo finalizar el recordatorio: ${reason}.`)
    }

    if (
      response.log_id !== input.log_id ||
      response.final_status !== input.status
    ) {
      throw new Error('La RPC finalize devolvio una respuesta invalida.')
    }
  } catch (error) {
    if (error instanceof ReminderReconciliationRequiredError) {
      throw error
    }
    throw new ReminderReconciliationRequiredError(input, error)
  }
}

export async function executeReminderDelivery(
  request: ReminderDeliveryRequest,
  dependencies: ReminderDeliveryDependencies,
): Promise<ReminderDeliveryResult> {
  const claimResult = await claimReminderDelivery(
    request.claim,
    dependencies.claim,
  )

  if (claimResult.state === 'skipped') {
    return claimResult
  }

  let mailResult: ReminderMailResult
  try {
    mailResult = normalizeMailResult(
      await dependencies.sendMail(request.message),
    )
  } catch (error) {
    mailResult = {
      outcome: 'uncertain',
      error: boundedErrorMessage(error),
    }
  }

  const finalStatus: ReminderFinalStatus =
    mailResult.outcome === 'accepted'
      ? 'sent'
      : mailResult.outcome === 'rejected'
        ? 'failed'
        : 'uncertain'
  const providerMessageId =
    mailResult.outcome === 'accepted'
      ? mailResult.provider_message_id
      : null
  const errorMessage =
    mailResult.outcome === 'accepted'
      ? null
      : boundedErrorMessage(mailResult.error)

  await finalizeOrThrow(
    {
      log_id: claimResult.log_id,
      idempotency_key: request.claim.idempotency_key,
      status: finalStatus,
      provider_message_id: providerMessageId,
      error: errorMessage,
      metadata: {
        ...(request.finalizeMetadata ?? {}),
        delivery_certainty: mailResult.outcome,
      },
    },
    dependencies.finalize,
  )

  if (mailResult.outcome === 'accepted') {
    return {
      state: 'sent',
      log_id: claimResult.log_id,
      attempt: claimResult.attempt,
      provider_message_id: mailResult.provider_message_id,
    }
  }

  if (mailResult.outcome === 'rejected') {
    return {
      state: 'failed',
      log_id: claimResult.log_id,
      attempt: claimResult.attempt,
      error: errorMessage as string,
    }
  }

  return {
    state: 'uncertain',
    log_id: claimResult.log_id,
    attempt: claimResult.attempt,
    error: errorMessage as string,
  }
}
