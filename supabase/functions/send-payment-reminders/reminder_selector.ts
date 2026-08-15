import {
  addDaysToDate,
  evaluateReminderCandidate,
  type ReminderCandidate,
  type ReminderOffset,
} from './reminder_logic.ts'

export const MEMBERSHIP_PAGE_SIZE = 1_000
export const PROFILE_BATCH_SIZE = 500

export type MembershipRow = {
  id: string
  student_id: string
  status: string
  start_date: string
  end_date: string
}

export type StudentProfileRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  active: boolean
  receives_payment_reminders: boolean
}

export type SelectedReminderCandidate = {
  student_id: string
  membership_id: string
  student_first_name: string
  student_last_name: string
  recipient_email: string
  due_date: string
  offset_days: ReminderOffset
  idempotency_key: string
}

export type ExcludedReminderCandidate = {
  student_id: string
  membership_id: string
  recipient_email: string | null
  due_date: string
  reason: string
}

export type ReminderSelectionResult = {
  eligible: SelectedReminderCandidate[]
  excluded: ExcludedReminderCandidate[]
}

export type MembershipCursor = {
  end_date: string
  id: string
}

export type ReminderSelectorDependencies = {
  fetchMembershipPage: (input: {
    evaluationDate: string
    evaluationWindowEnd: string
    cursor: MembershipCursor | null
    limit: number
  }) => Promise<MembershipRow[]>
  fetchProfilesByIds: (studentIds: string[]) => Promise<StudentProfileRow[]>
}

type QueryResult = {
  data: unknown
  error: unknown
}

type ReminderQueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string) => ReminderQueryBuilder
  gte: (column: string, value: string) => ReminderQueryBuilder
  lte: (column: string, value: string) => ReminderQueryBuilder
  order: (
    column: string,
    options: { ascending: boolean },
  ) => ReminderQueryBuilder
  or: (filter: string) => ReminderQueryBuilder
  limit: (count: number) => ReminderQueryBuilder
  in: (column: string, values: string[]) => ReminderQueryBuilder
  eq: (column: string, value: string) => ReminderQueryBuilder
}

export type ReminderSelectorClient = {
  from: (table: string) => ReminderQueryBuilder
}

export class ReminderSelectorError extends Error {
  readonly code:
    | 'memberships_query_failed'
    | 'profiles_query_failed'
    | 'memberships_page_invalid'

  constructor(
    code:
      | 'memberships_query_failed'
      | 'profiles_query_failed'
      | 'memberships_page_invalid',
  ) {
    super(code)
    this.name = 'ReminderSelectorError'
    this.code = code
  }
}

export function createReminderSelectorDependencies(
  client: ReminderSelectorClient,
): ReminderSelectorDependencies {
  return {
    async fetchMembershipPage(input) {
      let query = client
        .from('memberships')
        .select('id, student_id, status, start_date, end_date')
        .gte('end_date', input.evaluationDate)
        .lte('end_date', input.evaluationWindowEnd)

      if (input.cursor !== null) {
        query = query.or(
          `end_date.gt.${input.cursor.end_date},and(end_date.eq.${input.cursor.end_date},id.gt.${input.cursor.id})`,
        )
      }

      const { data, error } = await query
        .order('end_date', { ascending: true })
        .order('id', { ascending: true })
        .limit(input.limit)

      if (error) {
        throw new ReminderSelectorError('memberships_query_failed')
      }

      return (data ?? []) as MembershipRow[]
    },

    async fetchProfilesByIds(studentIds) {
      const { data, error } = await client
        .from('profiles')
        .select(
          'id, first_name, last_name, email, active, receives_payment_reminders',
        )
        .in('id', studentIds)
        .eq('role', 'student')

      if (error) {
        throw new ReminderSelectorError('profiles_query_failed')
      }

      return (data ?? []) as StudentProfileRow[]
    },
  }
}

function isAfterCursor(row: MembershipRow, cursor: MembershipCursor) {
  return (
    row.end_date > cursor.end_date ||
    (row.end_date === cursor.end_date && row.id > cursor.id)
  )
}

export async function selectPaymentReminderCandidates(
  evaluationDate: string,
  dependencies: ReminderSelectorDependencies,
): Promise<ReminderSelectionResult> {
  const evaluationWindowEnd = addDaysToDate(evaluationDate, 5)
  const membershipRows: MembershipRow[] = []
  let cursor: MembershipCursor | null = null

  for (;;) {
    const page = await dependencies.fetchMembershipPage({
      evaluationDate,
      evaluationWindowEnd,
      cursor,
      limit: MEMBERSHIP_PAGE_SIZE,
    })

    if (page.length > MEMBERSHIP_PAGE_SIZE) {
      throw new ReminderSelectorError('memberships_page_invalid')
    }

    let previousCursor = cursor
    for (const row of page) {
      if (previousCursor !== null && !isAfterCursor(row, previousCursor)) {
        throw new ReminderSelectorError('memberships_page_invalid')
      }
      previousCursor = { end_date: row.end_date, id: row.id }
    }

    membershipRows.push(...page)

    if (page.length < MEMBERSHIP_PAGE_SIZE) {
      break
    }

    const lastRow = page[page.length - 1]
    cursor = { end_date: lastRow.end_date, id: lastRow.id }
  }

  const studentIds = [
    ...new Set(membershipRows.map((membership) => membership.student_id)),
  ]
  const profileRows: StudentProfileRow[] = []

  for (let from = 0; from < studentIds.length; from += PROFILE_BATCH_SIZE) {
    const batch = studentIds.slice(from, from + PROFILE_BATCH_SIZE)
    profileRows.push(...(await dependencies.fetchProfilesByIds(batch)))
  }

  const profileById = new Map(
    profileRows.map((studentProfile) => [studentProfile.id, studentProfile]),
  )
  const eligible: SelectedReminderCandidate[] = []
  const excluded: ExcludedReminderCandidate[] = []

  for (const membershipRow of membershipRows) {
    const studentProfile = profileById.get(membershipRow.student_id)
    if (!studentProfile) {
      excluded.push({
        student_id: membershipRow.student_id,
        membership_id: membershipRow.id,
        recipient_email: null,
        due_date: membershipRow.end_date,
        reason: 'student_profile_not_found',
      })
      continue
    }

    const candidate: ReminderCandidate = {
      membership_id: membershipRow.id,
      student_id: membershipRow.student_id,
      student_first_name: studentProfile.first_name,
      student_last_name: studentProfile.last_name,
      email: studentProfile.email,
      student_active: studentProfile.active,
      receives_payment_reminders:
        studentProfile.receives_payment_reminders,
      membership_status: membershipRow.status,
      start_date: membershipRow.start_date,
      end_date: membershipRow.end_date,
    }
    const evaluation = evaluateReminderCandidate(candidate, evaluationDate)

    if (
      evaluation.eligible &&
      evaluation.offset_days !== null &&
      evaluation.idempotency_key !== null
    ) {
      eligible.push({
        student_id: candidate.student_id,
        membership_id: candidate.membership_id,
        student_first_name: candidate.student_first_name,
        student_last_name: candidate.student_last_name,
        recipient_email: candidate.email,
        due_date: candidate.end_date,
        offset_days: evaluation.offset_days,
        idempotency_key: evaluation.idempotency_key,
      })
      continue
    }

    excluded.push({
      student_id: candidate.student_id,
      membership_id: candidate.membership_id,
      recipient_email: candidate.email,
      due_date: candidate.end_date,
      reason: evaluation.reason,
    })
  }

  return { eligible, excluded }
}
