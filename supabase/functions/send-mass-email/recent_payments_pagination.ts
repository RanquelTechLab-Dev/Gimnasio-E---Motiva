export const RECENT_PAYMENTS_PAGE_SIZE = 1_000

export type RecentApprovedPayment = Readonly<{
  id: string
  student_id: string | null
  paid_at: string | null
  approved_at: string | null
  created_at: string | null
}>

export type RecentPaymentsCursor = Readonly<{
  paid_at: string
  id: string
}>

export type FetchRecentPaymentsPage = (
  cursor: RecentPaymentsCursor | null,
  limit: number,
) => Promise<readonly RecentApprovedPayment[]>

type RecentPaymentKey = Readonly<{
  paid_at: string | null
  id: string
}>

type ValidatedRecentPaymentKey = Readonly<{
  cursor: RecentPaymentsCursor
  timestampNanoseconds: bigint
  uuidHex: string
}>

const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function validateTimestamp(value: string | null) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError('Recent payments cursor requires paid_at.')
  }

  const match = RFC3339_TIMESTAMP.exec(value)
  if (!match || match[0] !== value) {
    throw new RangeError('Recent payments cursor paid_at is invalid.')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const timezone = match[8]
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  const timezoneHour = timezone === 'Z' ? 0 : Number(timezone.slice(1, 3))
  const timezoneMinute = timezone === 'Z' ? 0 : Number(timezone.slice(4, 6))

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    timezoneHour > 23 ||
    timezoneMinute > 59
  ) {
    throw new RangeError('Recent payments cursor paid_at is invalid.')
  }

  const epochMilliseconds = Date.parse(value)
  if (!Number.isFinite(epochMilliseconds)) {
    throw new RangeError('Recent payments cursor paid_at is invalid.')
  }

  const fractionalNanoseconds = (match[7] ?? '').padEnd(9, '0')
  const subMillisecondNanoseconds = BigInt(fractionalNanoseconds.slice(3))

  return (
    BigInt(epochMilliseconds) * 1_000_000n + subMillisecondNanoseconds
  )
}

function validateRecentPaymentKey(
  key: RecentPaymentKey,
): ValidatedRecentPaymentKey {
  const timestampNanoseconds = validateTimestamp(key.paid_at)
  const uuidMatch =
    typeof key.id === 'string' ? CANONICAL_UUID.exec(key.id) : null
  if (!uuidMatch || uuidMatch[0] !== key.id) {
    throw new RangeError('Recent payments cursor id must be a UUID.')
  }

  const id = key.id.toLowerCase()
  return {
    cursor: { paid_at: key.paid_at as string, id },
    timestampNanoseconds,
    uuidHex: id.replaceAll('-', ''),
  }
}

export function cursorFromRecentPayment(
  payment: RecentPaymentKey,
): RecentPaymentsCursor {
  return validateRecentPaymentKey(payment).cursor
}

export function compareRecentPaymentKeys(
  left: RecentPaymentKey,
  right: RecentPaymentKey,
): -1 | 0 | 1 {
  const validatedLeft = validateRecentPaymentKey(left)
  const validatedRight = validateRecentPaymentKey(right)

  if (
    validatedLeft.timestampNanoseconds < validatedRight.timestampNanoseconds
  ) {
    return -1
  }
  if (
    validatedLeft.timestampNanoseconds > validatedRight.timestampNanoseconds
  ) {
    return 1
  }
  if (validatedLeft.uuidHex < validatedRight.uuidHex) {
    return -1
  }
  if (validatedLeft.uuidHex > validatedRight.uuidHex) {
    return 1
  }
  return 0
}

export function buildPostgrestRecentPaymentsCursorFilter(
  cursor: RecentPaymentsCursor,
) {
  // Supabase `.or()` accepts raw PostgREST syntax. These values originate from
  // typed DB rows and are revalidated here before interpolation; arbitrary
  // request or frontend values never reach this filter.
  const validated = validateRecentPaymentKey(cursor).cursor
  return `paid_at.gt.${validated.paid_at},and(paid_at.eq.${validated.paid_at},id.gt.${validated.id})`
}

export async function collectAllRecentApprovedPayments(
  fetchPage: FetchRecentPaymentsPage,
): Promise<RecentApprovedPayment[]> {
  const payments: RecentApprovedPayment[] = []
  const seenPaymentIds = new Set<string>()
  let cursor: RecentPaymentsCursor | null = null

  for (;;) {
    const page = await fetchPage(cursor, RECENT_PAYMENTS_PAGE_SIZE)

    if (page.length > RECENT_PAYMENTS_PAGE_SIZE) {
      throw new RangeError(
        `Recent payments page exceeded the ${RECENT_PAYMENTS_PAGE_SIZE}-row contract.`,
      )
    }

    const validatedPageCursors: RecentPaymentsCursor[] = []
    let previousKey: RecentPaymentKey | null = cursor

    for (const payment of page) {
      const paymentCursor = cursorFromRecentPayment(payment)
      if (
        previousKey !== null &&
        compareRecentPaymentKeys(previousKey, paymentCursor) >= 0
      ) {
        throw new RangeError(
          'Recent payments page did not preserve strict keyset order.',
        )
      }
      if (seenPaymentIds.has(paymentCursor.id)) {
        throw new RangeError('Recent payments page repeated a payment id.')
      }

      validatedPageCursors.push(paymentCursor)
      previousKey = paymentCursor
    }

    payments.push(...page)
    for (const paymentCursor of validatedPageCursors) {
      seenPaymentIds.add(paymentCursor.id)
    }

    if (page.length < RECENT_PAYMENTS_PAGE_SIZE) {
      return payments
    }

    const nextCursor = validatedPageCursors.at(-1)
    if (
      !nextCursor ||
      (cursor !== null && compareRecentPaymentKeys(cursor, nextCursor) >= 0)
    ) {
      throw new RangeError('Recent payments cursor did not make progress.')
    }

    cursor = nextCursor
  }
}

export function buildLatestPaymentByStudent(
  payments: readonly RecentApprovedPayment[],
): Map<string, string> {
  const latestPaymentByStudent = new Map<string, string>()

  for (const payment of payments) {
    const studentId = payment.student_id
    const paidAt =
      payment.approved_at ?? payment.paid_at ?? payment.created_at

    if (!studentId || !paidAt) {
      continue
    }

    const paidAtTimestamp = new Date(paidAt).getTime()
    if (Number.isNaN(paidAtTimestamp)) {
      continue
    }

    const current = latestPaymentByStudent.get(studentId)
    if (!current || paidAtTimestamp > new Date(current).getTime()) {
      latestPaymentByStudent.set(studentId, paidAt)
    }
  }

  return latestPaymentByStudent
}
