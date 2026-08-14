import { describe, expect, it } from 'vitest'
import {
  buildSafeRecentPaymentsPageRange,
  buildLatestPaymentByStudent,
  collectAllRecentApprovedPayments,
  nextSafeRecentPaymentsPageStart,
  RECENT_PAYMENTS_PAGE_SIZE,
  type FetchRecentPaymentsPage,
  type RecentApprovedPayment,
} from './recent_payments_pagination'
import {
  selectEligibleRecipients,
  validateRecipientIds,
} from './recipient_selection'

function syntheticUuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function syntheticDate(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
}

function payment(
  index: number,
  overrides: Partial<RecentApprovedPayment> = {},
): RecentApprovedPayment {
  return {
    id: `payment-${index.toString().padStart(6, '0')}`,
    student_id: syntheticUuid(index + 1),
    paid_at: syntheticDate(index),
    approved_at: null,
    created_at: syntheticDate(index),
    ...overrides,
  }
}

function payments(count: number) {
  return Array.from({ length: count }, (_, index) => payment(index))
}

function pageFetcher(
  rows: readonly RecentApprovedPayment[],
  calls: Array<[number, number]> = [],
): FetchRecentPaymentsPage {
  return async (from, to) => {
    calls.push([from, to])
    return rows.slice(from, to + 1)
  }
}

describe('MANUAL EMAIL BACKEND recent approved payments pagination contract', () => {
  it('1. obtiene 999 filas en una sola página', async () => {
    const rows = payments(999)
    const calls: Array<[number, number]> = []

    const result = await collectAllRecentApprovedPayments(
      pageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toEqual([[0, 999]])
  })

  it('2. con 1000 filas consulta una segunda página vacía y conserva todas', async () => {
    const rows = payments(1_000)
    const calls: Array<[number, number]> = []

    const result = await collectAllRecentApprovedPayments(
      pageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toEqual([
      [0, 999],
      [1_000, 1_999],
    ])
  })

  it('3. obtiene 1001 filas completas en dos páginas', async () => {
    const rows = payments(1_001)
    const calls: Array<[number, number]> = []

    const result = await collectAllRecentApprovedPayments(
      pageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(2)
  })

  it('4. obtiene 2001 filas completas en tres páginas', async () => {
    const rows = payments(2_001)
    const calls: Array<[number, number]> = []

    const result = await collectAllRecentApprovedPayments(
      pageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(3)
  })

  it('5. usa rangos inclusivos exactos para cada página', async () => {
    const calls: Array<[number, number]> = []

    await collectAllRecentApprovedPayments(
      pageFetcher(payments(2_001), calls),
    )

    expect(calls).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ])
  })

  it('6. un error en la segunda página rechaza toda la operación', async () => {
    const firstPage = payments(RECENT_PAYMENTS_PAGE_SIZE)
    const calls: Array<[number, number]> = []
    const pageError = new Error('synthetic second page failure')
    const fetchPage: FetchRecentPaymentsPage = async (from, to) => {
      calls.push([from, to])
      if (from === 0) {
        return firstPage
      }
      throw pageError
    }

    await expect(collectAllRecentApprovedPayments(fetchPage)).rejects.toBe(
      pageError,
    )
    expect(calls).toEqual([
      [0, 999],
      [1_000, 1_999],
    ])
  })

  it('7. rechaza una página con más de 1000 filas', async () => {
    const oversizedPage = payments(RECENT_PAYMENTS_PAGE_SIZE + 1)

    await expect(
      collectAllRecentApprovedPayments(async () => oversizedPage),
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('8. preserva el orden global recibido entre páginas', async () => {
    const firstPage = payments(1_000).reverse()
    const finalRow = payment(2_500)
    const expected = [...firstPage, finalRow]
    const fetchPage: FetchRecentPaymentsPage = async (from) =>
      from === 0 ? firstPage : [finalRow]

    const result = await collectAllRecentApprovedPayments(fetchPage)

    expect(result.map((row) => row.id)).toEqual(
      expected.map((row) => row.id),
    )
  })

  it('9. no muta las páginas ni los objetos recibidos', async () => {
    const firstPage = Object.freeze(
      payments(1_000).map((row) => Object.freeze(row)),
    )
    const finalPage = Object.freeze([Object.freeze(payment(1_000))])
    const originalFirstPage = JSON.stringify(firstPage)
    const originalFinalPage = JSON.stringify(finalPage)
    const fetchPage: FetchRecentPaymentsPage = async (from) =>
      from === 0 ? firstPage : finalPage

    const result = await collectAllRecentApprovedPayments(fetchPage)
    buildLatestPaymentByStudent(result)

    expect(JSON.stringify(firstPage)).toBe(originalFirstPage)
    expect(JSON.stringify(finalPage)).toBe(originalFinalPage)
    expect(result).not.toBe(firstPage)
    expect(result[0]).toBe(firstPage[0])
  })

  it('10. incluye al alumno cuyo único pago está en la fila 1001', async () => {
    const targetId = syntheticUuid(9_001)
    const rows = payments(1_001).map((row, index) => ({
      ...row,
      student_id: index === 1_000 ? targetId : null,
    }))

    const allPayments = await collectAllRecentApprovedPayments(
      pageFetcher(rows),
    )
    const latestPaymentByStudent = buildLatestPaymentByStudent(allPayments)

    expect(latestPaymentByStudent.get(targetId)).toBe(rows[1_000].paid_at)
    expect(latestPaymentByStudent.size).toBe(1)
  })

  it('11. conserva el pago más reciente del mismo alumno entre páginas', async () => {
    const targetId = syntheticUuid(9_002)
    const newerDate = '2026-06-01T00:00:00.000Z'
    const olderDate = '2026-01-01T00:00:00.000Z'
    const rows = payments(1_001).map((row) => ({
      ...row,
      student_id: null,
    }))
    rows[0] = payment(0, { student_id: targetId, approved_at: newerDate })
    rows[1_000] = payment(1_000, {
      student_id: targetId,
      approved_at: olderDate,
    })

    const allPayments = await collectAllRecentApprovedPayments(
      pageFetcher(rows),
    )
    const latestPaymentByStudent = buildLatestPaymentByStudent(allPayments)

    expect(latestPaymentByStudent.get(targetId)).toBe(newerDate)
  })

  it('12. selección mixta conserva elegibles antes y después de la fila 1000', async () => {
    const beforeId = syntheticUuid(9_003)
    const afterId = syntheticUuid(9_004)
    const rows = payments(1_001).map((row) => ({
      ...row,
      student_id: null,
    }))
    rows[0] = payment(0, { student_id: beforeId })
    rows[1_000] = payment(1_000, { student_id: afterId })

    const allPayments = await collectAllRecentApprovedPayments(
      pageFetcher(rows),
    )
    const latestPaymentByStudent = buildLatestPaymentByStudent(allPayments)
    const eligibleRecipients = [...latestPaymentByStudent.keys()].map((id) => ({
      id,
      email: `${id}@example.invalid`,
    }))
    const validation = validateRecipientIds([beforeId, afterId])
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    const selection = selectEligibleRecipients(
      eligibleRecipients,
      validation.selection,
    )

    expect(selection.recipients.map((recipient) => recipient.id)).toEqual([
      beforeId,
      afterId,
    ])
    expect(selection.requested_count).toBe(2)
    expect(selection.selected_count).toBe(2)
    expect(selection.ignored_count).toBe(0)
  })

  it('13. construye el rango inicial exacto 0-999', () => {
    expect(buildSafeRecentPaymentsPageRange(0)).toEqual({
      from: 0,
      to: 999,
    })
  })

  it('14. acepta el último rango inclusivo seguro', () => {
    const from = Number.MAX_SAFE_INTEGER - (RECENT_PAYMENTS_PAGE_SIZE - 1)

    expect(buildSafeRecentPaymentsPageRange(from)).toEqual({
      from,
      to: Number.MAX_SAFE_INTEGER,
    })
  })

  it('15. rechaza un rango cuyo to excedería el entero seguro', () => {
    const from = Number.MAX_SAFE_INTEGER - (RECENT_PAYMENTS_PAGE_SIZE - 2)

    expect(() => buildSafeRecentPaymentsPageRange(from)).toThrow(RangeError)
  })

  it('16. una página completa que termina en MAX_SAFE_INTEGER no puede avanzar', () => {
    const range = buildSafeRecentPaymentsPageRange(
      Number.MAX_SAFE_INTEGER - (RECENT_PAYMENTS_PAGE_SIZE - 1),
    )

    expect(() =>
      nextSafeRecentPaymentsPageStart(range.from, range.to),
    ).toThrow(RangeError)
  })

  it('17. rechaza un avance que no supera estrictamente from y to', () => {
    expect(() => nextSafeRecentPaymentsPageStart(1_000, 999)).toThrow(
      RangeError,
    )
  })
})
