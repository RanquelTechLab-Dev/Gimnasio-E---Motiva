import type {
  ReminderMailMessage,
  ReminderMailResult,
} from './reminder_delivery.ts'
import { isValidEmail } from './reminder_logic.ts'

export type MailjetConfig = {
  apiKey: string
  apiSecret: string
  fromEmail: string
  fromName: string
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type MailjetResponseBody = {
  ErrorMessage?: unknown
  Messages?: Array<{
    Status?: unknown
    To?: Array<{ MessageID?: unknown }>
    Errors?: Array<{ ErrorMessage?: unknown }>
  }>
}

const MAILJET_SEND_URL = 'https://api.mailjet.com/v3.1/send'
const MAX_PROVIDER_ERROR_LENGTH = 1_000
const SENSITIVE_HEADER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi
const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(\b(?:authorization|(?:mailjet[_ -]?)?api[_ -]?(?:key|secret)|token|password)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi

function requireSecret(
  getEnv: (name: string) => string | undefined,
  name: string,
) {
  const value = getEnv(name)
  if (!value || !value.trim()) {
    throw new Error(`Falta el secret ${name}.`)
  }
  return value.trim()
}

export function readMailjetConfig(
  getEnv: (name: string) => string | undefined,
): MailjetConfig {
  const fromEmail = requireSecret(getEnv, 'MAILJET_FROM_EMAIL')
  if (!isValidEmail(fromEmail)) {
    throw new Error('El secret MAILJET_FROM_EMAIL no es un email valido.')
  }

  return {
    apiKey: requireSecret(getEnv, 'MAILJET_API_KEY'),
    apiSecret: requireSecret(getEnv, 'MAILJET_API_SECRET'),
    fromEmail,
    fromName: getEnv('MAILJET_FROM_NAME')?.trim() || 'E-Motiva',
  }
}

function boundedProviderError(value: unknown, fallback: string) {
  const candidate =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : ''

  return (candidate.trim() || fallback)
    .replace(SENSITIVE_HEADER_PATTERN, '[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1[REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .slice(0, MAX_PROVIDER_ERROR_LENGTH)
}

function explicitProviderError(body: MailjetResponseBody | null) {
  const firstMessage = body?.Messages?.[0]
  const candidate =
    firstMessage?.Errors?.[0]?.ErrorMessage ?? body?.ErrorMessage

  return typeof candidate === 'string' && candidate.trim()
    ? boundedProviderError(candidate, 'Mailjet rechazo el mensaje.')
    : null
}

export function createMailjetAdapter(
  config: MailjetConfig,
  fetchImpl: FetchLike,
) {
  return async function sendMail(
    message: ReminderMailMessage,
  ): Promise<ReminderMailResult> {
    let response: Response
    try {
      const encodedCredentials = btoa(`${config.apiKey}:${config.apiSecret}`)
      response = await fetchImpl(MAILJET_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Messages: [
            {
              From: {
                Email: config.fromEmail,
                Name: config.fromName,
              },
              To: [
                {
                  Email: message.toEmail,
                  Name: message.toName,
                },
              ],
              Subject: message.subject,
              TextPart: message.textPart,
              HTMLPart: message.htmlPart,
            },
          ],
        }),
      })
    } catch (error) {
      return {
        outcome: 'uncertain',
        error: boundedProviderError(
          error,
          'No se pudo confirmar la respuesta de Mailjet.',
        ),
      }
    }

    const body = (await response.json().catch(() => null)) as
      | MailjetResponseBody
      | null
    const firstMessage = body?.Messages?.[0]
    const providerError = explicitProviderError(body)
    const providerStatus =
      typeof firstMessage?.Status === 'string'
        ? firstMessage.Status.trim().toLowerCase()
        : null

    if (providerStatus === 'error' || providerError !== null) {
      return {
        outcome: 'rejected',
        error:
          providerError ??
          boundedProviderError(null, 'Mailjet rechazo el mensaje.'),
      }
    }

    if (!response.ok) {
      return {
        outcome: 'uncertain',
        error: boundedProviderError(
          null,
          `Mailjet respondio HTTP ${response.status} sin rechazo explicito confirmado.`,
        ),
      }
    }

    if (providerStatus === 'success') {
      const messageId = firstMessage?.To?.[0]?.MessageID
      return {
        outcome: 'accepted',
        provider_message_id:
          messageId === null || messageId === undefined
            ? null
            : String(messageId).slice(0, MAX_PROVIDER_ERROR_LENGTH),
      }
    }

    return {
      outcome: 'uncertain',
      error: boundedProviderError(
        null,
        `Mailjet respondio HTTP ${response.status} sin confirmacion interpretable.`,
      ),
    }
  }
}
