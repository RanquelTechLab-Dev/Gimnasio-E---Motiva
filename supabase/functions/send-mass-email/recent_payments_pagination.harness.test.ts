import { describe, expect, it } from 'vitest'
import {
  buildLatestPaymentByStudent,
  buildPostgrestRecentPaymentsCursorFilter,
  collectAllRecentApprovedPayments,
  compareRecentPaymentKeys,
  cursorFromRecentPayment,
  RECENT_PAYMENTS_PAGE_SIZE,
  type FetchRecentPaymentsPage,
  type RecentApprovedPayment,
  type RecentPaymentsCursor,
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
    id: syntheticUuid(100_000 + index),
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

type FetchCall = readonly [RecentPaymentsCursor | null, number]

function databaseKeyIsAfterCursor(
  row: RecentApprovedPayment,
  cursor: RecentPaymentsCursor,
) {
  if (!row.paid_at) {
    return false
  }

  return (
    row.paid_at > cursor.paid_at ||
    (row.paid_at === cursor.paid_at && row.id.toLowerCase() > cursor.id)
  )
}

function keysetPageFetcher(
  rows: readonly RecentApprovedPayment[],
  calls: FetchCall[] = [],
): FetchRecentPaymentsPage {
  return async (cursor, limit) => {
    calls.push([cursor ? { ...cursor } : null, limit])
    return rows
      .filter(
        (row) =>
          cursor === null || databaseKeyIsAfterCursor(row, cursor),
      )
      .slice(0, limit)
  }
}

describe('MANUAL EMAIL BACKEND recent approved payments pagination contract', () => {
  it('1. obtiene 999 filas con una llamada de cursor nulo', async () => {
    const rows = payments(999)
    const calls: FetchCall[] = []

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toEqual([[null, RECENT_PAYMENTS_PAGE_SIZE]])
  })

  it('2. con 1000 filas avanza con el cursor de la fila 1000', async () => {
    const rows = payments(1_000)
    const calls: FetchCall[] = []

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toEqual([
      [null, RECENT_PAYMENTS_PAGE_SIZE],
      [cursorFromRecentPayment(rows[999]), RECENT_PAYMENTS_PAGE_SIZE],
    ])
  })

  it('3. obtiene 1001 filas completas en dos paginas keyset', async () => {
    const rows = payments(1_001)
    const calls: FetchCall[] = []

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(2)
  })

  it('4. obtiene 2001 filas completas en tres paginas keyset', async () => {
    const rows = payments(2_001)
    const calls: FetchCall[] = []

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls).toHaveLength(3)
  })

  it('5. construye cursor y filtro exactos desde la ultima fila previa', async () => {
    const rows = payments(1_001)
    rows[999] = payment(999, {
      paid_at: '2026-01-01T00:16:39.123456Z',
      created_at: '2026-01-01T00:16:39.123456Z',
    })
    const calls: FetchCall[] = []

    await collectAllRecentApprovedPayments(keysetPageFetcher(rows, calls))

    const expectedCursor = cursorFromRecentPayment(rows[999])
    expect(calls[1]).toEqual([expectedCursor, RECENT_PAYMENTS_PAGE_SIZE])
    expect(buildPostgrestRecentPaymentsCursorFilter(expectedCursor)).toBe(
      `paid_at.gt.${expectedCursor.paid_at},and(paid_at.eq.${expectedCursor.paid_at},id.gt.${expectedCursor.id})`,
    )
  })

  it('6. un error en la segunda pagina rechaza toda la operacion', async () => {
    const firstPage = payments(RECENT_PAYMENTS_PAGE_SIZE)
    const calls: FetchCall[] = []
    const pageError = new Error('synthetic second page failure')
    const fetchPage: FetchRecentPaymentsPage = async (cursor, limit) => {
      calls.push([cursor ? { ...cursor } : null, limit])
      if (cursor === null) {
        return firstPage
      }
      throw pageError
    }

    await expect(collectAllRecentApprovedPayments(fetchPage)).rejects.toBe(
      pageError,
    )
    expect(calls).toEqual([
      [null, RECENT_PAYMENTS_PAGE_SIZE],
      [cursorFromRecentPayment(firstPage[999]), RECENT_PAYMENTS_PAGE_SIZE],
    ])
  })

  it('7. rechaza una pagina con mas de 1000 filas', async () => {
    const oversizedPage = payments(RECENT_PAYMENTS_PAGE_SIZE + 1)

    await expect(
      collectAllRecentApprovedPayments(async () => oversizedPage),
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('8. preserva el orden global recibido entre paginas', async () => {
    const rows = payments(1_001)

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows),
    )

    expect(result.map((row) => row.id)).toEqual(rows.map((row) => row.id))
  })

  it('9. no muta las paginas ni los objetos recibidos', async () => {
    const firstPage = Object.freeze(
      payments(1_000).map((row) => Object.freeze(row)),
    )
    const finalPage = Object.freeze([Object.freeze(payment(1_000))])
    const originalFirstPage = JSON.stringify(firstPage)
    const originalFinalPage = JSON.stringify(finalPage)
    const fetchPage: FetchRecentPaymentsPage = async (cursor) =>
      cursor === null ? firstPage : finalPage

    const result = await collectAllRecentApprovedPayments(fetchPage)
    buildLatestPaymentByStudent(result)

    expect(JSON.stringify(firstPage)).toBe(originalFirstPage)
    expect(JSON.stringify(finalPage)).toBe(originalFinalPage)
    expect(result).not.toBe(firstPage)
    expect(result[0]).toBe(firstPage[0])
  })

  it('10. incluye al alumno cuyo unico pago esta despues de la primera pagina', async () => {
    const targetId = syntheticUuid(9_001)
    const rows = payments(1_001).map((row, index) => ({
      ...row,
      student_id: index === 1_000 ? targetId : null,
    }))

    const allPayments = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows),
    )
    const latestPaymentByStudent = buildLatestPaymentByStudent(allPayments)

    expect(latestPaymentByStudent.get(targetId)).toBe(rows[1_000].paid_at)
    expect(latestPaymentByStudent.size).toBe(1)
  })

  it('11. conserva el pago mas reciente del mismo alumno entre paginas', async () => {
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
      keysetPageFetcher(rows),
    )
    const latestPaymentByStudent = buildLatestPaymentByStudent(allPayments)

    expect(latestPaymentByStudent.get(targetId)).toBe(newerDate)
  })

  it('12. seleccion mixta conserva elegibles antes y despues de la primera pagina', async () => {
    const beforeId = syntheticUuid(9_003)
    const afterId = syntheticUuid(9_004)
    const rows = payments(1_001).map((row) => ({
      ...row,
      student_id: null,
    }))
    rows[0] = payment(0, { student_id: beforeId })
    rows[1_000] = payment(1_000, { student_id: afterId })

    const allPayments = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows),
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

  it('13. la primera llamada usa cursor nulo y limite 1000', async () => {
    const calls: FetchCall[] = []
    const fetchPage: FetchRecentPaymentsPage = async (cursor, limit) => {
      calls.push([cursor, limit])
      return []
    }

    await collectAllRecentApprovedPayments(fetchPage)

    expect(calls).toEqual([[null, RECENT_PAYMENTS_PAGE_SIZE]])
  })

  it('14. timestamp duplicado usa id como desempate sin perder filas', async () => {
    const rows = payments(1_001)
    rows[1_000] = payment(1_000, {
      paid_at: rows[999].paid_at,
      created_at: rows[999].created_at,
    })
    const calls: FetchCall[] = []

    const result = await collectAllRecentApprovedPayments(
      keysetPageFetcher(rows, calls),
    )

    expect(result).toEqual(rows)
    expect(calls[1]?.[0]).toEqual(cursorFromRecentPayment(rows[999]))
    expect(compareRecentPaymentKeys(rows[999], rows[1_000])).toBeLessThan(0)
  })

  it('15. rechaza claves duplicadas o paginas regresivas', async () => {
    const duplicate = payment(0)
    await expect(
      collectAllRecentApprovedPayments(async () => [duplicate, duplicate]),
    ).rejects.toBeInstanceOf(RangeError)

    await expect(
      collectAllRecentApprovedPayments(async () => [payment(1), payment(0)]),
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('16. una pagina completa sin cursor valido produce RangeError', async () => {
    const invalidIdPage = payments(RECENT_PAYMENTS_PAGE_SIZE)
    invalidIdPage[999] = payment(999, { id: 'not-a-uuid' })
    const invalidTimestampPage = payments(RECENT_PAYMENTS_PAGE_SIZE)
    invalidTimestampPage[999] = payment(999, {
      paid_at: 'not-a-timestamp',
    })

    await expect(
      collectAllRecentApprovedPayments(async () => invalidIdPage),
    ).rejects.toBeInstanceOf(RangeError)
    await expect(
      collectAllRecentApprovedPayments(async () => invalidTimestampPage),
    ).rejects.toBeInstanceOf(RangeError)
    expect(() =>
      cursorFromRecentPayment(payment(0, { paid_at: '' })),
    ).toThrow(RangeError)
    expect(() =>
      cursorFromRecentPayment(payment(0, { paid_at: 'not-a-timestamp' })),
    ).toThrow(RangeError)
    expect(() =>
      buildPostgrestRecentPaymentsCursorFilter({
        paid_at: '2026-01-01T00:00:00Z),id.gt.injected',
        id: syntheticUuid(1),
      }),
    ).toThrow(RangeError)
    expect(() =>
      buildPostgrestRecentPaymentsCursorFilter({
        paid_at: '2026-01-01T00:00:00Z',
        id: `${syntheticUuid(1)}\n`,
      }),
    ).toThrow(RangeError)
    expect(() =>
      buildPostgrestRecentPaymentsCursorFilter({
        paid_at: '2026-01-01T00:00:00Z\n',
        id: syntheticUuid(1),
      }),
    ).toThrow(RangeError)
  })

  it('17. eliminar una fila anterior al cursor no salta la fila 1001 original', async () => {
    const originalRows = payments(1_001)
    const originalRow1001 = originalRows[1_000]
    let mutableRows = [...originalRows]
    let calls = 0
    const fetchPage: FetchRecentPaymentsPage = async (cursor, limit) => {
      calls += 1
      const page = mutableRows
        .filter(
          (row) =>
            cursor === null || databaseKeyIsAfterCursor(row, cursor),
        )
        .slice(0, limit)

      if (calls === 1) {
        mutableRows = mutableRows.filter((_, index) => index !== 100)
      }

      return page
    }

    const result = await collectAllRecentApprovedPayments(fetchPage)

    expect(calls).toBe(2)
    expect(result).toHaveLength(1_001)
    expect(result.at(-1)).toEqual(originalRow1001)
  })
})
