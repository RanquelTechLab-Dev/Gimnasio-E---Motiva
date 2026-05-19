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
  CreateStudentInput,
  MassEmailInput,
  MassEmailResult,
  Membership,
  Payment,
  PaymentStatus,
  Plan,
  RegisterPaymentInput,
  StudentFileMetadataInput,
  StudentProfile,
  UpdateClassSessionInput,
  UpdatePlanInput,
  UpdateStudentInput,
  UploadStudentFileInput,
  UploadStudentFileResult,
  UpsertTrainingNoteInput,
  DriveStatusResult,
  DriveCleanupResult,
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
    const response = 'context' in error ? error.context : null
    if (response instanceof Response) {
      const body = await response.json().catch(() => null)
      if (body && typeof body.error === 'string') {
        throw new Error(body.error)
      }
    }
    throw error
  }

  return data as AdminActionResult
}

export async function listPlans() {
  const client = getClient()
  const { data, error } = await client
    .from('plans')
    .select(
      'id, name, slug, description, price, billing_period_days, plan_type, package_class_count, active, plan_activities(monthly_credits, weekly_class_limit, activities(id, name, slug, active))',
    )
    .order('active', { ascending: false })
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

export async function deleteClassSession(sessionId: string) {
  const client = getClient()
  const { data, error } = await client.rpc('admin_delete_class_session', {
    p_session_id: sessionId,
  })

  if (error) {
    throw error
  }

  return data as AdminActionResult
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
