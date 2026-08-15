import {
  addDaysToDate,
  evaluateReminderCandidate,
  isValidEmail,
  PAYMENT_REMINDER_OFFSETS,
  type ReminderCandidate,
  type ReminderOffset,
} from './reminder_logic.ts'
import {
  executeReminderDelivery,
  ReminderReconciliationRequiredError,
  type ClaimReminderResponse,
  type FinalizeReminderResponse,
  type ReminderDeliveryDependencies,
} from './reminder_delivery.ts'
import {
  createMailjetAdapter,
  readMailjetConfig,
  type FetchLike,
} from './mailjet_adapter.ts'
import { renderPaymentReminder } from './reminder_template.ts'

export const CONTROLLED_E2E_MEMBERSHIP_ID =
  '00000000-0000-4000-8000-000000000036'
export const CONTROLLED_E2E_EVALUATION_DATE = '2036-01-01'
export const PRODUCTION_SEND_BLOCKED_MESSAGE =
  'RAN-36 B2 no habilita envíos productivos.'

const CONTROLLED_E2E_STUDENT_NAME = 'Fixture E2E'
const CONTROLLED_E2E_STUDENT_ID =
  '00000000-0000-4000-8000-000000000136'
const DESTINATION_SECRET = 'PAYMENT_REMINDER_E2E_EMAIL'
const ALLOWED_TOP_LEVEL_FIELDS = new Set(['dryRun', 'mode', 'fixture'])
const ALLOWED_FIXTURE_FIELDS = new Set(['offset_days'])
const ALLOWED_SCHEDULED_FIELDS = new Set(['dryRun', 'mode'])

export type ControlledE2EPayload = {
  dryRun: false
  mode: 'controlled_e2e'
  fixture: {
    offset_days: ReminderOffset
  }
}

export type ScheduledPreviewPayload = {
  dryRun: true
  mode: 'scheduled_preview'
}

export type ScheduledProductionPayload = {
  dryRun: false
  mode: 'scheduled_production'
}

export type PaymentReminderMode =
  | { kind: 'dry_run' }
  | { kind: 'controlled_e2e'; value: ControlledE2EPayload }
  | { kind: 'scheduled_preview'; value: ScheduledPreviewPayload }
  | { kind: 'scheduled_production'; value: ScheduledProductionPayload }

export class PaymentReminderRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'PaymentReminderRequestError'
    this.status = status
  }
}

export function getReminderReconciliationRequiredResponse(error: unknown) {
  if (!(error instanceof ReminderReconciliationRequiredError)) {
    return null
  }

  return {
    error: 'reconciliation_required' as const,
    reconciliation_required: true as const,
    log_id: error.log_id,
    desired_status: error.desired_status,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  safeMessage?: string,
) {
  const unknownFields = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknownFields.length > 0) {
    throw new PaymentReminderRequestError(
      safeMessage ??
        `Campos no permitidos: ${unknownFields.sort().join(', ')}.`,
      400,
    )
  }
}

export function classifyPaymentReminderRequest(
  payload: unknown,
): PaymentReminderMode {
  if (!isRecord(payload)) {
    throw new PaymentReminderRequestError('Payload invalido.', 400)
  }

  if (payload.mode === 'scheduled_preview') {
    rejectUnknownFields(
      payload,
      ALLOWED_SCHEDULED_FIELDS,
      'scheduled_request_invalid',
    )
    if (payload.dryRun !== true) {
      throw new PaymentReminderRequestError(
        'scheduled_preview requiere dryRun=true.',
        400,
      )
    }
    return {
      kind: 'scheduled_preview',
      value: { dryRun: true, mode: 'scheduled_preview' },
    }
  }

  if (payload.mode === 'scheduled_production') {
    rejectUnknownFields(
      payload,
      ALLOWED_SCHEDULED_FIELDS,
      'scheduled_request_invalid',
    )
    if (payload.dryRun !== false) {
      throw new PaymentReminderRequestError(
        'scheduled_production requiere dryRun=false.',
        400,
      )
    }
    return {
      kind: 'scheduled_production',
      value: { dryRun: false, mode: 'scheduled_production' },
    }
  }

  if (payload.dryRun === true) {
    if (payload.mode !== undefined) {
      throw new PaymentReminderRequestError('admin_request_invalid', 400)
    }
    return { kind: 'dry_run' }
  }

  if (payload.dryRun !== false) {
    throw new PaymentReminderRequestError('dryRun debe ser boolean.', 400)
  }

  if (payload.mode !== 'controlled_e2e') {
    throw new PaymentReminderRequestError(
      PRODUCTION_SEND_BLOCKED_MESSAGE,
      409,
    )
  }

  rejectUnknownFields(payload, ALLOWED_TOP_LEVEL_FIELDS)

  if (!isRecord(payload.fixture)) {
    throw new PaymentReminderRequestError(
      'fixture debe incluir offset_days.',
      400,
    )
  }
  rejectUnknownFields(payload.fixture, ALLOWED_FIXTURE_FIELDS)

  const offsetDays = payload.fixture.offset_days
  if (
    typeof offsetDays !== 'number' ||
    !PAYMENT_REMINDER_OFFSETS.some((offset) => offset === offsetDays)
  ) {
    throw new PaymentReminderRequestError(
      'fixture.offset_days debe ser 5, 3, 1 o 0.',
      400,
    )
  }

  return {
    kind: 'controlled_e2e',
    value: {
      dryRun: false,
      mode: 'controlled_e2e',
      fixture: { offset_days: offsetDays as ReminderOffset },
    },
  }
}

export type ControlledE2EDependencies = ReminderDeliveryDependencies & {
  getEnv: (name: string) => string | undefined
}

export async function executeControlledE2E(
  payload: unknown,
  dependencies: ControlledE2EDependencies,
) {
  const mode = classifyPaymentReminderRequest(payload)
  if (mode.kind !== 'controlled_e2e') {
    throw new PaymentReminderRequestError(
      'El request no corresponde a controlled_e2e.',
      400,
    )
  }

  const recipientEmail = dependencies.getEnv(DESTINATION_SECRET)
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    throw new Error(`Falta o es invalido el secret ${DESTINATION_SECRET}.`)
  }

  const evaluationDate = CONTROLLED_E2E_EVALUATION_DATE
  const offsetDays = mode.value.fixture.offset_days
  const dueDate = addDaysToDate(evaluationDate, offsetDays)
  const candidate: ReminderCandidate = {
    membership_id: CONTROLLED_E2E_MEMBERSHIP_ID,
    student_id: CONTROLLED_E2E_STUDENT_ID,
    student_first_name: 'Fixture',
    student_last_name: 'E2E',
    email: recipientEmail,
    student_active: true,
    receives_payment_reminders: true,
    receives_emails: false,
    membership_status: 'active',
    start_date: evaluationDate,
    end_date: dueDate,
  }
  const evaluation = evaluateReminderCandidate(candidate, evaluationDate)

  if (
    !evaluation.eligible ||
    evaluation.offset_days !== offsetDays ||
    evaluation.idempotency_key === null
  ) {
    throw new Error('El fixture controlled_e2e no resulto elegible.')
  }

  const rendered = renderPaymentReminder({
    studentName: CONTROLLED_E2E_STUDENT_NAME,
    dueDate,
    offsetDays,
    syntheticE2E: true,
  })

  return executeReminderDelivery(
    {
      claim: {
        student_id: null,
        recipient_email: recipientEmail,
        subject: rendered.subject,
        idempotency_key: evaluation.idempotency_key,
        membership_id: CONTROLLED_E2E_MEMBERSHIP_ID,
        due_date: dueDate,
        offset_days: offsetDays,
        synthetic_e2e: true,
      },
      message: {
        toEmail: recipientEmail,
        toName: CONTROLLED_E2E_STUDENT_NAME,
        subject: rendered.subject,
        textPart: rendered.textPart,
        htmlPart: rendered.htmlPart,
      },
      finalizeMetadata: {
        delivery_mode: 'controlled_e2e',
        evaluation_date: evaluationDate,
      },
    },
    dependencies,
  )
}

type RpcResult = {
  data: unknown
  error: unknown
}

export type ReminderRpcClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResult>
}

function rpcErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === 'string'
        ? error.message
        : ''

  return message.trim().slice(0, 1_000) || 'La RPC de entrega fallo.'
}

function singleRpcRow(data: unknown, operation: string) {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new Error(`La RPC ${operation} devolvio una respuesta invalida.`)
  }
  return data[0]
}

export function createReminderRpcDependencies(
  client: ReminderRpcClient,
  sendMail: ReminderDeliveryDependencies['sendMail'],
): ReminderDeliveryDependencies {
  return {
    async claim(input) {
      const { data, error } = await client.rpc(
        'claim_payment_reminder_delivery',
        {
          p_student_id: input.student_id,
          p_recipient_email: input.recipient_email,
          p_subject: input.subject,
          p_idempotency_key: input.idempotency_key,
          p_membership_id: input.membership_id,
          p_due_date: input.due_date,
          p_offset_days: input.offset_days,
          p_synthetic_e2e: input.synthetic_e2e,
        },
      )
      if (error) {
        throw new Error(rpcErrorMessage(error))
      }
      return singleRpcRow(data, 'claim') as ClaimReminderResponse
    },
    sendMail,
    async finalize(input) {
      const { data, error } = await client.rpc(
        'finalize_payment_reminder_delivery',
        {
          p_log_id: input.log_id,
          p_idempotency_key: input.idempotency_key,
          p_status: input.status,
          p_provider_message_id: input.provider_message_id,
          p_error: input.error,
          p_metadata: input.metadata,
        },
      )
      if (error) {
        throw new Error(rpcErrorMessage(error))
      }
      return singleRpcRow(data, 'finalize') as FinalizeReminderResponse
    },
  }
}

export async function executeControlledE2EFromRuntime(
  payload: unknown,
  runtime: {
    client: ReminderRpcClient
    getEnv: (name: string) => string | undefined
    fetchImpl: FetchLike
  },
) {
  const mailjet = createMailjetAdapter(
    readMailjetConfig(runtime.getEnv),
    runtime.fetchImpl,
  )
  return executeControlledE2E(payload, {
    ...createReminderRpcDependencies(runtime.client, mailjet),
    getEnv: runtime.getEnv,
  })
}
