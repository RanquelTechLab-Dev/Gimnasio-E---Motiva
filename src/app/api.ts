import { supabase, supabaseConfigError } from '../lib/supabase'
import type {
  CalendarSession,
  MyBooking,
  StudentAttendance,
  StudentFile,
  StudentPayment,
  StudentPlanCatalogItem,
  StudentProfileDetails,
  StudentProfileSummary,
} from './types'

function getClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'La app no esta configurada.')
  }

  return supabase
}

export function formatAppError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'No se pudo completar la operacion.'
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

export async function bookClassSession(sessionId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('book_class_session', {
    session_id: sessionId,
  })

  if (error) {
    throw error
  }

  return data
}

export async function cancelBooking(bookingId: string, reason: string) {
  const client = getClient()
  const { data, error } = await client.rpc('cancel_booking', {
    booking_id: bookingId,
    reason: reason.trim() || null,
  })

  if (error) {
    throw error
  }

  return data
}

export async function listMyBookings() {
  const client = getClient()
  const { data, error } = await client.rpc('list_my_bookings')

  if (error) {
    throw error
  }

  return (data ?? []) as MyBooking[]
}

export async function getMyProfileSummary() {
  const client = getClient()
  const { data, error } = await client.rpc('get_my_profile_summary')

  if (error) {
    throw error
  }

  return data as StudentProfileSummary
}

export async function updateMyProfilePreferences(input: {
  phone: string
  receives_emails: boolean
}) {
  const client = getClient()
  const { data, error } = await client.rpc('update_my_profile_preferences', {
    p_phone: input.phone,
    p_receives_emails: input.receives_emails,
  })

  if (error) {
    throw error
  }

  return data as StudentProfileDetails
}

export async function updateMyPassword(newPassword: string) {
  const client = getClient()
  const { error } = await client.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    throw error
  }
}

export async function listMyPayments() {
  const client = getClient()
  const { data, error } = await client.rpc('list_my_payments')

  if (error) {
    throw error
  }

  return (data ?? []) as StudentPayment[]
}

export async function listMyAttendance() {
  const client = getClient()
  const { data, error } = await client.rpc('list_my_attendance')

  if (error) {
    throw error
  }

  return (data ?? []) as StudentAttendance[]
}

export async function listMyFiles() {
  const client = getClient()
  const { data, error } = await client.rpc('list_my_files')

  if (error) {
    throw error
  }

  return (data ?? []) as StudentFile[]
}

export async function listActivePlansCatalog() {
  const client = getClient()
  const { data, error } = await client
    .from('plans')
    .select(
      'id, name, slug, description, price, billing_period_days, plan_type, package_class_count, active, visible_to_students, plan_activities(activity_id, monthly_credits, weekly_class_limit, activities(id, name, slug, description, requires_24h_cancel, flexible_schedule, active, color_hex, default_capacity, max_capacity))',
    )
    .eq('active', true)
    .eq('visible_to_students', true)
    .order('price', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    throw error
  }

  return (data ?? []) as unknown as StudentPlanCatalogItem[]
}
