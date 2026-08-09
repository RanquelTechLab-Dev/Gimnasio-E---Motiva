export const PAYMENT_REMINDER_TIME_ZONE = 'America/Argentina/Cordoba'

export const PAYMENT_REMINDER_OFFSETS = [5, 3, 1, 0] as const

export type ReminderOffset = (typeof PAYMENT_REMINDER_OFFSETS)[number]

export type ReminderCandidate = {
  membership_id: string
  student_id: string
  student_first_name: string
  student_last_name: string
  email: string
  student_active: boolean
  receives_payment_reminders: boolean
  receives_emails?: boolean
  membership_status: string
  start_date: string
  end_date: string
}

export type ReminderEvaluation = {
  eligible: boolean
  offset_days: ReminderOffset | null
  reason: string
  idempotency_key: string | null
}

export type DryRunPayloadValidation =
  | {
      valid: true
      value: { dryRun: true; evaluationDate?: string }
    }
  | { valid: false; error: string }

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 86_400_000

type DateOnlyParts = {
  year: number
  month: number
  day: number
}

function parseDateOnly(value: string): DateOnlyParts | null {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function formatDateOnly(parts: DateOnlyParts) {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

function dateOnlyEpoch(value: string) {
  const parts = parseDateOnly(value)
  if (!parts) {
    throw new TypeError(`Fecha date-only invalida: ${value}`)
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

function excluded(reason: string): ReminderEvaluation {
  return {
    eligible: false,
    offset_days: null,
    reason,
    idempotency_key: null,
  }
}

export function isValidDateOnly(value: string) {
  return parseDateOnly(value) !== null
}

export function getDateInTimeZone(
  instant: Date = new Date(),
  timeZone = PAYMENT_REMINDER_TIME_ZONE,
) {
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError('El instante de evaluacion es invalido.')
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)

  const values = new Map(parts.map((part) => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')

  if (!year || !month || !day) {
    throw new Error('No se pudo resolver la fecha local de evaluacion.')
  }

  return `${year}-${month}-${day}`
}

export function addDaysToDate(date: string, days: number) {
  if (!Number.isInteger(days)) {
    throw new TypeError('La cantidad de dias debe ser un entero.')
  }

  const shifted = new Date(dateOnlyEpoch(date) + days * MILLISECONDS_PER_DAY)
  return formatDateOnly({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  })
}

export function differenceInDateOnlyDays(
  evaluationDate: string,
  endDate: string,
) {
  return (
    (dateOnlyEpoch(endDate) - dateOnlyEpoch(evaluationDate)) /
    MILLISECONDS_PER_DAY
  )
}

export function isValidEmail(email: string) {
  if (
    typeof email !== 'string' ||
    email.length > 254 ||
    email !== email.trim() ||
    /\s/.test(email)
  ) {
    return false
  }

  return /^[^@]+@[^@]+\.[^@]+$/.test(email)
}

export function buildPaymentReminderIdempotencyKey(
  membershipId: string,
  endDate: string,
  offsetDays: ReminderOffset,
) {
  return `payment_due_reminder:${membershipId}:${endDate}:${offsetDays}`
}

export function evaluateReminderCandidate(
  candidate: ReminderCandidate,
  evaluationDate: string,
): ReminderEvaluation {
  if (!isValidDateOnly(evaluationDate)) {
    throw new TypeError(`Fecha date-only invalida: ${evaluationDate}`)
  }

  if (!candidate.student_active) {
    return excluded('student_inactive')
  }

  if (!isValidEmail(candidate.email)) {
    return excluded('invalid_email')
  }

  if (!candidate.receives_payment_reminders) {
    return excluded('payment_reminders_disabled')
  }

  if (candidate.membership_status !== 'active') {
    return excluded('membership_not_active')
  }

  if (
    !isValidDateOnly(candidate.start_date) ||
    !isValidDateOnly(candidate.end_date)
  ) {
    return excluded('invalid_membership_dates')
  }

  if (candidate.start_date > evaluationDate) {
    return excluded('membership_not_started')
  }

  const daysUntilDue = differenceInDateOnlyDays(
    evaluationDate,
    candidate.end_date,
  )

  if (daysUntilDue < 0) {
    return excluded('membership_ended')
  }

  const offset = PAYMENT_REMINDER_OFFSETS.find(
    (candidateOffset) => candidateOffset === daysUntilDue,
  )

  if (offset === undefined) {
    return excluded('offset_not_scheduled')
  }

  return {
    eligible: true,
    offset_days: offset,
    reason: 'eligible',
    idempotency_key: buildPaymentReminderIdempotencyKey(
      candidate.membership_id,
      candidate.end_date,
      offset,
    ),
  }
}

export function validateDryRunPayload(
  payload: unknown,
): DryRunPayloadValidation {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    (payload as Record<string, unknown>).dryRun !== true
  ) {
    return {
      valid: false,
      error: 'RAN-36 B1 solo permite dry-run.',
    }
  }

  const evaluationDate = (payload as Record<string, unknown>).evaluationDate
  if (
    evaluationDate !== undefined &&
    (typeof evaluationDate !== 'string' || !isValidDateOnly(evaluationDate))
  ) {
    return {
      valid: false,
      error: 'evaluationDate debe ser una fecha YYYY-MM-DD valida.',
    }
  }

  return {
    valid: true,
    value: {
      dryRun: true,
      ...(evaluationDate === undefined ? {} : { evaluationDate }),
    },
  }
}
