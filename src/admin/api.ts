import { supabase, supabaseConfigError } from '../lib/supabase'
import type {
  AssignMembershipInput,
  Activity,
  AdminActionResult,
  AdminStorageFile,
  AdminStudentFile,
  AdminTrainingNote,
  AttendanceSessionRow,
  AttendanceStatus,
  AutoFinalizeAttendanceResult,
  CalendarSession,
  ClassSessionInput,
  ClassRecurringRule,
  ClassRecurringRuleInput,
  CreateStudentInput,
  FixedScheduleCancelPreview,
  FixedScheduleCancelResult,
  FixedScheduleOption,
  FixedScheduleResult,
  MassEmailInput,
  MassEmailResult,
  Membership,
  Payment,
  PaymentStatus,
  Plan,
  ActivityInput,
  PlanInput,
  RegisterPaymentInput,
  RegisterPaymentResult,
  StudentFixedSchedule,
  StudentProgram,
  StudentFileMetadataInput,
  StudentProfile,
  UpdateClassSessionInput,
  UpdatePaymentInput,
  UpdateStudentPasswordInput,
  UpdateStudentProgramInput,
  UpdateStudentInput,
  UploadStudentFileInput,
  UploadStudentFileResult,
  UpsertTrainingNoteInput,
  DriveStatusResult,
  DriveCleanupResult,
} from './types'

export type DeleteClassSessionScope = 'single' | 'series'

function getClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'La app no esta configurada.')
  }

  return supabase
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      error_description?: unknown
      details?: unknown
      hint?: unknown
    }
    for (const value of [
      candidate.message,
      candidate.error_description,
      candidate.details,
      candidate.hint,
    ]) {
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }
  }

  return 'No se pudo completar la operacion.'
}

export function formatAdminError(error: unknown) {
  return getErrorMessage(error)
}

async function throwEdgeFunctionError(error: unknown): Promise<never> {
  const response =
    error && typeof error === 'object' && 'context' in error
      ? error.context
      : null

  if (response instanceof Response) {
    const body = await response.json().catch(() => null)
    if (body && typeof body.error === 'string') {
      throw new Error(body.error)
    }
  }

  throw error instanceof Error ? error : new Error(getErrorMessage(error))
}

export async function listStudents() {
  const client = getClient()
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, role, first_name, last_name, email, phone, active, receives_emails, notes, last_payment_at, last_real_activity_at, created_at, updated_at',
    )
    .eq('role', 'student')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as StudentProfile[]
}

export async function createStudent(input: CreateStudentInput) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('create-student', {
    body: input,
  })

  if (error) {
    throw new Error(
      `${error.message}. Si el alta no esta disponible, revisa la configuracion del sistema.`,
    )
  }

  return data
}

export async function updateStudent(
  studentId: string,
  input: UpdateStudentInput,
) {
  const client = getClient()
  const { error } = await client
    .from('profiles')
    .update({
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      phone: input.phone.trim() || null,
      active: input.active,
      receives_emails: input.receives_emails,
    })
    .eq('id', studentId)

  if (error) {
    throw error
  }
}

export async function updateStudentPassword(input: UpdateStudentPasswordInput) {
  const client = getClient()
  const { data, error } = await client.functions.invoke(
    'update-student-password',
    {
      body: input,
    },
  )

  if (error) {
    await throwEdgeFunctionError(error)
  }

  return data as AdminActionResult
}

export async function deactivateStudent(studentId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_deactivate_student', {
    p_student_id: studentId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function deleteStudent(studentId: string) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('delete-student', {
    body: { student_id: studentId },
  })

  if (error) {
    await throwEdgeFunctionError(error)
  }

  return data as AdminActionResult
}

export async function listPlans() {
  const client = getClient()
  const { data, error } = await client
    .from('plans')
    .select(
      'id, name, slug, description, price, billing_period_days, plan_type, package_class_count, active, visible_to_students, max_active_memberships, memberships(id), plan_activities(activity_id, monthly_credits, weekly_class_limit, activities(id, name, slug, description, requires_24h_cancel, flexible_schedule, active, color_hex, default_capacity, max_capacity, booking_cutoff_hours, cancellation_cutoff_hours))',
    )
    .order('active', { ascending: false })
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as unknown as Plan[]
}

export async function listActivities(includeInactive = false) {
  const client = getClient()
  let query = client
    .from('activities')
    .select(
      'id, name, slug, description, requires_24h_cancel, flexible_schedule, active, color_hex, default_capacity, max_capacity, booking_cutoff_hours, cancellation_cutoff_hours',
    )
    .order('name', { ascending: true })

  if (!includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data ?? []) as Activity[]
}

function planRpcInput(input: PlanInput) {
  return {
    p_name: input.name.trim(),
    p_description: input.description.trim() || null,
    p_price: input.price,
    p_billing_period_days: input.billing_period_days,
    p_plan_type: input.plan_type,
    p_package_class_count: input.package_class_count,
    p_active: input.active,
    p_activities: input.activities,
    p_visible_to_students: input.visible_to_students,
    p_max_active_memberships: input.max_active_memberships,
  }
}

function activityRpcInput(input: ActivityInput) {
  return {
    p_name: input.name.trim(),
    p_description: input.description.trim() || null,
    p_requires_24h_cancel: input.requires_24h_cancel,
    p_flexible_schedule: input.flexible_schedule,
    p_active: input.active,
    p_color_hex: input.color_hex.trim() || null,
    p_default_capacity: input.default_capacity,
    p_max_capacity: input.max_capacity,
    p_booking_cutoff_hours: input.booking_cutoff_hours ?? 3,
    p_cancellation_cutoff_hours: input.cancellation_cutoff_hours ?? 3,
  }
}

export async function createPlan(input: PlanInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_create_plan', {
    ...planRpcInput(input),
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function updatePlan(planId: string, input: PlanInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_plan', {
    p_plan_id: planId,
    ...planRpcInput(input),
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function archivePlan(planId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_archive_plan', {
    p_plan_id: planId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function deletePlan(planId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_delete_plan', {
    p_plan_id: planId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function createActivity(input: ActivityInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_create_activity', {
    ...activityRpcInput(input),
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function updateActivity(activityId: string, input: ActivityInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_activity', {
    p_activity_id: activityId,
    ...activityRpcInput(input),
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function archiveActivity(activityId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_archive_activity', {
    p_activity_id: activityId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function deleteActivity(activityId: string, confirm: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_delete_activity', {
    p_activity_id: activityId,
    p_confirm: confirm,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function listMemberships(studentId?: string) {
  const client = getClient()
  let query = client
    .from('memberships')
    .select(
      'id, student_id, plan_id, status, start_date, end_date, remaining_credits, created_at, updated_at',
    )
    .order('created_at', { ascending: false })

  if (studentId) {
    query = query.eq('student_id', studentId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data ?? []) as Membership[]
}

export async function listStudentPrograms(studentId?: string | null) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_student_programs', {
    p_student_id: studentId ?? null,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as StudentProgram[]
}

export async function assignMembership(input: AssignMembershipInput) {
  const client = getClient()
  const { data, error } = await client.rpc('assign_membership', {
    student_id: input.student_id,
    plan_id: input.plan_id,
    start_date: input.start_date,
    end_date: input.end_date,
    remaining_credits: input.remaining_credits,
  })

  if (error) {
    throw error
  }

  return data
}

export async function updateStudentProgram(input: UpdateStudentProgramInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_student_program', {
    p_program_id: input.program_id,
    p_plan_id: input.plan_id,
    p_status: input.status,
    p_start_date: input.start_date,
    p_end_date: input.end_date,
    p_remaining_credits: input.remaining_credits,
    p_confirm_history: input.confirm_history ?? null,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function deleteStudentProgram(
  programId: string,
  confirmation: string,
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_delete_student_program', {
    p_program_id: programId,
    p_confirm: confirmation,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function listFixedScheduleOptionsForStudent(
  studentId: string,
  membershipId: string,
) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_list_fixed_schedule_options_for_student',
    {
      p_student_id: studentId,
      p_membership_id: membershipId,
    },
  )

  if (error) {
    throw error
  }

  return (data ?? []) as FixedScheduleOption[]
}

export async function previewFixedScheduleForStudent(input: {
  student_id: string
  membership_id: string
  weekdays: number[]
  start_time: string
}) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_preview_fixed_schedule_for_student',
    {
      p_student_id: input.student_id,
      p_membership_id: input.membership_id,
      p_weekdays: input.weekdays,
      p_start_time: input.start_time,
    },
  )

  if (error) {
    throw error
  }

  return data as FixedScheduleResult
}

export async function bulkBookFixedScheduleForStudent(input: {
  student_id: string
  membership_id: string
  weekdays: number[]
  start_time: string
}) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_bulk_book_fixed_schedule_for_student',
    {
      p_student_id: input.student_id,
      p_membership_id: input.membership_id,
      p_weekdays: input.weekdays,
      p_start_time: input.start_time,
    },
  )

  if (error) {
    throw error
  }

  return data as FixedScheduleResult
}

export async function listStudentFixedSchedules(studentId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_student_fixed_schedules', {
    p_student_id: studentId,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as StudentFixedSchedule[]
}

export async function deactivateStudentFixedSchedule(scheduleId: string) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_deactivate_student_fixed_schedule',
    {
      p_schedule_id: scheduleId,
    },
  )

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function previewCancelFixedScheduleBookings(input: {
  schedule_id: string
  cancel_past: boolean
}) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_preview_cancel_fixed_schedule_bookings',
    {
      p_schedule_id: input.schedule_id,
      p_cancel_past: input.cancel_past,
    },
  )

  if (error) {
    throw error
  }

  return data as FixedScheduleCancelPreview
}

export async function cancelFixedScheduleBookings(input: {
  schedule_id: string
  reason: string
  cancel_past: boolean
}) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_cancel_fixed_schedule_bookings',
    {
      p_schedule_id: input.schedule_id,
      p_reason: input.reason,
      p_cancel_past: input.cancel_past,
    },
  )

  if (error) {
    throw error
  }

  return data as FixedScheduleCancelResult
}

export async function listPayments(status?: PaymentStatus | 'all') {
  const client = getClient()
  let query = client
    .from('payments')
    .select(
      'id, student_id, membership_id, amount, method, status, paid_at, approved_at, rejected_at, voided_at, voided_by, void_reason, membership_start_date, membership_end_date, notes, created_at, updated_at',
    )
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data ?? []) as Payment[]
}

export async function registerManualPayment(input: RegisterPaymentInput) {
  const client = getClient()
  const { data, error } = await client.rpc('register_manual_payment', {
    student_id: input.student_id,
    membership_id: input.membership_id,
    amount: input.amount,
    method: input.method,
    notes: input.notes.trim() || null,
    payment_date: input.payment_date,
    membership_start_date: input.membership_start_date,
    membership_end_date: input.membership_end_date,
  })

  if (error) {
    throw error
  }

  return data as RegisterPaymentResult
}

export async function approveManualPayment(paymentId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('approve_manual_payment', {
    payment_id: paymentId,
  })

  if (error) {
    throw error
  }

  return data
}

export async function rejectManualPayment(paymentId: string, reason: string) {
  const client = getClient()
  const { data, error } = await client.rpc('reject_manual_payment', {
    payment_id: paymentId,
    reason: reason.trim() || null,
  })

  if (error) {
    throw error
  }

  return data
}

export async function updatePayment(input: UpdatePaymentInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_payment', {
    p_payment_id: input.payment_id,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_at: input.payment_date,
    p_notes: input.notes.trim() || null,
    p_membership_start_date: input.membership_start_date,
    p_membership_end_date: input.membership_end_date,
  })

  if (error) {
    throw error
  }

  return data
}

export async function voidPayment(paymentId: string, reason: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_void_payment', {
    p_payment_id: paymentId,
    p_reason: reason.trim(),
  })

  if (error) {
    throw error
  }

  return data
}

export async function listCalendarSessions(fromDate: string, toDate: string) {
  const client = getClient()
  const { error: materializeError } = await client.rpc(
    'materialize_recurring_class_sessions',
    {
      from_date: fromDate,
      to_date: toDate,
    },
  )

  if (materializeError) {
    throw materializeError
  }

  const { data, error } = await client.rpc('list_calendar_sessions', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return hydrateCalendarSessionColors(client, (data ?? []) as CalendarSession[])
}

async function hydrateCalendarSessionColors(
  client: ReturnType<typeof getClient>,
  sessions: CalendarSession[],
) {
  const missingColorActivityIds = Array.from(
    new Set(
      sessions
        .filter((session) => !session.activity_color_hex)
        .map((session) => session.activity_id),
    ),
  )

  if (missingColorActivityIds.length === 0) {
    return sessions
  }

  const { data, error } = await client
    .from('activities')
    .select('id, color_hex')
    .in('id', missingColorActivityIds)

  if (error) {
    return sessions
  }

  const colorsByActivity = new Map(
    (data ?? []).map((activity) => [activity.id, activity.color_hex]),
  )

  return sessions.map((session) => ({
    ...session,
    activity_color_hex:
      session.activity_color_hex ?? colorsByActivity.get(session.activity_id) ?? null,
  }))
}

export async function listClassRecurringRules() {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_class_recurring_rules')

  if (error) {
    throw error
  }

  return (data ?? []) as ClassRecurringRule[]
}

export async function createClassRecurringRule(
  input: ClassRecurringRuleInput,
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_create_class_recurring_rule', {
    p_activity_id: input.activity_id,
    p_title: input.title,
    p_weekday: input.weekday,
    p_start_time: input.start_time,
    p_end_time: input.end_time,
    p_capacity: input.capacity,
    p_trainer_name: input.trainer_name.trim() || null,
    p_notes: input.notes.trim() || null,
    p_valid_from: input.valid_from,
    p_valid_until: null,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function convertClassSessionToRecurringRule(sessionId: string) {
  const client = getClient()
  const { data, error } = await client.rpc(
    'admin_convert_class_session_to_recurring_rule',
    {
      p_session_id: sessionId,
    },
  )

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function archiveClassRecurringRule(ruleId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_archive_class_recurring_rule', {
    p_rule_id: ruleId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function createClassSession(input: ClassSessionInput) {
  const client = getClient()
  const { data, error } = await client.rpc('create_class_session', {
    activity_id: input.activity_id,
    title: input.title,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    capacity: input.capacity,
    coach_name: input.coach_name.trim() || null,
    notes: input.notes.trim() || null,
  })

  if (error) {
    throw error
  }

  return data
}

export async function updateClassSession(input: UpdateClassSessionInput) {
  const client = getClient()
  const { data, error } = await client.rpc('update_class_session', {
    session_id: input.session_id,
    activity_id: input.activity_id,
    title: input.title,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    capacity: input.capacity,
    coach_name: input.coach_name.trim() || null,
    notes: input.notes.trim() || null,
    active: input.active,
  })

  if (error) {
    throw error
  }

  return data
}

export async function cancelClassSession(sessionId: string, reason: string) {
  const client = getClient()
  const { data, error } = await client.rpc('cancel_class_session', {
    session_id: sessionId,
    reason: reason.trim() || null,
  })

  if (error) {
    throw error
  }

  return data
}

export async function deleteClassSession(
  sessionId: string,
  scope?: DeleteClassSessionScope,
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_delete_class_session', {
    p_session_id: sessionId,
    p_scope: scope ?? null,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function listAttendanceSessions(fromDate: string, toDate: string) {
  const client = getClient()
  const materializeToDate = toDate <= fromDate ? addDays(fromDate, 1) : toDate
  const { error: materializeError } = await client.rpc(
    'materialize_recurring_class_sessions',
    {
      from_date: fromDate,
      to_date: materializeToDate,
    },
  )

  if (materializeError) {
    throw materializeError
  }

  const { data, error } = await client.rpc('list_attendance_sessions', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as AttendanceSessionRow[]
}

export async function listCalendarSessionsForStudent(
  studentId: string,
  fromDate: string,
  toDate: string,
) {
  const client = getClient()
  const materializeToDate = toDate <= fromDate ? addDays(fromDate, 1) : toDate
  const { error: materializeError } = await client.rpc(
    'materialize_recurring_class_sessions',
    {
      from_date: fromDate,
      to_date: materializeToDate,
    },
  )

  if (materializeError) {
    throw materializeError
  }

  const { data, error } = await client.rpc(
    'admin_list_calendar_sessions_for_student',
    {
      p_student_id: studentId,
      from_date: fromDate,
      to_date: toDate,
    },
  )

  if (error) {
    throw error
  }

  return hydrateCalendarSessionColors(client, (data ?? []) as CalendarSession[])
}

export async function adminBookClassForStudent(
  studentId: string,
  sessionId: string,
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_book_class_for_student', {
    p_student_id: studentId,
    p_session_id: sessionId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function autoFinalizeAttendance(fromDate: string, toDate: string) {
  const client = getClient()
  const { data, error } = await client.rpc('auto_finalize_attendance', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return data as AutoFinalizeAttendanceResult
}

export async function markAttendance(
  bookingId: string,
  status: AttendanceStatus,
  notes: string,
) {
  const client = getClient()
  const { data, error } = await client.rpc('mark_attendance', {
    booking_id: bookingId,
    status,
    notes: notes.trim() || null,
  })

  if (error) {
    throw error
  }

  return data
}

export async function adminCancelBooking(bookingId: string, reason: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_cancel_booking', {
    p_booking_id: bookingId,
    p_reason: reason.trim() || null,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
}

export async function listStudentTrainingNotes(studentId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_student_training_notes', {
    p_student_id: studentId,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as AdminTrainingNote[]
}

export async function upsertTrainingNote(input: UpsertTrainingNoteInput) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_upsert_training_note', {
    note_id: input.note_id ?? null,
    student_id: input.student_id,
    note_type: input.note_type,
    title: input.title,
    body: input.body,
    visible_to_student: input.visible_to_student,
  })

  if (error) {
    throw error
  }

  return data
}

export async function archiveTrainingNote(noteId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_archive_training_note', {
    note_id: noteId,
  })

  if (error) {
    throw error
  }

  return data
}

export async function listStudentFiles(studentId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_list_student_files', {
    p_student_id: studentId,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as AdminStudentFile[]
}

function parseOptionalSize(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('El tamano debe ser un numero mayor o igual a cero.')
  }

  return Math.trunc(parsed)
}

export async function createStudentFileMetadata(
  input: StudentFileMetadataInput,
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_create_student_file_metadata', {
    student_id: input.student_id,
    kind: input.kind,
    title: input.title,
    drive_url: input.drive_url.trim() || null,
    description: input.description.trim() || null,
    mime_type: input.mime_type.trim() || null,
    size_bytes: parseOptionalSize(input.size_bytes),
    visible_to_student: input.visible_to_student,
  })

  if (error) {
    throw error
  }

  return data
}

export async function updateStudentFileMetadata(
  input: StudentFileMetadataInput & { file_id: string },
) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_update_student_file_metadata', {
    file_id: input.file_id,
    kind: input.kind,
    title: input.title,
    drive_url: input.drive_url.trim() || null,
    description: input.description.trim() || null,
    mime_type: input.mime_type.trim() || null,
    size_bytes: parseOptionalSize(input.size_bytes),
    visible_to_student: input.visible_to_student,
  })

  if (error) {
    throw error
  }

  return data
}

export async function archiveStudentFileMetadata(fileId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_archive_student_file_metadata', {
    file_id: fileId,
  })

  if (error) {
    throw error
  }

  return data
}

export async function uploadStudentFile(input: UploadStudentFileInput) {
  const client = getClient()
  const formData = new FormData()
  formData.append('student_id', input.student_id)
  formData.append('kind', input.kind)
  formData.append('title', input.title)
  formData.append('description', input.description)
  formData.append('visible_to_student', String(input.visible_to_student))
  formData.append('file', input.file)

  const { data, error } = await client.functions.invoke('upload-student-file', {
    body: formData,
  })

  if (error) {
    throw error
  }

  return data as UploadStudentFileResult
}

export async function checkDriveStatus() {
  const client = getClient()
  const { data, error } = await client.functions.invoke('check-drive-status', {
    body: {},
  })

  if (error) {
    throw error
  }

  return data as DriveStatusResult
}

export async function previewDriveCleanup(maxFiles = 50) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('cleanup-drive-files', {
    body: {
      dryRun: true,
      force: false,
      maxFiles,
      studentId: null,
    },
  })

  if (error) {
    await throwEdgeFunctionError(error)
  }

  return data as DriveCleanupResult
}

export async function listDriveStorageFiles() {
  const client = getClient()
  const { data: files, error: filesError } = await client
    .from('files')
    .select(
      'id, student_id, title, kind, drive_file_id, drive_url, size_bytes, visible_to_student, created_at, archived_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (filesError) {
    throw filesError
  }

  const studentIds = [
    ...new Set((files ?? []).map((file) => file.student_id).filter(Boolean)),
  ]

  const { data: students, error: studentsError } =
    studentIds.length > 0
      ? await client
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', studentIds)
      : { data: [], error: null }

  if (studentsError) {
    throw studentsError
  }

  const studentsById = new Map(
    (students ?? []).map((student) => [
      student.id,
      {
        name: [student.first_name, student.last_name].filter(Boolean).join(' '),
        email: student.email as string | null,
      },
    ]),
  )

  return (files ?? []).map((file) => {
    const student = studentsById.get(file.student_id)
    return {
      ...file,
      student_name: student?.name || null,
      student_email: student?.email ?? null,
    }
  }) as AdminStorageFile[]
}

export async function runDriveCleanup(fileIds: string[], maxFiles = 50) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('cleanup-drive-files', {
    body: {
      dryRun: false,
      force: true,
      maxFiles,
      studentId: null,
      fileIds,
    },
  })

  if (error) {
    await throwEdgeFunctionError(error)
  }

  return data as DriveCleanupResult
}

export async function deleteStudentDriveFile(fileId: string) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('cleanup-drive-files', {
    body: {
      dryRun: false,
      force: true,
      fileId,
    },
  })

  if (error) {
    await throwEdgeFunctionError(error)
  }

  return data as DriveCleanupResult
}

export async function sendMassEmail(input: MassEmailInput) {
  const client = getClient()
  const { data, error } = await client.functions.invoke('send-mass-email', {
    body: {
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      dryRun: input.dryRun,
    },
  })

  if (error) {
    throw error
  }

  return data as MassEmailResult
}
