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
  description: string | null
  requires_24h_cancel: boolean
  flexible_schedule: boolean
  active: boolean
  color_hex: string | null
  default_capacity: number | null
  max_capacity: number | null
  booking_cutoff_hours: number
  cancellation_cutoff_hours: number
}

export type PlanType = 'weekly' | 'package' | 'manual'

export type PlanActivity = {
  activity_id?: string
  monthly_credits: number | null
  weekly_class_limit: number | null
  activities: Activity | null
}

export type Plan = {
  id: string
  name: string
  slug: string
  description: string | null
  price: number
  billing_period_days: number
  plan_type: PlanType
  package_class_count: number | null
  active: boolean
  visible_to_students: boolean
  max_active_memberships: number | null
  memberships?: Array<{ id: string }>
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

export type StudentProgram = {
  program_id: string
  student_id: string
  plan_id: string
  plan_name: string
  plan_type: PlanType
  plan_price: number
  approved_paid_total: number
  pending_amount: number
  is_fully_paid: boolean
  payment_state: 'paid' | 'partial' | 'unpaid'
  status: MembershipStatus
  start_date: string
  end_date: string
  remaining_credits: number | null
  payments_count: number
  future_active_bookings_count: number
  future_bookings_count: number
  past_bookings_count: number
  attendance_count: number
  last_payment_at: string | null
  has_history: boolean
  created_at: string
  updated_at: string
}

export type PaymentMethod = 'cash' | 'transfer'
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'voided'
export type AttendanceStatus = 'present' | 'absent' | 'justified'
export type FileKind = 'training_plan' | 'observation' | 'attachment'
export type TrainingNoteType =
  | 'training_plan'
  | 'observation'
  | 'follow_up'
  | 'admin_note'

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
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  membership_start_date: string | null
  membership_end_date: string | null
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

export type UpdateStudentPasswordInput = {
  student_id: string
  password: string
}

export type AssignMembershipInput = {
  student_id: string
  plan_id: string
  start_date: string
  end_date: string
  remaining_credits: number | null
}

export type UpdateStudentProgramInput = {
  program_id: string
  plan_id: string
  status: MembershipStatus
  start_date: string
  end_date: string
  remaining_credits: number | null
  confirm_history?: string | null
}

export type FixedScheduleOption = {
  activity_id: string
  activity_name: string
  start_time: string
  label: string
  activity_names: string
  sessions_count: number
}

export type FixedScheduleDetailStatus =
  | 'available'
  | 'created'
  | 'already_booked'
  | 'skipped_full'
  | 'skipped_out_of_validity'
  | 'skipped_weekly_limit'
  | 'skipped_no_permission'
  | 'skipped_conflict'
  | 'skipped_other'

export type FixedScheduleDetail = {
  session_id: string
  activity_id: string
  activity_name: string
  activity_slug: string
  title: string
  starts_at: string
  ends_at: string
  capacity: number
  reserved_count: number
  status: FixedScheduleDetailStatus
  reason: string | null
}

export type FixedScheduleResult = {
  mode: 'preview' | 'execute'
  student_id: string
  membership_id: string
  activity_id?: string | null
  weekdays: number[]
  start_time: string
  total_found: number
  created_count: number
  available_count: number
  already_booked_count: number
  skipped_full_count: number
  skipped_out_of_validity_count: number
  skipped_weekly_limit_count: number
  skipped_no_permission_count: number
  skipped_conflict_count: number
  skipped_other_count: number
  details: FixedScheduleDetail[]
}

export type StudentFixedSchedule = {
  schedule_id: string
  student_id: string
  membership_id: string
  plan_name: string
  activity_name: string
  weekdays: number[]
  weekday_labels: string
  start_time: string
  active: boolean
  membership_start_date: string
  membership_end_date: string
  membership_status: MembershipStatus
  last_applied_at: string | null
  created_at: string
  updated_at: string
  booking_details: FixedScheduleBookingDetail[]
}

export type FixedScheduleBookingDetail = {
  date: string
  weekday: number
  weekday_label: string
  starts_at: string
  ends_at: string
  session_id: string
  booking_id: string
  booking_status: 'booked' | 'cancelled' | 'attended' | 'no_show'
  is_past: boolean
  can_admin_cancel: boolean
}

export type FixedScheduleCancelPreview = {
  schedule_id: string
  cancel_past: boolean
  total_matching_bookings: number
  cancellable_count: number
  past_count: number
  future_count: number
  already_cancelled_count: number
  details: FixedScheduleBookingDetail[]
}

export type FixedScheduleCancelResult = {
  schedule_id: string
  cancelled_count: number
  cancelled_booking_ids: string[]
  cancel_past: boolean
  does_not_delete_bookings: boolean
}

export type FixedScheduleSelectedCancelResult = {
  requested_count: number
  cancelled_count: number
  skipped_count: number
  details: Array<{
    booking_id: string
    status_before: string | null
    student_id: string | null
    membership_id: string | null
    session_id: string | null
    activity_id: string | null
    starts_at: string | null
    cancelled: boolean
    skipped_reason: string | null
  }>
  does_not_delete_bookings: boolean
}

export type FixedScheduleSelectedDeleteResult = {
  requested_count: number
  deleted_count: number
  skipped_count: number
  skipped_past_count: number
  skipped_with_attendance_count: number
  skipped_credit_charged_count: number
  deleted_booking_ids: string[]
  deleted_schedule_ids: string[]
  deleted_schedule_count: number
  details: Array<{
    booking_id: string
    status_before: string | null
    student_id: string | null
    membership_id: string | null
    session_id: string | null
    activity_id: string | null
    starts_at: string | null
    credits_charged: number | null
    is_future: boolean | null
    attendance_count: number | null
    schedule_ids: string[]
    deleted: boolean
    skipped_reason: string | null
  }>
}

export type RegisterPaymentInput = {
  student_id: string
  membership_id: string
  amount: number
  method: PaymentMethod
  notes: string
  payment_date: string
  membership_start_date: string
  membership_end_date: string
}

export type RegisterPaymentResult = {
  payment_id: string
  payment_status: PaymentStatus
  student_id: string
  membership_id: string
  membership_status: MembershipStatus
  membership_start_date: string
  membership_end_date: string
  remaining_credits: number | null
  amount: number
  method: PaymentMethod
  paid_at: string
  payment_date: string
  payment_membership_start_date?: string | null
  payment_membership_end_date?: string | null
  approved_paid_total?: number
  pending_amount?: number
  is_fully_paid?: boolean
}

export type UpdatePaymentInput = {
  payment_id: string
  amount: number
  method: PaymentMethod
  payment_date: string
  membership_start_date: string
  membership_end_date: string
  notes: string
}

export type PlanActivityInput = {
  activity_id: string
  monthly_credits: number | null
  weekly_class_limit: number | null
}

export type PlanInput = {
  name: string
  description: string
  price: number
  billing_period_days: number
  plan_type: PlanType
  package_class_count: number | null
  active: boolean
  visible_to_students: boolean
  max_active_memberships: number | null
  activities: PlanActivityInput[]
}

export type ActivityInput = {
  name: string
  description: string
  requires_24h_cancel: boolean
  flexible_schedule: boolean
  active: boolean
  color_hex: string
  default_capacity: number | null
  max_capacity: number | null
  booking_cutoff_hours?: number | null
  cancellation_cutoff_hours?: number | null
}

export type ClassRecurringRule = {
  rule_id: string
  activity_id: string
  activity_name: string
  activity_slug: string
  title: string
  weekday: number
  start_time: string
  end_time: string
  capacity: number
  trainer_name: string | null
  notes: string | null
  active: boolean
  valid_from: string
  valid_until: string | null
}

export type ClassRecurringRuleInput = {
  activity_id: string
  title: string
  weekday: number
  start_time: string
  end_time: string
  capacity: number
  trainer_name: string
  notes: string
  valid_from: string
}

export type AdminActionResult = {
  action:
    | 'archived'
    | 'cancelled'
    | 'converted'
    | 'created'
    | 'deactivated'
    | 'deleted'
    | 'deleted_series'
    | 'restored'
    | 'updated'
  student_id?: string
  plan_id?: string
  activity_id?: string
  session_id?: string
  rule_id?: string
  has_history?: boolean
  future_active_bookings_cancelled?: number
  reconciled_future_sessions?: number
  skipped_future_sessions?: number
  skipped_future_sessions_with_bookings?: number
  skipped_future_sessions_with_attendance?: number
  credits_returned?: number
  warning?: string
}

export type AdminTrainingNote = {
  note_id: string
  student_id: string
  note_type: TrainingNoteType
  title: string
  body: string | null
  visible_to_student: boolean
  created_by: string | null
  created_by_name: string | null
  updated_by: string | null
  updated_by_name: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type UpsertTrainingNoteInput = {
  note_id?: string | null
  student_id: string
  note_type: TrainingNoteType
  title: string
  body: string
  visible_to_student: boolean
}

export type AdminStudentFile = {
  file_id: string
  student_id: string
  kind: FileKind
  title: string
  description: string | null
  drive_url: string | null
  mime_type: string | null
  size_bytes: number | null
  visible_to_student: boolean
  uploaded_by: string | null
  uploaded_by_name: string | null
  updated_by: string | null
  updated_by_name: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type StudentFileMetadataInput = {
  file_id?: string | null
  student_id: string
  kind: FileKind
  title: string
  description: string
  drive_url: string
  mime_type: string
  size_bytes: string
  visible_to_student: boolean
}

export type DriveStatusResult = {
  used_bytes: number
  total_bytes: number | null
  remaining_bytes: number | null
  remaining_ratio: number | null
  warning: boolean
}

export type DriveCleanupCandidate = {
  student_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  last_payment_at: string | null
  last_real_activity_at: string | null
  last_attendance_at: string | null
  derived_last_activity_at: string | null
  eligible_file_count: number
  eligible_bytes: number
}

export type DriveCleanupFile = {
  id: string
  student_id: string
  title: string
  kind: FileKind
  drive_file_id: string | null
  drive_url: string | null
  size_bytes: number | null
  visible_to_student: boolean
  created_at: string
  archived_at?: string | null
}

export type AdminStorageFile = DriveCleanupFile & {
  student_name: string | null
  student_email: string | null
  archived_at: string | null
}

export type FileStorageSummary = {
  total_files: number
  active_files: number
  visible_active_files: number
  hidden_active_files: number
  archived_files: number
  active_size_bytes: number
  total_size_bytes: number
}

export type DriveCleanupResult = {
  dryRun: boolean
  force: boolean
  quota: DriveStatusResult
  threshold_reached: boolean
  criteria?: Record<string, unknown>
  excluded_active_membership_student_ids_count?: number
  mode?: 'candidate' | 'file' | 'files'
  requested_file_id?: string | null
  requested_file_ids?: string[]
  selected_student: DriveCleanupCandidate | null
  selected_files: DriveCleanupFile[]
  selected_file_count?: number
  reclaimable_bytes?: number
  deleted_files: Array<{
    file_id: string
    drive_file_id: string
    status: number
  }>
  archived_file_ids: string[]
  failed_files: Array<{
    file_id: string
    drive_file_id: string | null
    stage: 'drive_delete' | 'metadata_archive'
    error: string
  }>
  message: string
}

export type UploadStudentFileInput = {
  student_id: string
  kind: FileKind
  title: string
  description: string
  visible_to_student: boolean
  file: File
}

export type UploadStudentFileResult = {
  file: AdminStudentFile
  drive_status: DriveStatusResult | null
}

export type MassEmailAudience = 'recent_payers_6_months'

export type MassEmailInput = {
  subject: string
  body: string
  audience: MassEmailAudience
  dryRun: boolean
}

export type MassEmailRecipientPreview = {
  student_id: string
  email: string
  first_name?: string
  last_name?: string
  last_paid_at?: string
  status?: 'sent' | 'failed'
  provider_message_id?: string | null
  error?: string
}

export type MassEmailResult = {
  audience: MassEmailAudience
  dryRun: boolean
  eligible_count: number
  sent_count: number
  failed_count: number
  skipped_count: number
  recipients: MassEmailRecipientPreview[]
  message?: string
}

export type CalendarSession = {
  session_id: string
  recurring_rule_id: string | null
  activity_id: string
  activity_name: string
  activity_slug: string
  activity_color_hex: string | null
  requires_24h_cancel: boolean
  booking_cutoff_hours: number
  cancellation_cutoff_hours: number
  booking_deadline: string
  cancellation_deadline: string
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
  plan_type: PlanType | null
  weekly_class_limit: number | null
  weekly_classes_used: number | null
  weekly_classes_remaining: number | null
  package_classes_remaining: number | null
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
