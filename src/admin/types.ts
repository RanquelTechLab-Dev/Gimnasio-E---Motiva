export type StudentProfile = {
  id: string
  role: 'student'
  first_name: string
  last_name: string
  email: string
  phone: string | null
  active: boolean
  receives_emails: boolean
  notes: string | null
  last_payment_at: string | null
  last_real_activity_at: string | null
  created_at: string
  updated_at: string
}

export type Activity = {
  id: string
  name: string
  slug: string
  active: boolean
}

export type PlanActivity = {
  monthly_credits: number | null
  activities: Activity | null
}

export type Plan = {
  id: string
  name: string
  slug: string
  description: string | null
  price: number
  billing_period_days: number
  active: boolean
  plan_activities?: PlanActivity[]
}

export type MembershipStatus = 'active' | 'suspended' | 'expired' | 'cancelled'

export type Membership = {
  id: string
  student_id: string
  plan_id: string
  status: MembershipStatus
  start_date: string
  end_date: string
  remaining_credits: number | null
  created_at: string
  updated_at: string
}

export type PaymentMethod = 'cash' | 'transfer'
export type PaymentStatus = 'pending' | 'approved' | 'rejected'
export type AttendanceStatus = 'present' | 'absent' | 'justified'

export type Payment = {
  id: string
  student_id: string
  membership_id: string | null
  amount: number
  method: PaymentMethod
  status: PaymentStatus
  paid_at: string
  approved_at: string | null
  rejected_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type CreateStudentInput = {
  first_name: string
  last_name: string
  email: string
  phone: string
  password: string
  receives_emails: boolean
}

export type UpdateStudentInput = {
  first_name: string
  last_name: string
  phone: string
  active: boolean
  receives_emails: boolean
}

export type AssignMembershipInput = {
  student_id: string
  plan_id: string
  start_date: string
  end_date: string
  remaining_credits: number | null
}

export type RegisterPaymentInput = {
  student_id: string
  membership_id: string
  amount: number
  method: PaymentMethod
  notes: string
  payment_date: string
}

export type UpdatePlanInput = {
  description: string
  price: number
  active: boolean
}

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

export type ClassSessionInput = {
  activity_id: string
  title: string
  starts_at: string
  ends_at: string
  capacity: number
  coach_name: string
  notes: string
}

export type UpdateClassSessionInput = ClassSessionInput & {
  session_id: string
  active: boolean
}

export type AttendanceSessionRow = {
  session_id: string
  activity_id: string
  activity_name: string
  requires_24h_cancel: boolean
  title: string
  starts_at: string
  ends_at: string
  capacity: number
  session_active: boolean
  session_cancelled_at: string | null
  booking_id: string
  student_id: string
  student_first_name: string
  student_last_name: string
  student_email: string
  student_phone: string | null
  booking_status: 'booked' | 'cancelled' | 'attended' | 'no_show'
  booked_at: string
  booking_charged_as_attended: boolean
  attendance_id: string | null
  attendance_status: AttendanceStatus | null
  attendance_recorded_at: string | null
  attendance_recorded_by: string | null
  attendance_notes: string | null
  attendance_charged_as_attended: boolean | null
}

export type AutoFinalizeAttendanceResult = {
  finalized_count: number
  from_date: string
  to_date: string
}
