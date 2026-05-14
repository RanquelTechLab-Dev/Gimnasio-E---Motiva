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
}

export type UpdatePlanInput = {
  description: string
  price: number
  active: boolean
}
