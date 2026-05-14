import { supabase, supabaseConfigError } from '../lib/supabase'
import type { CalendarSession, MyBooking } from './types'

function getClient() {
  if (!supabase) {
    throw new Error(supabaseConfigError ?? 'Supabase no esta configurado.')
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
  const { data, error } = await client.rpc('list_calendar_sessions', {
    from_date: fromDate,
    to_date: toDate,
  })

  if (error) {
    throw error
  }

  return (data ?? []) as CalendarSession[]
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
