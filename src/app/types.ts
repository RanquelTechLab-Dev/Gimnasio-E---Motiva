export type CalendarSession = {
  session_id: string
  activity_id: string
  activity_name: string
  activity_slug: string
  requires_24h_cancel: boolean
  title: string
  starts_at: string
  ends_at: string
  capacity: number
  trainer_name: string | null
  notes: string | null
  active: boolean
  cancelled_at: string | null
  reserved_count: number
  spots_left: number
  own_booking_id: string | null
  own_booking_status: 'booked' | 'cancelled' | 'attended' | 'no_show' | null
  can_book: boolean
  block_reason: string | null
}

export type MyBooking = {
  booking_id: string
  session_id: string
  activity_name: string
  activity_slug: string
  title: string
  starts_at: string
  ends_at: string
  booking_status: 'booked' | 'cancelled' | 'attended' | 'no_show'
  booked_at: string
  cancelled_at: string | null
  cancel_reason: string | null
  charged_as_attended: boolean
  credits_charged: number
  credit_returned_at: string | null
  can_cancel: boolean
  cancel_block_reason: string | null
}
