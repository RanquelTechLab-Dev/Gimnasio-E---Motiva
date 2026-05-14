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

export type StudentProfileDetails = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  active: boolean
  receives_emails: boolean
  last_payment_at: string | null
  last_real_activity_at: string | null
  last_attendance_at: string | null
}

export type StudentMembershipSummary = {
  membership_id: string
  status: 'active' | 'suspended' | 'expired' | 'cancelled'
  start_date: string
  end_date: string
  remaining_credits: number | null
  plan_id: string
  plan_name: string
  plan_slug: string
  billing_period_days: number
}

export type StudentNextBookingSummary = {
  booking_id: string
  session_id: string
  activity_name: string
  title: string
  starts_at: string
  ends_at: string
  status: 'booked' | 'cancelled' | 'attended' | 'no_show'
}

export type StudentLastPaymentSummary = {
  payment_id: string
  amount: number
  method: 'cash' | 'transfer'
  status: 'pending' | 'approved' | 'rejected'
  paid_at: string
  notes: string | null
}

export type StudentLastAttendanceSummary = {
  attendance_id: string
  status: 'present' | 'absent' | 'justified'
  recorded_at: string
  activity_name: string
  title: string
}

export type StudentProfileSummary = {
  profile: StudentProfileDetails
  active_membership: StudentMembershipSummary | null
  next_booking: StudentNextBookingSummary | null
  last_payment: StudentLastPaymentSummary | null
  last_attendance: StudentLastAttendanceSummary | null
}

export type StudentPayment = {
  payment_id: string
  membership_id: string | null
  amount: number
  method: 'cash' | 'transfer'
  status: 'pending' | 'approved' | 'rejected'
  paid_at: string
  approved_at: string | null
  rejected_at: string | null
  notes: string | null
  plan_name: string | null
}

export type StudentAttendance = {
  attendance_id: string
  booking_id: string
  session_id: string
  activity_name: string
  title: string
  starts_at: string
  ends_at: string
  status: 'present' | 'absent' | 'justified'
  recorded_at: string
  notes: string | null
}

export type StudentFile = {
  file_id: string
  kind: 'training_plan' | 'observation' | 'attachment'
  title: string
  description: string | null
  drive_url: string | null
  mime_type: string | null
  size_bytes: number | null
  visible_to_student: boolean
  created_at: string
}
