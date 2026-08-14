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

function providerError(body: MailjetResponseBody | null, status: number) {
  const firstMessage = body?.Messages?.[0]
  const candidate =
    firstMessage?.Errors?.[0]?.ErrorMessage ?? body?.ErrorMessage
  const message =
    typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : `Mailjet respondio HTTP ${status}.`

  return message.slice(0, MAX_PROVIDER_ERROR_LENGTH)
}

export function createMailjetAdapter(
  config: MailjetConfig,
  fetchImpl: FetchLike,
) {
  return async function sendMail(
    message: ReminderMailMessage,
  ): Promise<ReminderMailResult> {
    const encodedCredentials = btoa(`${config.apiKey}:${config.apiSecret}`)
    const response = await fetchImpl(MAILJET_SEND_URL, {
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
    const body = (await response.json().catch(() => null)) as
      | MailjetResponseBody
      | null
    const firstMessage = body?.Messages?.[0]

    if (response.ok && firstMessage?.Status === 'success') {
      const messageId = firstMessage.To?.[0]?.MessageID
      return {
        ok: true,
        provider_message_id:
          messageId === null || messageId === undefined
            ? null
            : String(messageId),
      }
    }

    return {
      ok: false,
      error: providerError(body, response.status),
    }
  }
}
