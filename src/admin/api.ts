import { supabase, supabaseConfigError } from '../lib/supabase'
import type {
  AssignMembershipInput,
  Activity,
  AttendanceSessionRow,
  AttendanceStatus,
  CalendarSession,
  ClassSessionInput,
  CreateStudentInput,
  Membership,
  Payment,
  PaymentStatus,
  Plan,
  RegisterPaymentInput,
  StudentProfile,
  UpdateClassSessionInput,
  UpdatePlanInput,
  UpdateStudentInput,
} from './types'

function getClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'Supabase no esta configurado.')
  }

  return supabase
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'No se pudo completar la operacion.'
}

export function formatAdminError(error: unknown) {
  return getErrorMessage(error)
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
      `${error.message}. Si la Edge Function aun no fue desplegada, este flujo queda pendiente para el bloque posterior.`,
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

export async function listPlans() {
  const client = getClient()
  const { data, error } = await client
    .from('plans')
    .select(
      'id, name, slug, description, price, billing_period_days, active, plan_activities(monthly_credits, activities(id, name, slug, active))',
    )
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as unknown as Plan[]
}

export async function listActivities() {
  const client = getClient()
  const { data, error } = await client
    .from('activities')
    .select('id, name, slug, active')
    .eq('active', true)
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as Activity[]
}

export async function updatePlan(planId: string, input: UpdatePlanInput) {
  const client = getClient()
  const { error } = await client
    .from('plans')
    .update({
      description: input.description.trim() || null,
      price: input.price,
      active: input.active,
    })
    .eq('id', planId)

  if (error) {
    throw error
  }
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

export async function listPayments(status?: PaymentStatus | 'all') {
  const client = getClient()
  let query = client
    .from('payments')
    .select(
      'id, student_id, membership_id, amount, method, status, paid_at, approved_at, rejected_at, notes, created_at, updated_at',
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
  })

  if (error) {
    throw error
  }

  return data
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

export async function listCalendarSessions(fromDate: string, toDate: string) {
  const client = getClient()
  const { data, error } = await client.rpc('list_calendar_sessions', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as CalendarSession[]
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

export async function listAttendanceSessions(fromDate: string, toDate: string) {
  const client = getClient()
  const { data, error } = await client.rpc('list_attendance_sessions', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as AttendanceSessionRow[]
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
