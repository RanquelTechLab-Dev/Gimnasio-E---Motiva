import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { getDateInTimeZone } from './reminder_logic'
import {
  selectPaymentReminderCandidates,
  type MembershipRow,
  type ReminderSelectorDependencies,
  type StudentProfileRow,
} from './reminder_selector'

const EVALUATION_DATE = '2026-03-01'
const functionDirectory = dirname(fileURLToPath(import.meta.url))
const selectorSource = readFileSync(
  resolve(functionDirectory, 'reminder_selector.ts'),
  'utf8',
)

function membership(
  overrides: Partial<MembershipRow> = {},
): MembershipRow {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    student_id: '00000000-0000-4000-8000-000000000201',
    status: 'active',
    start_date: '2026-02-01',
    end_date: '2026-03-06',
    ...overrides,
  }
}

function profile(
  overrides: Partial<StudentProfileRow> = {},
): StudentProfileRow {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.invalid',
    active: true,
    receives_payment_reminders: true,
    ...overrides,
  }
}

function selectorDependencies(input: {
  memberships?: MembershipRow[]
  profiles?: StudentProfileRow[]
} = {}): ReminderSelectorDependencies {
  const memberships = input.memberships ?? [membership()]
  const profiles = input.profiles ?? [profile()]

  return {
    fetchMembershipPage: vi
      .fn()
      .mockImplementation(async ({ cursor, limit }) => {
        const start =
          cursor === null
            ? 0
            : memberships.findIndex(
                (row) =>
                  row.end_date > cursor.end_date ||
                  (row.end_date === cursor.end_date && row.id > cursor.id),
              )
        return start < 0 ? [] : memberships.slice(start, start + limit)
      }),
    fetchProfilesByIds: vi
      .fn()
      .mockImplementation(async (ids) =>
        profiles.filter((row) => ids.includes(row.id)),
      ),
  }
}

describe('RAN-36 B3A reusable scheduled selector', () => {
  it.each([
    ['2026-03-06', 5],
    ['2026-03-04', 3],
    ['2026-03-02', 1],
    ['2026-03-01', 0],
  ] as const)('1. selects a membership due in %i scheduled days', async (endDate, offset) => {
    const result = await selectPaymentReminderCandidates(
      EVALUATION_DATE,
      selectorDependencies({
        memberships: [membership({ end_date: endDate })],
      }),
    )

    expect(result.eligible).toHaveLength(1)
    expect(result.eligible[0]).toMatchObject({
      due_date: endDate,
      offset_days: offset,
      recipient_email: 'ada@example.invalid',
    })
  })

  it.each([
    ['2026-03-03', 'offset_not_scheduled'],
    ['2026-03-05', 'offset_not_scheduled'],
  ] as const)('2. excludes non-scheduled due date %s', async (endDate, reason) => {
    const result = await selectPaymentReminderCandidates(
      EVALUATION_DATE,
      selectorDependencies({
        memberships: [membership({ end_date: endDate })],
      }),
    )

    expect(result.eligible).toHaveLength(0)
    expect(result.excluded).toEqual([
      expect.objectContaining({ reason }),
    ])
  })

  it.each([
    ['student inactive', profile({ active: false }), membership(), 'student_inactive'],
    ['invalid email', profile({ email: 'invalid' }), membership(), 'invalid_email'],
    [
      'payment reminders disabled',
      profile({ receives_payment_reminders: false }),
      membership(),
      'payment_reminders_disabled',
    ],
    [
      'membership inactive',
      profile(),
      membership({ status: 'suspended' }),
      'membership_not_active',
    ],
    [
      'membership starts in the future',
      profile(),
      membership({ start_date: '2026-03-02' }),
      'membership_not_started',
    ],
    [
      'membership is expired',
      profile(),
      membership({ end_date: '2026-02-28' }),
      'membership_ended',
    ],
  ] as const)(
    '3. excludes %s',
    async (_label, candidateProfile, candidateMembership, reason) => {
      const result = await selectPaymentReminderCandidates(
        EVALUATION_DATE,
        selectorDependencies({
          memberships: [candidateMembership],
          profiles: [candidateProfile],
        }),
      )

      expect(result.eligible).toHaveLength(0)
      expect(result.excluded).toEqual([
        expect.objectContaining({ reason }),
      ])
    },
  )

  it.each([
    ['month boundary', '2026-01-31', '2026-02-01', 1],
    ['leap year', '2024-02-28', '2024-02-29', 1],
    ['year boundary', '2026-12-31', '2027-01-01', 1],
  ] as const)(
    '4. handles %s deterministically',
    async (_label, evaluationDate, endDate, offset) => {
      const result = await selectPaymentReminderCandidates(
        evaluationDate,
        selectorDependencies({
          memberships: [
            membership({
              start_date: evaluationDate,
              end_date: endDate,
            }),
          ],
        }),
      )

      expect(result.eligible[0]?.offset_days).toBe(offset)
    },
  )

  it('5. resolves the production date in America/Argentina/Cordoba', () => {
    expect(getDateInTimeZone(new Date('2026-01-02T02:30:00.000Z'))).toBe(
      '2026-01-01',
    )
  })

  it('6. does not use receives_emails for scheduled reminders', async () => {
    const withoutNews = await selectPaymentReminderCandidates(
      EVALUATION_DATE,
      selectorDependencies(),
    )

    expect(withoutNews.eligible).toHaveLength(1)
    expect(JSON.stringify(withoutNews)).not.toContain('receives_emails')
  })

  it('7. paginates all memberships and batches every profile without loss', async () => {
    const memberships = Array.from({ length: 1_001 }, (_, index) =>
      membership({
        id: `membership-${String(index).padStart(4, '0')}`,
        student_id: `student-${String(index).padStart(4, '0')}`,
      }),
    )
    const profiles = memberships.map((row, index) =>
      profile({
        id: row.student_id,
        email: `student-${index}@example.invalid`,
      }),
    )
    const dependencies = selectorDependencies({ memberships, profiles })

    const result = await selectPaymentReminderCandidates(
      EVALUATION_DATE,
      dependencies,
    )

    expect(result.eligible).toHaveLength(1_001)
    expect(dependencies.fetchMembershipPage).toHaveBeenCalledTimes(2)
    expect(dependencies.fetchProfilesByIds).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(dependencies.fetchProfilesByIds).mock.calls.map(
        ([ids]) => ids.length,
      ),
    ).toEqual([500, 500, 1])
    expect(new Set(result.eligible.map((row) => row.membership_id)).size).toBe(
      1_001,
    )
  })

  it('8. preserves deterministic membership order', async () => {
    const memberships = [
      membership({
        id: 'membership-a',
        student_id: 'student-a',
        end_date: '2026-03-04',
      }),
      membership({
        id: 'membership-b',
        student_id: 'student-b',
        end_date: '2026-03-06',
      }),
    ]
    const profiles = [
      profile({ id: 'student-a', email: 'a@example.invalid' }),
      profile({ id: 'student-b', email: 'b@example.invalid' }),
    ]

    const result = await selectPaymentReminderCandidates(
      EVALUATION_DATE,
      selectorDependencies({ memberships, profiles }),
    )

    expect(result.eligible.map((row) => row.membership_id)).toEqual([
      'membership-a',
      'membership-b',
    ])
  })

  it('9. wires bounded keyset queries and the independent preference in runtime code', () => {
    expect(selectorSource).toContain(".gte('end_date', input.evaluationDate)")
    expect(selectorSource).toContain(".lte('end_date', input.evaluationWindowEnd)")
    expect(selectorSource).toContain(".order('end_date', { ascending: true })")
    expect(selectorSource).toContain(".order('id', { ascending: true })")
    expect(selectorSource).toContain('.limit(input.limit)')
    expect(selectorSource).toContain('end_date.gt.')
    expect(selectorSource).toContain('id.gt.')
    expect(selectorSource).toContain(".eq('role', 'student')")
    expect(selectorSource).not.toContain('.range(')
    expect(selectorSource).not.toContain('receives_emails')
  })

  it('10. rejects a duplicate or regressive keyset page', async () => {
    const row = membership()
    const dependencies = selectorDependencies()
    dependencies.fetchMembershipPage = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 1_000 }, () => row))

    await expect(
      selectPaymentReminderCandidates(EVALUATION_DATE, dependencies),
    ).rejects.toMatchObject({ code: 'memberships_page_invalid' })
  })
})
