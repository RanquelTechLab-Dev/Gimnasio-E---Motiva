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
      ok: true
      provider_message_id: string | null
    }
  | {
      ok: false
      error: string
    }

export type FinalizeReminderInput = {
  log_id: string
  idempotency_key: string
  status: 'sent' | 'failed'
  provider_message_id: string | null
  error: string | null
  metadata: Record<string, unknown>
}

export type FinalizeReminderResponse = {
  finalized: boolean
  log_id: string | null
  reason: string
  final_status: 'sent' | 'failed' | null
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

export type ReminderDeliveryResult =
  | SkippedDelivery
  | SentDelivery
  | FailedDelivery

const MAX_ERROR_LENGTH = 1_000

function boundedErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'No se pudo enviar el recordatorio.'

  return message.slice(0, MAX_ERROR_LENGTH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMailResult(result: unknown): ReminderMailResult {
  if (
    isRecord(result) &&
    result.ok === true &&
    (result.provider_message_id === null ||
      typeof result.provider_message_id === 'string')
  ) {
    return {
      ok: true,
      provider_message_id: result.provider_message_id,
    }
  }

  if (
    isRecord(result) &&
    result.ok === false &&
    typeof result.error === 'string' &&
    result.error.trim()
  ) {
    return {
      ok: false,
      error: result.error,
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
  const response = await finalize(input)

  if (!response.finalized) {
    throw new Error(
      `No se pudo finalizar el recordatorio: ${response.reason || 'rejected'}.`,
    )
  }

  if (
    response.log_id !== input.log_id ||
    response.final_status !== input.status
  ) {
    throw new Error('La RPC finalize devolvio una respuesta invalida.')
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
      ok: false,
      error: boundedErrorMessage(error),
    }
  }

  if (mailResult.ok) {
    await finalizeOrThrow(
      {
        log_id: claimResult.log_id,
        idempotency_key: request.claim.idempotency_key,
        status: 'sent',
        provider_message_id: mailResult.provider_message_id,
        error: null,
        metadata: request.finalizeMetadata ?? {},
      },
      dependencies.finalize,
    )

    return {
      state: 'sent',
      log_id: claimResult.log_id,
      attempt: claimResult.attempt,
      provider_message_id: mailResult.provider_message_id,
    }
  }

  const errorMessage = boundedErrorMessage(new Error(mailResult.error))
  await finalizeOrThrow(
    {
      log_id: claimResult.log_id,
      idempotency_key: request.claim.idempotency_key,
      status: 'failed',
      provider_message_id: null,
      error: errorMessage,
      metadata: request.finalizeMetadata ?? {},
    },
    dependencies.finalize,
  )

  return {
    state: 'failed',
    log_id: claimResult.log_id,
    attempt: claimResult.attempt,
    error: errorMessage,
  }
}
