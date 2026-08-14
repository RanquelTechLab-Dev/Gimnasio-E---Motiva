export const RECENT_PAYMENTS_PAGE_SIZE = 1_000

export type RecentApprovedPayment = Readonly<{
  id: string
  student_id: string | null
  paid_at: string | null
  approved_at: string | null
  created_at: string | null
}>

export type FetchRecentPaymentsPage = (
  from: number,
  to: number,
) => Promise<readonly RecentApprovedPayment[]>

export type RecentPaymentsPageRange = Readonly<{
  from: number
  to: number
}>

export function buildSafeRecentPaymentsPageRange(
  from: number,
): RecentPaymentsPageRange {
  if (!Number.isSafeInteger(from) || from < 0) {
    throw new RangeError(
      'Recent payments page start must be a non-negative safe integer.',
    )
  }

  const maximumSafeStart =
    Number.MAX_SAFE_INTEGER - (RECENT_PAYMENTS_PAGE_SIZE - 1)
  if (from > maximumSafeStart) {
    throw new RangeError(
      'Recent payments page range would exceed Number.MAX_SAFE_INTEGER.',
    )
  }

  const to = from + RECENT_PAYMENTS_PAGE_SIZE - 1
  if (
    !Number.isSafeInteger(to) ||
    to < from ||
    to - from + 1 !== RECENT_PAYMENTS_PAGE_SIZE
  ) {
    throw new RangeError('Recent payments page range is not safely bounded.')
  }

  return { from, to }
}

export function nextSafeRecentPaymentsPageStart(
  from: number,
  to: number,
): number {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError('Recent payments page cannot advance safely.')
  }

  const nextFrom = to + 1
  if (
    !Number.isSafeInteger(nextFrom) ||
    nextFrom <= to ||
    nextFrom <= from
  ) {
    throw new RangeError('Recent payments page did not make strict progress.')
  }

  buildSafeRecentPaymentsPageRange(nextFrom)
  return nextFrom
}

export async function collectAllRecentApprovedPayments(
  fetchPage: FetchRecentPaymentsPage,
): Promise<RecentApprovedPayment[]> {
  const payments: RecentApprovedPayment[] = []
  let from = 0

  for (;;) {
    const range = buildSafeRecentPaymentsPageRange(from)
    const page = await fetchPage(range.from, range.to)

    if (page.length > RECENT_PAYMENTS_PAGE_SIZE) {
      throw new RangeError(
        `Recent payments page ${range.from}-${range.to} exceeded the ${RECENT_PAYMENTS_PAGE_SIZE}-row contract.`,
      )
    }

    payments.push(...page)

    if (page.length < RECENT_PAYMENTS_PAGE_SIZE) {
      return payments
    }

    from = nextSafeRecentPaymentsPageStart(range.from, range.to)
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
