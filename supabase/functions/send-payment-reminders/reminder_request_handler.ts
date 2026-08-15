import type {
  ControlledE2EPayload,
  PaymentReminderMode,
} from './controlled_e2e.ts'
import {
  authorizePaymentReminderMode,
  PaymentReminderAuthError,
  type PaymentReminderAuthDependencies,
  type PaymentReminderRequestHeaders,
} from './reminder_auth.ts'

export type PaymentReminderHandlerResponse = {
  status: number
  body: unknown
}

export type PaymentReminderHandlerDependencies = {
  auth: PaymentReminderAuthDependencies
  executeDryRun: () => Promise<PaymentReminderHandlerResponse>
  executeControlledE2E: (
    payload: ControlledE2EPayload,
  ) => Promise<PaymentReminderHandlerResponse>
  executeScheduledPreview: () => Promise<PaymentReminderHandlerResponse>
  executeScheduledProduction: () => Promise<PaymentReminderHandlerResponse>
}

export async function handleClassifiedPaymentReminderRequest(
  mode: PaymentReminderMode,
  headers: PaymentReminderRequestHeaders,
  dependencies: PaymentReminderHandlerDependencies,
): Promise<PaymentReminderHandlerResponse> {
  try {
    await authorizePaymentReminderMode(mode, headers, dependencies.auth)
  } catch (error) {
    if (error instanceof PaymentReminderAuthError) {
      return { status: error.status, body: { error: error.code } }
    }
    return { status: 500, body: { error: 'authentication_failed' } }
  }

  if (mode.kind === 'controlled_e2e') {
    return dependencies.executeControlledE2E(mode.value)
  }
  if (mode.kind === 'scheduled_preview') {
    return dependencies.executeScheduledPreview()
  }
  if (mode.kind === 'scheduled_production') {
    return dependencies.executeScheduledProduction()
  }
  return dependencies.executeDryRun()
}
