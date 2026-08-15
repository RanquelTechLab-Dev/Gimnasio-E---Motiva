import type { PaymentReminderMode } from './controlled_e2e.ts'

const CRON_SECRET_ENV = 'PAYMENT_REMINDER_CRON_SECRET'

export type PaymentReminderAuthDependencies = {
  getEnv: (name: string) => string | undefined
  getUser: (token: string) => Promise<{ id: string } | null>
  getProfile: (
    userId: string,
  ) => Promise<{ role: string; active: boolean } | null>
}

export type PaymentReminderRequestHeaders = {
  authorization: string | null
  cronSecret: string | null
}

export class PaymentReminderAuthError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'PaymentReminderAuthError'
    this.code = code
    this.status = status
  }
}

function isScheduledMode(mode: PaymentReminderMode) {
  return (
    mode.kind === 'scheduled_preview' ||
    mode.kind === 'scheduled_production'
  )
}

export async function verifyCronSecret(
  providedSecret: string,
  configuredSecret: string,
) {
  const encoder = new TextEncoder()
  const [providedDigest, configuredDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(providedSecret)),
    crypto.subtle.digest('SHA-256', encoder.encode(configuredSecret)),
  ])
  const providedBytes = new Uint8Array(providedDigest)
  const configuredBytes = new Uint8Array(configuredDigest)
  let difference = 0

  for (let index = 0; index < configuredBytes.length; index += 1) {
    difference |= providedBytes[index] ^ configuredBytes[index]
  }

  return difference === 0
}

async function authorizeScheduledRequest(
  headers: PaymentReminderRequestHeaders,
  dependencies: PaymentReminderAuthDependencies,
) {
  const configuredSecret = dependencies.getEnv(CRON_SECRET_ENV)
  if (!configuredSecret || configuredSecret.length < 32) {
    throw new PaymentReminderAuthError('service_auth_unavailable', 503)
  }

  if (!headers.cronSecret) {
    throw new PaymentReminderAuthError('service_auth_failed', 401)
  }

  const authorized = await verifyCronSecret(
    headers.cronSecret,
    configuredSecret,
  )
  if (!authorized) {
    throw new PaymentReminderAuthError('service_auth_failed', 401)
  }

  return { kind: 'service' as const }
}

async function authorizeAdminRequest(
  headers: PaymentReminderRequestHeaders,
  dependencies: PaymentReminderAuthDependencies,
) {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? '')
  const token = bearer?.[1]?.trim() ?? ''
  if (!token) {
    throw new PaymentReminderAuthError('admin_auth_required', 401)
  }

  let user: { id: string } | null
  try {
    user = await dependencies.getUser(token)
  } catch {
    user = null
  }
  if (!user) {
    throw new PaymentReminderAuthError('admin_auth_invalid', 401)
  }

  let profile: { role: string; active: boolean } | null
  try {
    profile = await dependencies.getProfile(user.id)
  } catch {
    profile = null
  }
  if (!profile || profile.role !== 'admin' || profile.active !== true) {
    throw new PaymentReminderAuthError('admin_forbidden', 403)
  }

  return { kind: 'admin' as const, user_id: user.id }
}

export async function authorizePaymentReminderMode(
  mode: PaymentReminderMode,
  headers: PaymentReminderRequestHeaders,
  dependencies: PaymentReminderAuthDependencies,
) {
  if (isScheduledMode(mode)) {
    return authorizeScheduledRequest(headers, dependencies)
  }

  return authorizeAdminRequest(headers, dependencies)
}
