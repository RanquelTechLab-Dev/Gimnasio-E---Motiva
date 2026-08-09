import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addDaysToDate,
  buildPaymentReminderIdempotencyKey,
  evaluateReminderCandidate,
  getDateInTimeZone,
  type ReminderCandidate,
  validateDryRunPayload,
} from './reminder_logic'

const EVALUATION_DATE = '2026-03-01'

function candidate(
  overrides: Partial<ReminderCandidate> = {},
): ReminderCandidate {
  return {
    membership_id: 'membership-fixture-01',
    student_id: 'student-fixture-01',
    student_first_name: 'Fixture',
    student_last_name: 'Alpha',
    email: 'fixture.alpha@example.invalid',
    student_active: true,
    receives_payment_reminders: true,
    receives_emails: true,
    membership_status: 'active',
    start_date: '2026-02-01',
    end_date: '2026-03-06',
    ...overrides,
  }
}

function expectEligible(
  endDate: string,
  offsetDays: 5 | 3 | 1 | 0,
) {
  const result = evaluateReminderCandidate(
    candidate({ end_date: endDate }),
    EVALUATION_DATE,
  )

  expect(result).toEqual({
    eligible: true,
    offset_days: offsetDays,
    reason: 'eligible',
    idempotency_key: `payment_due_reminder:membership-fixture-01:${endDate}:${offsetDays}`,
  })
}

describe('RAN-36 payment reminder contract', () => {
  it('1. selects a membership due in 5 days', () => {
    expectEligible('2026-03-06', 5)
  })

  it('2. selects a membership due in 3 days', () => {
    expectEligible('2026-03-04', 3)
  })

  it('3. selects a membership due in 1 day', () => {
    expectEligible('2026-03-02', 1)
  })

  it('4. selects a membership due today', () => {
    expectEligible('2026-03-01', 0)
  })

  it('5. excludes a membership due in 2 days', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ end_date: '2026-03-03' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('6. excludes a membership due in 4 days', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ end_date: '2026-03-05' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('7. excludes an inactive student', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ student_active: false }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('8. excludes an invalid email', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ email: 'invalid-email' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('9. excludes a student who disabled payment reminders', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ receives_payment_reminders: false }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('10. excludes a suspended membership', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ membership_status: 'suspended' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('11. excludes a cancelled membership', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ membership_status: 'cancelled' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('12. excludes an expired membership', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ membership_status: 'expired' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('13. excludes a membership whose start date is in the future', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ start_date: '2026-03-02' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('14. excludes a membership whose end date is past', () => {
    expect(
      evaluateReminderCandidate(
        candidate({ end_date: '2026-02-28' }),
        EVALUATION_DATE,
      ).eligible,
    ).toBe(false)
  })

  it('15. crosses from January into February', () => {
    expect(addDaysToDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('16. handles February in a non-leap year', () => {
    expect(addDaysToDate('2025-02-28', 1)).toBe('2025-03-01')
  })

  it('17. handles February in a leap year', () => {
    expect(addDaysToDate('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('18. crosses from December into January', () => {
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('19. resolves the Cordoba date near UTC midnight', () => {
    expect(getDateInTimeZone(new Date('2026-01-02T02:30:00.000Z'))).toBe(
      '2026-01-01',
    )
  })

  it('20. builds the exact idempotency key', () => {
    expect(
      buildPaymentReminderIdempotencyKey(
        'membership-fixture-01',
        '2026-03-06',
        5,
      ),
    ).toBe(
      'payment_due_reminder:membership-fixture-01:2026-03-06:5',
    )
  })

  it('21. returns exactly the same key for the same input', () => {
    const first = buildPaymentReminderIdempotencyKey(
      'membership-fixture-01',
      '2026-03-06',
      5,
    )
    const second = buildPaymentReminderIdempotencyKey(
      'membership-fixture-01',
      '2026-03-06',
      5,
    )

    expect(second).toBe(first)
  })

  it('22. stops matching the old offset after end_date is extended', () => {
    const beforeExtension = evaluateReminderCandidate(
      candidate({ end_date: '2026-03-06' }),
      EVALUATION_DATE,
    )
    const afterExtension = evaluateReminderCandidate(
      candidate({ end_date: '2026-04-06' }),
      EVALUATION_DATE,
    )

    expect(beforeExtension.eligible).toBe(true)
    expect(afterExtension).toMatchObject({
      eligible: false,
      offset_days: null,
      idempotency_key: null,
    })
  })

  it('23. ignores receives_emails when selecting payment reminders', () => {
    const optedOutOfNews = evaluateReminderCandidate(
      candidate({ receives_emails: false }),
      EVALUATION_DATE,
    )
    const optedIntoNews = evaluateReminderCandidate(
      candidate({ receives_emails: true }),
      EVALUATION_DATE,
    )

    expect(optedOutOfNews).toEqual(optedIntoNews)
    expect(optedOutOfNews.eligible).toBe(true)
  })

  const edgeFunctionSource = readFileSync(
    new URL('./index.ts', import.meta.url),
    'utf8',
  )

  it('24. contains no Mailjet URL', () => {
    expect(edgeFunctionSource).not.toMatch(/api\.mailjet\.com/i)
    expect(edgeFunctionSource).not.toMatch(/MAILJET_/)
  })

  it('25. contains no database insert call', () => {
    expect(edgeFunctionSource).not.toMatch(/\.insert\s*\(/)
    expect(edgeFunctionSource).not.toMatch(/\.upsert\s*\(/)
  })

  it('26. contains no database update call', () => {
    expect(edgeFunctionSource).not.toMatch(/\.update\s*\(/)
    expect(edgeFunctionSource).not.toMatch(/\.rpc\s*\(/)
  })

  it('27. contains no database delete call', () => {
    expect(edgeFunctionSource).not.toMatch(/\.delete\s*\(/)
  })

  it('28. rejects dryRun false with the frozen B1 message', () => {
    expect(validateDryRunPayload({ dryRun: false })).toEqual({
      valid: false,
      error: 'RAN-36 B1 solo permite dry-run.',
    })
    expect(edgeFunctionSource).toMatch(/validateDryRunPayload\(rawPayload\)/)
  })
})
