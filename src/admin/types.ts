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

export type PlanType = 'weekly' | 'package' | 'manual'

export type PlanActivity = {
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

export type AdminActionResult = {
  action: 'archived' | 'deactivated' | 'deleted'
  student_id?: string
  plan_id?: string
  session_id?: string
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
