import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  archiveStudentFileMetadata,
  archiveTrainingNote,
  assignMembership,
  bulkBookFixedScheduleForStudent,
  cancelFixedScheduleBookings,
  checkDriveStatus,
  createStudentFileMetadata,
  createStudent,
  deactivateStudent,
  deactivateStudentFixedSchedule,
  deleteStudentProgram,
  deleteStudent,
  formatAdminError,
  listStudentFiles,
  listStudentFixedSchedules,
  listStudentPrograms,
  listStudentTrainingNotes,
  listPayments,
  listPlans,
  listStudents,
  listFixedScheduleOptionsForStudent,
  previewCancelFixedScheduleBookings,
  previewFixedScheduleForStudent,
  registerManualPayment,
  updateStudentProgram,
  updateStudentFileMetadata,
  updateStudentPassword,
  updateStudent,
  uploadStudentFile,
  upsertTrainingNote,
} from './api'
import type {
  AdminStudentFile,
  AdminTrainingNote,
  DriveStatusResult,
  FileKind,
  FixedScheduleCancelPreview,
  FixedScheduleOption,
  FixedScheduleResult,
  MembershipStatus,
  PaymentMethod,
  Payment,
  Plan,
  StudentFixedSchedule,
  StudentProgram,
  StudentProfile,
  StudentFileMetadataInput,
  TrainingNoteType,
} from './types'

type StudentFormState = {
  first_name: string
  last_name: string
  email: string
  phone: string
  password: string
  receives_emails: boolean
}

type EditStudentState = {
  first_name: string
  last_name: string
  phone: string
  active: boolean
  receives_emails: boolean
}

type PasswordFormState = {
  password: string
  confirmation: string
}

type MembershipFormState = {
  plan_id: string
  start_date: string
  end_date: string
  remaining_credits: string
}

type ProgramEditFormState = MembershipFormState & {
  program_id: string
  status: MembershipStatus
  confirmation: string
}

type PaymentValidityMode = 'monthly' | 'manual'

type PaymentFormState = {
  membership_id: string
  amount: string
  method: PaymentMethod
  payment_date: string
  membership_start_date: string
  validity_mode: PaymentValidityMode
  validity_days: string
  membership_end_date: string
  notes: string
}

type TrainingNoteFormState = {
  note_id: string | null
  note_type: TrainingNoteType
  title: string
  body: string
  visible_to_student: boolean
}

type FileMetadataFormState = {
  file_id: string | null
  kind: FileKind
  title: string
  description: string
  drive_url: string
  mime_type: string
  size_bytes: string
  visible_to_student: boolean
}

type UploadFileFormState = {
  kind: FileKind
  title: string
  description: string
  visible_to_student: boolean
  file: File | null
}

type FixedScheduleFormState = {
  membership_id: string
  weekdays: number[]
  start_time: string
}

type FixedScheduleCancelState = {
  schedule_id: string
  cancel_past: boolean
  reason: string
}

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const paymentStatusLabels: Record<Payment['status'], string> = {
  approved: 'Aprobado',
  pending: 'Pendiente',
  rejected: 'Rechazado',
  voided: 'Anulado',
}

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
}

const programStatusLabels: Record<MembershipStatus, string> = {
  active: 'Activo',
  cancelled: 'Eliminado',
  expired: 'Vencido',
  suspended: 'Suspendido',
}

const programPaymentStateLabels: Record<StudentProgram['payment_state'], string> =
  {
    paid: 'Pagado completo',
    partial: 'Pago incompleto',
    unpaid: 'Sin pago',
  }

const noteTypeLabels: Record<TrainingNoteType, string> = {
  admin_note: 'Nota administrativa',
  follow_up: 'Seguimiento',
  observation: 'Observacion',
  training_plan: 'Plan de entrenamiento',
}

const fileKindLabels: Record<FileKind, string> = {
  attachment: 'Adjunto',
  observation: 'Observacion',
  training_plan: 'Plan de entrenamiento',
}

const weekdayOptions = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miercoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sabado' },
  { value: 7, label: 'Domingo' },
]

const fixedScheduleStatusLabels: Record<string, string> = {
  available: 'Disponible',
  created: 'Creada',
  already_booked: 'Ya reservada',
  skipped_full: 'Sin cupo',
  skipped_out_of_validity: 'Fuera de vigencia',
  skipped_weekly_limit: 'Limite semanal',
  skipped_no_permission: 'Sin permiso',
  skipped_conflict: 'Conflicto',
  skipped_other: 'Saltada',
}

const bookingStatusLabels: Record<string, string> = {
  booked: 'Reservada',
  cancelled: 'Cancelada',
  attended: 'Asistio',
  no_show: 'Ausente',
}

function todayDate() {
  return formatLocalDate(new Date())
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function parseDateValue(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)

  if (!year || !month || !day) {
    return null
  }

  return new Date(year, month - 1, day)
}

function addMonthsSameDayInclusive(startDate: string, months = 1) {
  const start = parseDateValue(startDate)

  if (!start) {
    return startDate
  }

  const targetMonthIndex = start.getMonth() + months
  const lastTargetDay = new Date(
    start.getFullYear(),
    targetMonthIndex + 1,
    0,
  ).getDate()
  const targetDay = Math.min(start.getDate(), lastTargetDay)

  return formatLocalDate(
    new Date(start.getFullYear(), targetMonthIndex, targetDay),
  )
}

function addIncludedDays(startDate: string, includedDays: number) {
  const start = parseDateValue(startDate)

  if (!start) {
    return startDate
  }

  const safeDays = Math.max(1, Math.floor(includedDays))
  start.setDate(start.getDate() + safeDays - 1)
  return formatLocalDate(start)
}

function includedDaysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate || endDate < startDate) {
    return ''
  }

  const start = parseDateValue(startDate)
  const end = parseDateValue(endDate)

  if (!start || !end) {
    return ''
  }

  return String(Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

function endForValidityMode(
  startDate: string,
  mode: PaymentValidityMode,
  includedDays: string,
) {
  return mode === 'monthly'
    ? addMonthsSameDayInclusive(startDate)
    : addIncludedDays(startDate, Number(includedDays) || 1)
}

function validityCopy(startDate: string, endDate: string, mode: PaymentValidityMode) {
  if (mode === 'monthly') {
    return `Vigencia mensual: incluye desde ${startDate} hasta ${endDate} inclusive.`
  }

  const days = includedDaysBetween(startDate, endDate)
  return `Vigencia manual: ${days || '0'} dias incluidos.`
}

function paymentValidityFields(startDate: string, plan?: Plan | null) {
  const days = plan?.billing_period_days ?? 30
  return {
    membership_start_date: startDate,
    validity_mode: 'monthly' as PaymentValidityMode,
    validity_days: String(days),
    membership_end_date: addMonthsSameDayInclusive(startDate),
  }
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

function studentDisplayName(student: StudentProfile) {
  return `${student.first_name} ${student.last_name}`.trim()
}

function matchesStudentSearch(student: StudentProfile, searchValue: string) {
  const normalized = searchValue.trim().toLowerCase()

  if (!normalized) {
    return true
  }

  return [
    student.first_name,
    student.last_name,
    student.email,
    student.phone ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalized)
}

function studentToEditForm(student: StudentProfile): EditStudentState {
  return {
    first_name: student.first_name,
    last_name: student.last_name,
    phone: student.phone ?? '',
    active: student.active,
    receives_emails: student.receives_emails,
  }
}

function weeklyPlanLabel(plan: Plan) {
  const total = (plan.plan_activities ?? []).reduce((sum, item) => {
    return sum + (item.weekly_class_limit ?? 0)
  }, 0)

  return total > 0 ? `${total} por semana` : 'limite semanal pendiente'
}

function planDefaultPackageClasses(plan?: Plan | null) {
  if (!plan || plan.plan_type === 'weekly') {
    return ''
  }

  if (plan.plan_type === 'package') {
    return plan.package_class_count ? String(plan.package_class_count) : ''
  }

  const classes = (plan.plan_activities ?? []).reduce((total, item) => {
    return total + (item.monthly_credits ?? 0)
  }, 0)

  return classes > 0 ? String(classes) : ''
}

function describePlanOption(plan: Plan) {
  const price = moneyFormatter.format(plan.price)

  if (plan.plan_type === 'weekly') {
    return `${plan.name} · ${price} · ${weeklyPlanLabel(plan)}`
  }

  if (plan.plan_type === 'package') {
    return `${plan.name} · ${price} · ${plan.package_class_count ?? 0} clases`
  }

  const classes = planDefaultPackageClasses(plan)
  return classes
    ? `${plan.name} · ${price} · ${classes} clases`
    : `${plan.name} · ${price}`
}

function describeProgramOption(program: StudentProgram, plan?: Plan | null) {
  const classes = (() => {
    if (plan?.plan_type === 'weekly') {
      return weeklyPlanLabel(plan)
    }

    if (program.remaining_credits === null) {
      return 'clases segun plan'
    }

    return `${program.remaining_credits} clases restantes`
  })()
  const price = plan ? ` · ${moneyFormatter.format(plan.price)}` : ''
  const payment = program.is_fully_paid
    ? 'Pagado completo'
    : program.approved_paid_total > 0
      ? `Pago incompleto: falta ${moneyFormatter.format(program.pending_amount)}`
      : 'Sin pago'

  return `${program.plan_name ?? plan?.name ?? 'Plan'}${price} · ${classes} · ${program.start_date} a ${program.end_date} · ${payment}`
}

function programDisplayStatus(program: StudentProgram) {
  if (program.status === 'suspended' && !program.is_fully_paid) {
    return 'Pendiente de pago'
  }

  return programStatusLabels[program.status]
}

function programHasHistory(program: StudentProgram) {
  return (
    program.has_history ||
    program.payments_count > 0 ||
    program.future_bookings_count > 0 ||
    program.past_bookings_count > 0 ||
    program.attendance_count > 0
  )
}

function programHistorySummary(program: StudentProgram) {
  const parts = [
    `${program.payments_count} pagos`,
    `${program.future_active_bookings_count} reservas futuras activas`,
    `${program.past_bookings_count} reservas pasadas`,
    `${program.attendance_count} asistencias`,
  ]

  return parts.join(' · ')
}

function buildProgramEditForm(program: StudentProgram): ProgramEditFormState {
  return {
    program_id: program.program_id,
    plan_id: program.plan_id,
    start_date: program.start_date,
    end_date: program.end_date,
    remaining_credits:
      program.remaining_credits === null ? '' : String(program.remaining_credits),
    status: program.status,
    confirmation: '',
  }
}

function buildMembershipForm(plans: Plan[]): MembershipFormState {
  const startDate = todayDate()
  const firstPlan = plans.find((plan) => plan.active) ?? plans[0]
  return {
    plan_id: firstPlan?.id ?? '',
    start_date: startDate,
    end_date: addDays(startDate, (firstPlan?.billing_period_days ?? 30) - 1),
    remaining_credits: planDefaultPackageClasses(firstPlan),
  }
}

function buildTrainingNoteForm(): TrainingNoteFormState {
  return {
    note_id: null,
    note_type: 'training_plan',
    title: '',
    body: '',
    visible_to_student: false,
  }
}

function buildFileMetadataForm(): FileMetadataFormState {
  return {
    file_id: null,
    kind: 'attachment',
    title: '',
    description: '',
    drive_url: '',
    mime_type: '',
    size_bytes: '',
    visible_to_student: false,
  }
}

function buildUploadFileForm(): UploadFileFormState {
  return {
    kind: 'attachment',
    title: '',
    description: '',
    visible_to_student: false,
    file: null,
  }
}

function formatSize(value: number | null) {
  if (value === null) {
    return 'Sin tamano'
  }

  if (value < 1024) {
    return `${value} B`
  }

  return `${(value / 1024).toFixed(1)} KB`
}

export function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [studentPrograms, setStudentPrograms] = useState<StudentProgram[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [trainingNotes, setTrainingNotes] = useState<AdminTrainingNote[]>([])
  const [studentFiles, setStudentFiles] = useState<AdminStudentFile[]>([])
  const [studentFixedSchedules, setStudentFixedSchedules] = useState<
    StudentFixedSchedule[]
  >([])
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [studentSearch, setStudentSearch] = useState('')
  const [studentForm, setStudentForm] = useState<StudentFormState>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    receives_emails: true,
  })
  const [editForm, setEditForm] = useState<EditStudentState | null>(null)
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    password: '',
    confirmation: '',
  })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [membershipForm, setMembershipForm] = useState<MembershipFormState>(
    buildMembershipForm([]),
  )
  const [programEditForm, setProgramEditForm] =
    useState<ProgramEditFormState | null>(null)
  const [programDeleteTarget, setProgramDeleteTarget] =
    useState<StudentProgram | null>(null)
  const [programDeleteConfirmation, setProgramDeleteConfirmation] = useState('')
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({
    membership_id: '',
    amount: '',
    method: 'cash',
    payment_date: todayDate(),
    ...paymentValidityFields(todayDate()),
    notes: '',
  })
  const [trainingNoteForm, setTrainingNoteForm] =
    useState<TrainingNoteFormState>(buildTrainingNoteForm())
  const [fileMetadataForm, setFileMetadataForm] =
    useState<FileMetadataFormState>(buildFileMetadataForm())
  const [uploadFileForm, setUploadFileForm] =
    useState<UploadFileFormState>(buildUploadFileForm())
  const [fixedScheduleForm, setFixedScheduleForm] =
    useState<FixedScheduleFormState>({
      membership_id: '',
      weekdays: [],
      start_time: '',
    })
  const [fixedScheduleOptions, setFixedScheduleOptions] = useState<
    FixedScheduleOption[]
  >([])
  const [fixedScheduleResult, setFixedScheduleResult] =
    useState<FixedScheduleResult | null>(null)
  const [fixedScheduleCancelForm, setFixedScheduleCancelForm] =
    useState<FixedScheduleCancelState>({
      schedule_id: '',
      cancel_past: false,
      reason: '',
    })
  const [fixedScheduleCancelPreview, setFixedScheduleCancelPreview] =
    useState<FixedScheduleCancelPreview | null>(null)
  const [fixedScheduleLoading, setFixedScheduleLoading] = useState(false)
  const [driveStatus, setDriveStatus] = useState<DriveStatusResult | null>(null)
  const [uploadInputKey, setUploadInputKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const filteredStudents = useMemo(
    () =>
      students.filter((student) => matchesStudentSearch(student, studentSearch)),
    [students, studentSearch],
  )
  const selectedStudent = useMemo(
    () =>
      selectedStudentId
        ? filteredStudents.find((student) => student.id === selectedStudentId) ??
          null
        : null,
    [filteredStudents, selectedStudentId],
  )
  const plansById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  )
  const selectedStudentPrograms = studentPrograms.filter(
    (program) =>
      program.student_id === selectedStudent?.id &&
      program.status !== 'cancelled',
  )
  const payableSelectedStudentPrograms = selectedStudentPrograms.filter(
    (program) => program.status !== 'cancelled',
  )
  const fixedSchedulePrograms = selectedStudentPrograms.filter(
    (program) => program.status === 'active' && program.is_fully_paid,
  )
  const selectedFixedScheduleProgram =
    fixedSchedulePrograms.find(
      (program) => program.program_id === fixedScheduleForm.membership_id,
    ) ?? null
  const selectedFixedSchedulePlan = selectedFixedScheduleProgram
    ? plansById.get(selectedFixedScheduleProgram.plan_id) ?? null
    : null
  const selectedPayments = payments.filter(
    (payment) => payment.student_id === selectedStudent?.id,
  )
  const activeTrainingPlan =
    trainingNotes.find(
      (note) =>
        note.student_id === selectedStudent?.id &&
        note.note_type === 'training_plan' &&
        note.archived_at === null,
    ) ?? null
  const selectedTrainingNotes = trainingNotes.filter(
    (note) => note.student_id === selectedStudent?.id,
  )
  const selectedStudentFiles = studentFiles.filter(
    (file) => file.student_id === selectedStudent?.id,
  )
  const selectedStudentFixedSchedules = studentFixedSchedules.filter(
    (schedule) => schedule.student_id === selectedStudent?.id,
  )
  const activePlans = plans.filter((plan) => plan.active)
  const selectedMembershipPlan = plansById.get(membershipForm.plan_id) ?? null
  const selectedProgramEditPlan = programEditForm
    ? plansById.get(programEditForm.plan_id) ?? null
    : null
  const programEditTarget = programEditForm
    ? studentPrograms.find(
        (program) => program.program_id === programEditForm.program_id,
      ) ?? null
    : null

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [nextStudents, nextPlans, nextPrograms, nextPayments] =
        await Promise.all([
          listStudents(),
          listPlans(),
          listStudentPrograms(),
          listPayments('all'),
        ])
      setStudents(nextStudents)
      setPlans(nextPlans)
      setStudentPrograms(nextPrograms)
      setPayments(nextPayments)
      const nextSelected =
        nextStudents.find((student) => student.id === selectedStudentId) ??
        nextStudents[0] ??
        null
      setSelectedStudentId(nextSelected?.id ?? null)
      setEditForm(nextSelected ? studentToEditForm(nextSelected) : null)
      setMembershipForm(buildMembershipForm(nextPlans))
      const firstProgram = nextPrograms.find(
        (program) =>
          program.student_id === nextSelected?.id &&
          program.status !== 'cancelled',
      )
      const firstFixedProgram = nextPrograms.find(
        (program) =>
          program.student_id === nextSelected?.id &&
          program.status === 'active' &&
          program.is_fully_paid,
      )
      const firstProgramPlan = firstProgram
        ? nextPlans.find((plan) => plan.id === firstProgram.plan_id)
        : null
      setFixedScheduleForm({
        membership_id: firstFixedProgram?.program_id ?? '',
        weekdays: [],
        start_time: '',
      })
      setFixedScheduleOptions([])
      setFixedScheduleResult(null)
      setFixedScheduleCancelForm({
        schedule_id: '',
        cancel_past: false,
        reason: '',
      })
      setFixedScheduleCancelPreview(null)
      setPaymentForm((current) => {
        const nextPaymentDate = current.payment_date || todayDate()

        return {
          ...current,
          membership_id: firstProgram?.program_id ?? '',
          payment_date: nextPaymentDate,
          ...paymentValidityFields(nextPaymentDate, firstProgramPlan),
        }
      })
      if (nextSelected) {
        const [nextNotes, nextFiles, nextFixedSchedules] = await Promise.all([
          listStudentTrainingNotes(nextSelected.id),
          listStudentFiles(nextSelected.id),
          listStudentFixedSchedules(nextSelected.id),
        ])
        setTrainingNotes(nextNotes)
        setStudentFiles(nextFiles)
        setStudentFixedSchedules(nextFixedSchedules)
      } else {
        setTrainingNotes([])
        setStudentFiles([])
        setStudentFixedSchedules([])
      }
    } catch (loadError) {
      setError(formatAdminError(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function loadSelectedStudentOperations(studentId: string) {
    const [nextNotes, nextFiles, nextFixedSchedules] = await Promise.all([
      listStudentTrainingNotes(studentId),
      listStudentFiles(studentId),
      listStudentFixedSchedules(studentId),
    ])
    setTrainingNotes(nextNotes)
    setStudentFiles(nextFiles)
    setStudentFixedSchedules(nextFixedSchedules)
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedStudent || !fixedScheduleForm.membership_id) {
      return
    }

    let ignore = false
    listFixedScheduleOptionsForStudent(
      selectedStudent.id,
      fixedScheduleForm.membership_id,
    )
      .then((options) => {
        if (ignore) {
          return
        }
        setFixedScheduleOptions(options)
        setFixedScheduleResult(null)
        setFixedScheduleForm((current) => ({
          ...current,
          start_time:
            current.start_time &&
            options.some((option) => option.start_time === current.start_time)
              ? current.start_time
              : options[0]?.start_time ?? '',
        }))
      })
      .catch((optionsError) => {
        if (!ignore) {
          setError(formatAdminError(optionsError))
          setFixedScheduleOptions([])
        }
      })

    return () => {
      ignore = true
    }
  }, [fixedScheduleForm.membership_id, selectedStudent])

  function clearSelectedStudentForms() {
    setSelectedStudentId(null)
    setEditForm(null)
    setTrainingNotes([])
    setStudentFiles([])
    setStudentFixedSchedules([])
    setTrainingNoteForm(buildTrainingNoteForm())
    setFileMetadataForm(buildFileMetadataForm())
    setUploadFileForm(buildUploadFileForm())
    setProgramEditForm(null)
    setProgramDeleteTarget(null)
    setProgramDeleteConfirmation('')
    setFixedScheduleForm({ membership_id: '', weekdays: [], start_time: '' })
    setFixedScheduleOptions([])
    setFixedScheduleResult(null)
    setFixedScheduleCancelForm({
      schedule_id: '',
      cancel_past: false,
      reason: '',
    })
    setFixedScheduleCancelPreview(null)
    setDriveStatus(null)
    setUploadInputKey((current) => current + 1)
    setMembershipForm(buildMembershipForm(plans))
    setPaymentForm((current) => ({
      ...current,
      membership_id: '',
      amount: '',
      payment_date: current.payment_date || todayDate(),
      ...paymentValidityFields(current.payment_date || todayDate()),
      notes: '',
    }))
  }

  function handleStudentSearchChange(searchValue: string) {
    setStudentSearch(searchValue)

    if (!selectedStudentId) {
      return
    }

    const selectedStillVisible = students
      .filter((student) => matchesStudentSearch(student, searchValue))
      .some((student) => student.id === selectedStudentId)

    if (!selectedStillVisible) {
      clearSelectedStudentForms()
    }
  }

  function selectStudent(student: StudentProfile) {
    const firstProgram = studentPrograms.find(
      (program) =>
        program.student_id === student.id && program.status !== 'cancelled',
    )
    const firstFixedProgram = studentPrograms.find(
      (program) =>
        program.student_id === student.id &&
        program.status === 'active' &&
        program.is_fully_paid,
    )
    const firstProgramPlan = firstProgram
      ? plansById.get(firstProgram.plan_id)
      : null
    setSelectedStudentId(student.id)
    setEditForm(studentToEditForm(student))
    setPaymentForm((current) => ({
      ...current,
      membership_id: firstProgram?.program_id ?? '',
      ...paymentValidityFields(current.payment_date || todayDate(), firstProgramPlan),
    }))
    setError(null)
    setSuccess(null)
    setTrainingNoteForm(buildTrainingNoteForm())
    setFileMetadataForm(buildFileMetadataForm())
    setUploadFileForm(buildUploadFileForm())
    setProgramEditForm(null)
    setProgramDeleteTarget(null)
    setProgramDeleteConfirmation('')
    setFixedScheduleForm({
      membership_id: firstFixedProgram?.program_id ?? '',
      weekdays: [],
      start_time: '',
    })
    setFixedScheduleOptions([])
    setFixedScheduleResult(null)
    setFixedScheduleCancelForm({
      schedule_id: '',
      cancel_past: false,
      reason: '',
    })
    setFixedScheduleCancelPreview(null)
    setPasswordForm({ password: '', confirmation: '' })
    setPasswordMessage(null)
    setDriveStatus(null)
    setUploadInputKey((current) => current + 1)
    void loadSelectedStudentOperations(student.id)
  }

  function toggleFixedScheduleWeekday(day: number) {
    setFixedScheduleResult(null)
    setFixedScheduleForm((current) => {
      const nextWeekdays = current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day].sort((left, right) => left - right)

      return { ...current, weekdays: nextWeekdays }
    })
  }

  function resetFixedScheduleSelection() {
    setFixedScheduleForm((current) => ({
      ...current,
      weekdays: [],
      start_time: fixedScheduleOptions[0]?.start_time ?? '',
    }))
    setFixedScheduleResult(null)
  }

  async function handlePreviewFixedSchedule() {
    if (!selectedStudent || !fixedScheduleForm.membership_id) {
      return
    }

    setFixedScheduleLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await previewFixedScheduleForStudent({
        student_id: selectedStudent.id,
        membership_id: fixedScheduleForm.membership_id,
        weekdays: fixedScheduleForm.weekdays,
        start_time: fixedScheduleForm.start_time,
      })
      setFixedScheduleResult(result)
    } catch (previewError) {
      setError(formatAdminError(previewError))
    } finally {
      setFixedScheduleLoading(false)
    }
  }

  async function handleCreateFixedScheduleBookings() {
    if (!selectedStudent || !fixedScheduleResult || !fixedScheduleForm.membership_id) {
      return
    }

    setFixedScheduleLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await bulkBookFixedScheduleForStudent({
        student_id: selectedStudent.id,
        membership_id: fixedScheduleForm.membership_id,
        weekdays: fixedScheduleForm.weekdays,
        start_time: fixedScheduleForm.start_time,
      })
      setFixedScheduleResult(result)
      setSuccess(
        `Reservas fijas creadas: ${result.created_count}. Ya existian: ${result.already_booked_count}.`,
      )
      await loadData()
    } catch (createFixedError) {
      setError(formatAdminError(createFixedError))
    } finally {
      setFixedScheduleLoading(false)
    }
  }

  async function handleDeactivateFixedSchedule(schedule: StudentFixedSchedule) {
    const confirmed = window.confirm(
      'Esto solo desactiva el horario habitual guardado. No cancela reservas ya creadas.',
    )

    if (!confirmed || !selectedStudent) {
      return
    }

    setFixedScheduleLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await deactivateStudentFixedSchedule(schedule.schedule_id)
      setSuccess('Horario habitual desactivado. Las reservas ya creadas no se cancelaron.')
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (deactivateError) {
      setError(formatAdminError(deactivateError))
    } finally {
      setFixedScheduleLoading(false)
    }
  }

  async function handlePreviewCancelFixedSchedule(schedule: StudentFixedSchedule) {
    setFixedScheduleLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const preview = await previewCancelFixedScheduleBookings({
        schedule_id: schedule.schedule_id,
        cancel_past:
          fixedScheduleCancelForm.schedule_id === schedule.schedule_id
            ? fixedScheduleCancelForm.cancel_past
            : false,
      })
      setFixedScheduleCancelForm((current) => ({
        schedule_id: schedule.schedule_id,
        cancel_past:
          current.schedule_id === schedule.schedule_id ? current.cancel_past : false,
        reason: current.schedule_id === schedule.schedule_id ? current.reason : '',
      }))
      setFixedScheduleCancelPreview(preview)
    } catch (previewError) {
      setError(formatAdminError(previewError))
    } finally {
      setFixedScheduleLoading(false)
    }
  }

  async function handleCancelFixedScheduleBookings(schedule: StudentFixedSchedule) {
    if (!selectedStudent) {
      return
    }

    setFixedScheduleLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await cancelFixedScheduleBookings({
        schedule_id: schedule.schedule_id,
        reason: fixedScheduleCancelForm.reason,
        cancel_past: fixedScheduleCancelForm.cancel_past,
      })
      setSuccess(
        `Reservas fijas canceladas: ${result.cancelled_count}. No se borraron reservas.`,
      )
      setFixedScheduleCancelPreview(null)
      setFixedScheduleCancelForm({
        schedule_id: '',
        cancel_past: false,
        reason: '',
      })
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (cancelError) {
      setError(formatAdminError(cancelError))
    } finally {
      setFixedScheduleLoading(false)
    }
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await createStudent(studentForm)
      setSuccess(
        'Alumno creado. Entrega la contraseña provisoria de forma manual y no la guardes.',
      )
      setStudentForm({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        password: '',
        receives_emails: true,
      })
      await loadData()
    } catch (createError) {
      setError(formatAdminError(createError))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent || !editForm) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updateStudent(selectedStudent.id, editForm)
      setSuccess('Alumno actualizado.')
      await loadData()
    } catch (updateError) {
      setError(formatAdminError(updateError))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateStudentPassword() {
    if (!selectedStudent) {
      return
    }

    const nextPassword = passwordForm.password.trim()
    const confirmation = passwordForm.confirmation.trim()

    setPasswordMessage(null)
    setError(null)
    setSuccess(null)

    if (nextPassword.length < 8) {
      setPasswordMessage('La nueva contrasena debe tener al menos 8 caracteres.')
      return
    }

    if (nextPassword !== confirmation) {
      setPasswordMessage('La confirmacion de contrasena no coincide.')
      return
    }

    setPasswordSaving(true)
    try {
      const result = await updateStudentPassword({
        student_id: selectedStudent.id,
        password: nextPassword,
      })
      setPasswordForm({ password: '', confirmation: '' })
      setPasswordMessage(
        result.warning
          ? `Contrasena del alumno actualizada. ${result.warning}`
          : 'Contrasena del alumno actualizada.',
      )
    } catch (updateError) {
      setPasswordMessage(formatAdminError(updateError))
    } finally {
      setPasswordSaving(false)
    }
  }

  async function handleDeactivateStudent() {
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deactivateStudent(selectedStudent.id)
      setSuccess('Alumno desactivado. El historial se conserva.')
      await loadData()
    } catch (deactivateError) {
      setError(formatAdminError(deactivateError))
    } finally {
      setSaving(false)
    }
  }

  function openDeleteStudentModal() {
    if (!selectedStudent) {
      return
    }

    setDeleteConfirmation('')
    setError(null)
    setSuccess(null)
    setDeleteModalOpen(true)
  }

  function closeDeleteStudentModal() {
    if (saving) {
      return
    }

    setDeleteConfirmation('')
    setDeleteModalOpen(false)
  }

  async function handleDeleteStudent() {
    if (!selectedStudent || deleteConfirmation !== 'ELIMINAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteStudent(selectedStudent.id)
      setSuccess('Alumno eliminado definitivamente.')
      setSelectedStudentId(null)
      setEditForm(null)
      setDeleteConfirmation('')
      setDeleteModalOpen(false)
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  function handlePlanChange(planId: string) {
    const plan = plansById.get(planId)
    setMembershipForm({
      ...membershipForm,
      plan_id: planId,
      end_date: addDays(
        membershipForm.start_date,
        (plan?.billing_period_days ?? 30) - 1,
      ),
      remaining_credits: planDefaultPackageClasses(plan),
    })
  }

  function handleProgramEditPlanChange(planId: string) {
    if (!programEditForm) {
      return
    }

    const plan = plansById.get(planId)
    setProgramEditForm({
      ...programEditForm,
      plan_id: planId,
      remaining_credits: planDefaultPackageClasses(plan),
    })
  }

  async function handleAssignMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await assignMembership({
        student_id: selectedStudent.id,
        plan_id: membershipForm.plan_id,
        start_date: membershipForm.start_date,
        end_date: membershipForm.end_date,
        remaining_credits: membershipForm.remaining_credits
          ? Number(membershipForm.remaining_credits)
          : null,
      })
      setSuccess('Programa asignado. Queda pendiente hasta registrar pago completo.')
      await loadData()
    } catch (assignError) {
      setError(formatAdminError(assignError))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!programEditForm || !programEditTarget) {
      return
    }

    if (
      programHasHistory(programEditTarget) &&
      programEditForm.confirmation !== 'EDITAR'
    ) {
      setError('Para editar un programa con historial escribi EDITAR.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updateStudentProgram({
        program_id: programEditForm.program_id,
        plan_id: programEditForm.plan_id,
        status: programEditForm.status,
        start_date: programEditForm.start_date,
        end_date: programEditForm.end_date,
        remaining_credits: programEditForm.remaining_credits
          ? Number(programEditForm.remaining_credits)
          : null,
        confirm_history: programHasHistory(programEditTarget)
          ? programEditForm.confirmation
          : null,
      })
      setSuccess('Programa actualizado.')
      setProgramEditForm(null)
      await loadData()
    } catch (updateError) {
      setError(formatAdminError(updateError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteProgram() {
    if (!programDeleteTarget || programDeleteConfirmation !== 'ELIMINAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await deleteStudentProgram(
        programDeleteTarget.program_id,
        programDeleteConfirmation,
      )
      const cancelledCount = result.future_active_bookings_cancelled ?? 0
      setSuccess(
        cancelledCount > 0
          ? `Programa eliminado del alumno. Reservas futuras canceladas: ${cancelledCount}.`
          : 'Programa eliminado del alumno.',
      )
      setProgramDeleteTarget(null)
      setProgramDeleteConfirmation('')
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  async function handleRegisterPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent) {
      return
    }

    const amount = Number(paymentForm.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('El monto debe ser un numero mayor o igual a cero.')
      return
    }

    if (
      !paymentForm.membership_start_date ||
      !paymentForm.membership_end_date ||
      paymentForm.membership_end_date < paymentForm.membership_start_date
    ) {
      setError('La vigencia del programa no es valida.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const paymentResult = await registerManualPayment({
        student_id: selectedStudent.id,
        membership_id: paymentForm.membership_id,
        amount,
        method: paymentForm.method,
        payment_date: paymentForm.payment_date,
        membership_start_date: paymentForm.membership_start_date,
        membership_end_date: paymentForm.membership_end_date,
        notes: paymentForm.notes,
      })
      setSuccess(
        paymentResult.is_fully_paid === false
          ? `Pago registrado, pero el programa todavia no se activa porque falta ${moneyFormatter.format(paymentResult.pending_amount ?? 0)}.`
          : 'Pago registrado y programa activado.',
      )
      const selectedPaymentPlanId = selectedStudentPrograms.find(
        (program) => program.program_id === paymentForm.membership_id,
      )?.plan_id
      const nextPaymentDate = todayDate()
      setPaymentForm({
        ...paymentForm,
        amount: '',
        payment_date: nextPaymentDate,
        ...paymentValidityFields(
          nextPaymentDate,
          plansById.get(selectedPaymentPlanId ?? ''),
        ),
        notes: '',
      })
      await loadData()
    } catch (paymentError) {
      setError(formatAdminError(paymentError))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTrainingNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await upsertTrainingNote({
        note_id: trainingNoteForm.note_id,
        student_id: selectedStudent.id,
        note_type: trainingNoteForm.note_type,
        title: trainingNoteForm.title,
        body: trainingNoteForm.body,
        visible_to_student: trainingNoteForm.visible_to_student,
      })
      setSuccess(
        trainingNoteForm.note_id
          ? 'Nota actualizada.'
          : 'Nota creada para el alumno.',
      )
      setTrainingNoteForm(buildTrainingNoteForm())
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (noteError) {
      setError(formatAdminError(noteError))
    } finally {
      setSaving(false)
    }
  }

  function editTrainingNote(note: AdminTrainingNote) {
    setTrainingNoteForm({
      note_id: note.note_id,
      note_type: note.note_type,
      title: note.title,
      body: note.body ?? '',
      visible_to_student: note.visible_to_student,
    })
    setError(null)
    setSuccess(null)
  }

  async function handleArchiveTrainingNote(noteId: string) {
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await archiveTrainingNote(noteId)
      setSuccess('Nota archivada.')
      setTrainingNoteForm(buildTrainingNoteForm())
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (archiveError) {
      setError(formatAdminError(archiveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveFileMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input: StudentFileMetadataInput = {
        ...fileMetadataForm,
        student_id: selectedStudent.id,
      }
      if (fileMetadataForm.file_id) {
        await updateStudentFileMetadata({
          ...input,
          file_id: fileMetadataForm.file_id,
        })
        setSuccess('Documento actualizado.')
      } else {
        await createStudentFileMetadata(input)
        setSuccess('Documento registrado.')
      }
      setFileMetadataForm(buildFileMetadataForm())
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (fileError) {
      setError(formatAdminError(fileError))
    } finally {
      setSaving(false)
    }
  }

  async function handleUploadStudentFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent) {
      return
    }

    if (!uploadFileForm.file) {
      setError('Selecciona un archivo para subir.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await uploadStudentFile({
        student_id: selectedStudent.id,
        kind: uploadFileForm.kind,
        title: uploadFileForm.title,
        description: uploadFileForm.description,
        visible_to_student: uploadFileForm.visible_to_student,
        file: uploadFileForm.file,
      })
      setDriveStatus(result.drive_status)
      setSuccess(
        result.drive_status?.warning
          ? 'Archivo subido. Atencion: queda 10% o menos de espacio en Drive.'
          : 'Archivo subido a Drive y registrado.',
      )
      setUploadFileForm(buildUploadFileForm())
      setUploadInputKey((current) => current + 1)
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (uploadError) {
      setError(formatAdminError(uploadError))
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckDriveStatus() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const status = await checkDriveStatus()
      setDriveStatus(status)
      setSuccess(
        status.warning
          ? 'Drive revisado. Atencion: queda 10% o menos de espacio disponible.'
          : 'Drive revisado sin alerta de espacio.',
      )
    } catch (statusError) {
      setError(formatAdminError(statusError))
    } finally {
      setSaving(false)
    }
  }

  function editFileMetadata(file: AdminStudentFile) {
    setFileMetadataForm({
      file_id: file.file_id,
      kind: file.kind,
      title: file.title,
      description: file.description ?? '',
      drive_url: file.drive_url ?? '',
      mime_type: file.mime_type ?? '',
      size_bytes: file.size_bytes === null ? '' : String(file.size_bytes),
      visible_to_student: file.visible_to_student,
    })
    setError(null)
    setSuccess(null)
  }

  async function handleArchiveFileMetadata(fileId: string) {
    if (!selectedStudent) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await archiveStudentFileMetadata(fileId)
      setSuccess('Documento archivado.')
      setFileMetadataForm(buildFileMetadataForm())
      await loadSelectedStudentOperations(selectedStudent.id)
    } catch (archiveError) {
      setError(formatAdminError(archiveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid w-full min-w-0 max-w-full gap-5 overflow-x-auto pb-24">
      <div className="contents">
        <div className="order-1 min-w-0 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Alumnos
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Gestion de alumnos
            </h3>
          </div>
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
            onClick={() => void loadData()}
            type="button"
          >
            Actualizar
          </button>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-[var(--muted)]">Cargando alumnos...</p>
        ) : students.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            Todavía no hay alumnos creados. Cuando cargues el primero, va a
            aparecer en esta lista.
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            <div>
              <label
                className="text-sm font-semibold"
                htmlFor="student-search"
              >
                Buscar alumno
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="student-search"
                onChange={(event) =>
                  handleStudentSearchChange(event.target.value)
                }
                placeholder="Nombre, apellido, email o telefono"
                value={studentSearch}
              />
            </div>

            {filteredStudents.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
                No hay alumnos que coincidan con la busqueda.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[20px] border border-[var(--line)]">
            <div className="grid min-w-[760px] grid-cols-[1.2fr_1.5fr_0.85fr_0.65fr_0.8fr] bg-[var(--surface-strong)] px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              <span>Nombre</span>
              <span>Email</span>
              <span>Telefono</span>
              <span>Estado</span>
              <span>Ultimo pago</span>
            </div>
            <div className="grid max-h-[300px] overflow-y-auto overflow-x-hidden">
              {filteredStudents.map((student) => (
                <button
                  className={`grid min-w-[760px] grid-cols-[1.2fr_1.5fr_0.85fr_0.65fr_0.8fr] px-4 py-3 text-left text-sm transition ${
                    selectedStudent?.id === student.id
                      ? 'bg-[var(--brand-soft)]'
                      : 'bg-white hover:bg-[var(--surface-strong)]'
                  }`}
                  key={student.id}
                  onClick={() => selectStudent(student)}
                  type="button"
                >
                  <span className="min-w-0 truncate font-semibold text-[var(--brand)] underline-offset-4 hover:underline">
                    {studentDisplayName(student)}
                  </span>
                  <span className="min-w-0 truncate">{student.email}</span>
                  <span className="min-w-0 truncate">{student.phone ?? '-'}</span>
                  <span className="min-w-0 truncate">{student.active ? 'Activo' : 'Inactivo'}</span>
                  <span className="min-w-0 truncate">
                    {student.last_payment_at
                      ? new Date(student.last_payment_at).toLocaleDateString(
                          'es-AR',
                        )
                      : '-'}
                  </span>
                </button>
              ))}
            </div>
              </div>
            )}
          </div>
        )}
        </div>

        {selectedStudent ? (
          <div className="contents">
            <div className="order-2 grid min-w-0 gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(420px,1.2fr)]">
            <article className="min-w-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Ficha
              </p>
              <h4 className="mt-2 font-display text-xl font-bold">
                {studentDisplayName(selectedStudent)}
              </h4>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {selectedStudent.email}
              </p>
              <dl className="mt-4 grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">Recibe emails</dt>
                  <dd>{selectedStudent.receives_emails ? 'Si' : 'No'}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">
                    Ultima actividad real
                  </dt>
                  <dd>
                    {selectedStudent.last_real_activity_at
                      ? new Date(
                          selectedStudent.last_real_activity_at,
                        ).toLocaleDateString('es-AR')
                      : '-'}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="min-w-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Programas asignados
              </p>
              <div className="mt-3 grid max-h-[460px] gap-3 overflow-y-auto pr-1 text-sm">
                {selectedStudentPrograms.length === 0 ? (
                  <p className="text-[var(--muted)]">
                    Sin programas asignados.
                  </p>
                ) : (
                  selectedStudentPrograms.map((program) => {
                    const plan = plansById.get(program.plan_id)
                    return (
                      <div
                        className="grid min-w-0 gap-3 rounded-2xl border border-[var(--line)] bg-white p-3"
                        key={program.program_id}
                      >
                        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <p className="break-words text-base font-semibold leading-snug">
                              {program.plan_name ?? plan?.name ?? 'Plan no disponible'}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                              <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-[var(--muted)]">
                                {programDisplayStatus(program)}
                              </span>
                              <span className="rounded-full bg-[var(--surface-strong)] px-3 py-1 text-[var(--muted)]">
                                {program.start_date} a {program.end_date}
                              </span>
                              <span
                                className={`rounded-full px-3 py-1 ${
                                  program.is_fully_paid
                                    ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                                    : 'bg-[var(--accent-soft)] text-[var(--accent)]'
                                }`}
                              >
                                {programPaymentStateLabels[program.payment_state]}
                              </span>
                            </div>
                          </div>
                          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:min-w-[260px]">
                            <button
                              className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold transition hover:bg-[var(--brand-soft)]"
                              onClick={() =>
                                setProgramEditForm(buildProgramEditForm(program))
                              }
                              type="button"
                            >
                              Editar programa
                            </button>
                            <button
                              className="rounded-2xl border border-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                              onClick={() => {
                                setProgramDeleteTarget(program)
                                setProgramDeleteConfirmation('')
                              }}
                              type="button"
                            >
                              Eliminar programa
                            </button>
                          </div>
                        </div>

                        <dl className="grid gap-2 sm:grid-cols-3">
                          <div className="rounded-xl bg-[var(--surface-strong)] px-3 py-1.5">
                            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                              Precio
                            </dt>
                            <dd className="mt-1 text-sm font-bold">
                              {moneyFormatter.format(program.plan_price)}
                            </dd>
                          </div>
                          <div className="rounded-xl bg-[var(--surface-strong)] px-3 py-1.5">
                            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                              Pagado
                            </dt>
                            <dd className="mt-1 text-sm font-bold">
                              {moneyFormatter.format(program.approved_paid_total)}
                            </dd>
                          </div>
                          <div className="rounded-xl bg-[var(--surface-strong)] px-3 py-1.5">
                            <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                              Saldo
                            </dt>
                            <dd className="mt-1 text-sm font-bold">
                              {moneyFormatter.format(program.pending_amount)}
                            </dd>
                          </div>
                        </dl>

                        <div className="grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                          <p className="rounded-xl border border-[var(--line)] px-3 py-1.5">
                            {program.remaining_credits === null
                              ? 'Clases disponibles segun limite del programa'
                              : `${program.remaining_credits} clases disponibles`}
                          </p>
                          <p className="rounded-xl border border-[var(--line)] px-3 py-1.5">
                            Ultimo pago vinculado:{' '}
                            {program.last_payment_at
                              ? new Date(program.last_payment_at).toLocaleDateString(
                                  'es-AR',
                                )
                              : 'Sin pago'}
                          </p>
                        </div>

                        {programHasHistory(program) ? (
                          <div className="rounded-xl bg-[var(--page)] px-3 py-1.5 text-xs text-[var(--muted)]">
                            <p className="font-bold text-[var(--ink)]">Historial</p>
                            <p className="mt-1 font-semibold">
                              {programHistorySummary(program)}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </article>
            </div>

            <article className="order-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                    Reserva fija del alumno
                  </p>
                  <h4 className="mt-2 font-display text-xl font-bold">
                    Horarios habituales
                  </h4>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Elegi dias y horarios habituales para reservar clases
                    existentes durante la vigencia del programa.
                  </p>
                </div>
              </div>

              {selectedStudentPrograms.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  Este alumno no tiene programas activos para reservar.
                </p>
              ) : fixedSchedulePrograms.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  Este alumno no tiene programas activos con pago completo.
                </p>
              ) : (
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                    <label className="grid gap-2 text-sm font-semibold">
                      Programa
                      <select
                        className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal"
                        onChange={(event) => {
                          setFixedScheduleForm({
                            membership_id: event.target.value,
                            weekdays: [],
                            start_time: '',
                          })
                          setFixedScheduleResult(null)
                        }}
                        value={fixedScheduleForm.membership_id}
                      >
                        {fixedSchedulePrograms.map((program) => {
                          const plan = plansById.get(program.plan_id)
                          return (
                            <option key={program.program_id} value={program.program_id}>
                              {describeProgramOption(program, plan)}
                            </option>
                          )
                        })}
                      </select>
                    </label>

                    <label className="grid gap-2 text-sm font-semibold">
                      Horario
                      <select
                        className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal disabled:opacity-60"
                        disabled={
                          fixedScheduleLoading || fixedScheduleOptions.length === 0
                        }
                        onChange={(event) => {
                          setFixedScheduleForm({
                            ...fixedScheduleForm,
                            start_time: event.target.value,
                          })
                          setFixedScheduleResult(null)
                        }}
                        value={fixedScheduleForm.start_time}
                      >
                        {fixedScheduleOptions.length === 0 ? (
                          <option value="">
                            No hay clases creadas para esta actividad
                          </option>
                        ) : (
                          fixedScheduleOptions.map((option) => (
                            <option key={option.start_time} value={option.start_time}>
                              {option.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>

                  {selectedFixedScheduleProgram ? (
                    <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-white p-3 text-xs text-[var(--muted)] sm:grid-cols-3">
                      <p>
                        <span className="font-bold text-[var(--ink)]">Vigencia: </span>
                        {selectedFixedScheduleProgram.start_date} a{' '}
                        {selectedFixedScheduleProgram.end_date}
                      </p>
                      <p>
                        <span className="font-bold text-[var(--ink)]">Estado: </span>
                        {programDisplayStatus(selectedFixedScheduleProgram)}
                      </p>
                      <p>
                        <span className="font-bold text-[var(--ink)]">Clases: </span>
                        {selectedFixedSchedulePlan?.plan_type === 'weekly'
                          ? weeklyPlanLabel(selectedFixedSchedulePlan)
                          : selectedFixedScheduleProgram.remaining_credits === null
                            ? 'segun programa'
                            : `${selectedFixedScheduleProgram.remaining_credits} disponibles`}
                      </p>
                    </div>
                  ) : null}

                  <div className="grid gap-2">
                    <p className="text-sm font-semibold">Dias de la semana</p>
                    <div className="flex flex-wrap gap-2">
                      {weekdayOptions.map((day) => (
                        <label
                          className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold ${
                            fixedScheduleForm.weekdays.includes(day.value)
                              ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                              : 'border-[var(--line)] bg-white text-[var(--ink)]'
                          }`}
                          key={day.value}
                        >
                          <input
                            checked={fixedScheduleForm.weekdays.includes(day.value)}
                            onChange={() => toggleFixedScheduleWeekday(day.value)}
                            type="checkbox"
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                      disabled={
                        fixedScheduleLoading ||
                        fixedScheduleForm.weekdays.length === 0 ||
                        !fixedScheduleForm.start_time
                      }
                      onClick={handlePreviewFixedSchedule}
                      type="button"
                    >
                      Previsualizar reservas
                    </button>
                    <button
                      className="rounded-2xl border border-[var(--line)] px-5 py-3 text-sm font-bold transition hover:bg-white"
                      onClick={resetFixedScheduleSelection}
                      type="button"
                    >
                      Cancelar seleccion
                    </button>
                  </div>

                  {fixedScheduleResult ? (
                    <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4">
                      <div className="grid gap-2 text-sm sm:grid-cols-4">
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Encontradas:{' '}
                          <strong>{fixedScheduleResult.total_found}</strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Disponibles:{' '}
                          <strong>{fixedScheduleResult.available_count}</strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Ya reservadas:{' '}
                          <strong>
                            {fixedScheduleResult.already_booked_count}
                          </strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Sin cupo:{' '}
                          <strong>{fixedScheduleResult.skipped_full_count}</strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Fuera de vigencia:{' '}
                          <strong>
                            {fixedScheduleResult.skipped_out_of_validity_count}
                          </strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Limite semanal:{' '}
                          <strong>
                            {fixedScheduleResult.skipped_weekly_limit_count}
                          </strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Conflictos:{' '}
                          <strong>
                            {fixedScheduleResult.skipped_conflict_count}
                          </strong>
                        </p>
                        <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                          Creadas:{' '}
                          <strong>{fixedScheduleResult.created_count}</strong>
                        </p>
                      </div>

                      {fixedScheduleResult.total_found === 0 ? (
                        <p className="rounded-2xl border border-dashed border-[var(--line)] p-3 text-sm text-[var(--muted)]">
                          No se encontraron clases para esos dias y horario.
                        </p>
                      ) : (
                        <div className="max-h-72 overflow-y-auto pr-1">
                          <div className="grid gap-2 text-xs">
                            {fixedScheduleResult.details.slice(0, 40).map((detail) => (
                              <div
                                className="grid gap-1 rounded-xl border border-[var(--line)] px-3 py-2 sm:grid-cols-[1fr_auto]"
                                key={detail.session_id}
                              >
                                <p className="font-semibold text-[var(--ink)]">
                                  {formatDisplayDate(detail.starts_at)} ·{' '}
                                  {new Date(detail.starts_at).toLocaleTimeString(
                                    'es-AR',
                                    { hour: '2-digit', minute: '2-digit' },
                                  )}{' '}
                                  · {detail.activity_name}
                                </p>
                                <p className="text-[var(--muted)]">
                                  {fixedScheduleStatusLabels[detail.status] ??
                                    detail.status}
                                  {detail.reason ? ` · ${detail.reason}` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {fixedScheduleResult.mode === 'preview' ? (
                        <button
                          className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                          disabled={
                            fixedScheduleLoading ||
                            fixedScheduleResult.available_count === 0
                          }
                          onClick={handleCreateFixedScheduleBookings}
                          type="button"
                        >
                          Crear reservas fijas
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </article>

            <article className="order-4 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                    Horarios habituales seteados
                  </p>
                  <h4 className="mt-2 font-display text-xl font-bold">
                    Configuraciones guardadas
                  </h4>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Estos son los dias y horarios habituales guardados para el
                    alumno. Las reservas ya creadas se ven en Asistencia.
                  </p>
                </div>
                {selectedStudent ? (
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-white"
                    onClick={() => loadSelectedStudentOperations(selectedStudent.id)}
                    type="button"
                  >
                    Actualizar
                  </button>
                ) : null}
              </div>

              {selectedStudentFixedSchedules.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
                  No hay horarios habituales seteados para este alumno.
                </p>
              ) : (
                <div className="mt-4 grid gap-3">
                  {selectedStudentFixedSchedules.map((schedule) => {
                    const previewForSchedule =
                      fixedScheduleCancelPreview?.schedule_id ===
                      schedule.schedule_id
                        ? fixedScheduleCancelPreview
                        : null
                    return (
                      <div
                        className="grid gap-4 rounded-2xl border border-[var(--line)] bg-white p-3"
                        key={schedule.schedule_id}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="font-semibold text-[var(--ink)]">
                              {schedule.plan_name}
                            </p>
                            <p className="mt-1 text-sm text-[var(--muted)]">
                              {schedule.activity_name} · Horario:{' '}
                              {String(schedule.start_time).slice(0, 5)} ·{' '}
                              {schedule.weekday_labels}
                            </p>
                          </div>
                          <span
                            className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                              schedule.active
                                ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                                : 'bg-[var(--surface-strong)] text-[var(--muted)]'
                            }`}
                          >
                            {schedule.active ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>

                        <div className="grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-4">
                          <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                            <span className="font-bold text-[var(--ink)]">
                              Vigencia:{' '}
                            </span>
                            {schedule.membership_start_date} a{' '}
                            {schedule.membership_end_date}
                          </p>
                          <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                            <span className="font-bold text-[var(--ink)]">
                              Programa:{' '}
                            </span>
                            {programStatusLabels[schedule.membership_status]}
                          </p>
                          <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                            <span className="font-bold text-[var(--ink)]">
                              Reservas:{' '}
                            </span>
                            {schedule.booking_details.length}
                          </p>
                          <p className="rounded-xl bg-[var(--surface-strong)] px-3 py-2">
                            <span className="font-bold text-[var(--ink)]">
                              Ultima aplicacion:{' '}
                            </span>
                            {schedule.last_applied_at
                              ? new Date(schedule.last_applied_at).toLocaleString(
                                  'es-AR',
                                )
                              : 'Sin aplicar'}
                          </p>
                        </div>

                        <div className="grid gap-2 md:grid-cols-7">
                          {weekdayOptions.map((day) => {
                            const dayBookings = schedule.booking_details.filter(
                              (detail) => detail.weekday === day.value,
                            )
                            return (
                              <div
                                className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-2"
                                key={day.value}
                              >
                                <p className="text-xs font-bold text-[var(--ink)]">
                                  {day.label}
                                </p>
                                <div className="mt-2 grid gap-1">
                                  {dayBookings.length === 0 ? (
                                    <p className="text-xs text-[var(--muted)]">
                                      Sin reservas fijas
                                    </p>
                                  ) : (
                                    dayBookings.map((booking) => (
                                      <div
                                        className="rounded-lg bg-white px-2 py-1 text-[11px] leading-snug"
                                        key={booking.booking_id}
                                      >
                                        <p className="font-semibold text-[var(--ink)]">
                                          {formatDisplayDate(booking.starts_at)} ·{' '}
                                          {new Date(
                                            booking.starts_at,
                                          ).toLocaleTimeString('es-AR', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </p>
                                        <p className="text-[var(--muted)]">
                                          {bookingStatusLabels[
                                            booking.booking_status
                                          ] ?? booking.booking_status}
                                          {booking.is_past ? ' · pasada' : ''}
                                        </p>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                          <button
                            className="rounded-2xl border border-[var(--line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                            disabled={fixedScheduleLoading}
                            onClick={() => handlePreviewCancelFixedSchedule(schedule)}
                            type="button"
                          >
                            Previsualizar cancelacion
                          </button>
                          {schedule.active ? (
                            <button
                              className="rounded-2xl border border-[var(--line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                              disabled={fixedScheduleLoading}
                              onClick={() => handleDeactivateFixedSchedule(schedule)}
                              type="button"
                            >
                              Desactivar horario habitual
                            </button>
                          ) : null}
                        </div>

                        {previewForSchedule ? (
                          <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                            <div className="grid gap-2 text-xs sm:grid-cols-4">
                              <p className="rounded-xl bg-white px-3 py-2">
                                Coincidencias:{' '}
                                <strong>
                                  {previewForSchedule.total_matching_bookings}
                                </strong>
                              </p>
                              <p className="rounded-xl bg-white px-3 py-2">
                                Cancelables:{' '}
                                <strong>
                                  {previewForSchedule.cancellable_count}
                                </strong>
                              </p>
                              <p className="rounded-xl bg-white px-3 py-2">
                                Futuras:{' '}
                                <strong>{previewForSchedule.future_count}</strong>
                              </p>
                              <p className="rounded-xl bg-white px-3 py-2">
                                Ya canceladas:{' '}
                                <strong>
                                  {previewForSchedule.already_cancelled_count}
                                </strong>
                              </p>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
                              <input
                                checked={
                                  fixedScheduleCancelForm.schedule_id ===
                                    schedule.schedule_id &&
                                  fixedScheduleCancelForm.cancel_past
                                }
                                onChange={(event) => {
                                  const nextCancelPast = event.target.checked
                                  setFixedScheduleCancelForm((current) => ({
                                    ...current,
                                    schedule_id: schedule.schedule_id,
                                    cancel_past: nextCancelPast,
                                  }))
                                  void previewCancelFixedScheduleBookings({
                                    schedule_id: schedule.schedule_id,
                                    cancel_past: nextCancelPast,
                                  }).then(setFixedScheduleCancelPreview)
                                }}
                                type="checkbox"
                              />
                              Incluir reservas pasadas
                            </label>
                            <textarea
                              className="min-h-20 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                              onChange={(event) =>
                                setFixedScheduleCancelForm((current) => ({
                                  ...current,
                                  schedule_id: schedule.schedule_id,
                                  reason: event.target.value,
                                }))
                              }
                              placeholder="Motivo para cancelar reservas fijas"
                              value={
                                fixedScheduleCancelForm.schedule_id ===
                                schedule.schedule_id
                                  ? fixedScheduleCancelForm.reason
                                  : ''
                              }
                            />
                            <button
                              className="w-fit rounded-2xl border border-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                              disabled={
                                fixedScheduleLoading ||
                                previewForSchedule.cancellable_count === 0 ||
                                fixedScheduleCancelForm.schedule_id !==
                                  schedule.schedule_id ||
                                fixedScheduleCancelForm.reason.trim() === ''
                              }
                              onClick={() => handleCancelFixedScheduleBookings(schedule)}
                              type="button"
                            >
                              Cancelar reservas fijas
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </article>

            <article className="order-9 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Plan de entrenamiento
              </p>
              {activeTrainingPlan ? (
                <div className="mt-3 rounded-2xl border border-[var(--line)] bg-white p-3 text-sm">
                  <p className="font-semibold">{activeTrainingPlan.title}</p>
                  {activeTrainingPlan.body ? (
                    <p className="mt-2 whitespace-pre-wrap text-[var(--muted)]">
                      {activeTrainingPlan.body}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {activeTrainingPlan.visible_to_student
                      ? 'Visible para el alumno'
                      : 'Solo administracion'}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Todavia no hay plan de entrenamiento registrado.
                </p>
              )}
            </article>

            <article className="order-8 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                    Plan y observaciones
                  </p>
                  <h4 className="mt-2 font-display text-xl font-bold">
                    Registrar nota
                  </h4>
                </div>
                <button
                  className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-white"
                  onClick={() => setTrainingNoteForm(buildTrainingNoteForm())}
                  type="button"
                >
                  Nueva nota
                </button>
              </div>

              <form
                className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4"
                onSubmit={handleSaveTrainingNote}
              >
                <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
                  <select
                    aria-label="Tipo de nota"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setTrainingNoteForm({
                        ...trainingNoteForm,
                        note_type: event.target.value as TrainingNoteType,
                      })
                    }
                    value={trainingNoteForm.note_type}
                  >
                    {Object.entries(noteTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Titulo de nota"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setTrainingNoteForm({
                        ...trainingNoteForm,
                        title: event.target.value,
                      })
                    }
                    placeholder="Titulo"
                    value={trainingNoteForm.title}
                  />
                </div>
                <textarea
                  aria-label="Contenido de nota"
                  className="min-h-28 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setTrainingNoteForm({
                      ...trainingNoteForm,
                      body: event.target.value,
                    })
                  }
                  placeholder="Detalle operativo, plan o seguimiento"
                  value={trainingNoteForm.body}
                />
                <label className="flex items-center gap-3 text-sm font-semibold">
                  <input
                    checked={trainingNoteForm.visible_to_student}
                    onChange={(event) =>
                      setTrainingNoteForm({
                        ...trainingNoteForm,
                        visible_to_student: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Visible para alumno
                </label>
                <button
                  className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  {trainingNoteForm.note_id ? 'Actualizar nota' : 'Guardar nota'}
                </button>
              </form>
            </article>

            <article className="order-10 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Seguimiento operativo
              </p>
              <h4 className="mt-2 font-display text-xl font-bold">
                Notas y actividad registrada
              </h4>
              <div className="mt-4 grid gap-2 text-sm">
                {selectedTrainingNotes.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-4 text-[var(--muted)]">
                    Sin plan ni observaciones registradas.
                  </p>
                ) : (
                  selectedTrainingNotes.map((note) => (
                    <div
                      className={`rounded-2xl border border-[var(--line)] bg-white p-3 ${
                        note.archived_at ? 'opacity-60' : ''
                      }`}
                      key={note.note_id}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold">{note.title}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {noteTypeLabels[note.note_type]} ·{' '}
                            {note.visible_to_student
                              ? 'Visible para alumno'
                              : 'Solo administracion'}
                            {note.archived_at ? ' · Archivada' : ''}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-semibold"
                            onClick={() => editTrainingNote(note)}
                            type="button"
                          >
                            Editar
                          </button>
                          {!note.archived_at ? (
                            <button
                              className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-semibold"
                              onClick={() =>
                                void handleArchiveTrainingNote(note.note_id)
                              }
                              type="button"
                            >
                              Archivar
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {note.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-[var(--muted)]">
                          {note.body}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="order-11 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                    Archivos
                  </p>
                  <h4 className="mt-2 font-display text-xl font-bold">
                    Documentos en Drive
                  </h4>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Sube archivos desde backend seguro y controla que puede ver
                    el alumno.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-white"
                    disabled={saving}
                    onClick={() => void handleCheckDriveStatus()}
                    type="button"
                  >
                    Revisar Drive
                  </button>
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-white"
                    onClick={() => setFileMetadataForm(buildFileMetadataForm())}
                    type="button"
                  >
                    Nuevo documento
                  </button>
                </div>
              </div>

              {driveStatus ? (
                <div
                  className={`mt-4 rounded-2xl border p-4 text-sm ${
                    driveStatus.warning
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] bg-white'
                  }`}
                >
                  <p className="font-semibold text-[var(--ink)]">
                    Estado de Google Drive
                  </p>
                  <p className="mt-1 text-[var(--muted)]">
                    Usado: {formatSize(driveStatus.used_bytes)} /{' '}
                    {formatSize(driveStatus.total_bytes)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Disponible:{' '}
                    {driveStatus.remaining_ratio === null
                      ? 'sin limite informado'
                      : `${Math.round(driveStatus.remaining_ratio * 100)}%`}
                  </p>
                </div>
              ) : null}

              <form
                className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4"
                onSubmit={handleUploadStudentFile}
              >
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Subir archivo real
                </p>
                <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
                  <select
                    aria-label="Tipo de archivo a subir"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setUploadFileForm({
                        ...uploadFileForm,
                        kind: event.target.value as FileKind,
                      })
                    }
                    value={uploadFileForm.kind}
                  >
                    {Object.entries(fileKindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Titulo del archivo a subir"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setUploadFileForm({
                        ...uploadFileForm,
                        title: event.target.value,
                      })
                    }
                    placeholder="Titulo"
                    value={uploadFileForm.title}
                  />
                </div>
                <textarea
                  aria-label="Descripcion del archivo a subir"
                  className="min-h-20 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setUploadFileForm({
                      ...uploadFileForm,
                      description: event.target.value,
                    })
                  }
                  placeholder="Descripcion visible si se comparte"
                  value={uploadFileForm.description}
                />
                <input
                  aria-label="Archivo"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  key={uploadInputKey}
                  onChange={(event) =>
                    setUploadFileForm({
                      ...uploadFileForm,
                      file: event.target.files?.[0] ?? null,
                    })
                  }
                  type="file"
                />
                <label className="flex items-center gap-3 text-sm font-semibold">
                  <input
                    checked={uploadFileForm.visible_to_student}
                    onChange={(event) =>
                      setUploadFileForm({
                        ...uploadFileForm,
                        visible_to_student: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Visible para alumno
                </label>
                <button
                  className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  Subir a Drive
                </button>
              </form>

              <form
                className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4"
                onSubmit={handleSaveFileMetadata}
              >
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Registrar o corregir datos del documento
                </p>
                <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
                  <select
                    aria-label="Tipo de documento"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        kind: event.target.value as FileKind,
                      })
                    }
                    value={fileMetadataForm.kind}
                  >
                    {Object.entries(fileKindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Titulo del documento"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        title: event.target.value,
                      })
                    }
                    placeholder="Titulo"
                    value={fileMetadataForm.title}
                  />
                </div>
                <textarea
                  aria-label="Descripcion del documento"
                  className="min-h-20 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setFileMetadataForm({
                      ...fileMetadataForm,
                      description: event.target.value,
                    })
                  }
                  placeholder="Descripcion o nota interna"
                  value={fileMetadataForm.description}
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    aria-label="URL opcional del documento"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        drive_url: event.target.value,
                      })
                    }
                    placeholder="URL opcional"
                    value={fileMetadataForm.drive_url}
                  />
                  <input
                    aria-label="Tipo MIME del documento"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        mime_type: event.target.value,
                      })
                    }
                    placeholder="Tipo MIME opcional"
                    value={fileMetadataForm.mime_type}
                  />
                  <input
                    aria-label="Tamano del documento"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    min="0"
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        size_bytes: event.target.value,
                      })
                    }
                    placeholder="Bytes opcional"
                    type="number"
                    value={fileMetadataForm.size_bytes}
                  />
                </div>
                <label className="flex items-center gap-3 text-sm font-semibold">
                  <input
                    checked={fileMetadataForm.visible_to_student}
                    onChange={(event) =>
                      setFileMetadataForm({
                        ...fileMetadataForm,
                        visible_to_student: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Visible para alumno
                </label>
                <button
                  className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  {fileMetadataForm.file_id
                    ? 'Actualizar documento'
                    : 'Registrar documento'}
                </button>
              </form>

              <div className="mt-4 grid gap-2 text-sm">
                {selectedStudentFiles.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-[var(--line)] bg-white p-4 text-[var(--muted)]">
                    Sin documentos registrados.
                  </p>
                ) : (
                  selectedStudentFiles.map((file) => (
                    <div
                      className={`rounded-2xl border border-[var(--line)] bg-white p-3 ${
                        file.archived_at ? 'opacity-60' : ''
                      }`}
                      key={file.file_id}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold">{file.title}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {fileKindLabels[file.kind]} · {formatSize(file.size_bytes)} ·{' '}
                            {file.visible_to_student
                              ? 'Visible para alumno'
                              : 'Solo administracion'}
                            {file.archived_at ? ' · Archivado' : ''}
                          </p>
                          {file.description ? (
                            <p className="mt-2 text-[var(--muted)]">
                              {file.description}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex gap-2">
                          {file.drive_url ? (
                            <a
                              className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-semibold"
                              href={file.drive_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Abrir
                            </a>
                          ) : null}
                          <button
                            className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-semibold"
                            onClick={() => editFileMetadata(file)}
                            type="button"
                          >
                            Editar
                          </button>
                          {!file.archived_at ? (
                            <button
                              className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs font-semibold"
                              onClick={() =>
                                void handleArchiveFileMetadata(file.file_id)
                              }
                              type="button"
                            >
                              Archivar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="order-7 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Pagos
              </p>
              <div className="mt-3 grid max-h-[260px] gap-2 overflow-y-auto pr-1 text-sm">
                {selectedPayments.length === 0 ? (
                  <p className="text-[var(--muted)]">Sin pagos registrados.</p>
                ) : (
                  selectedPayments.map((payment) => (
                    <div
                      className="flex flex-col gap-1 rounded-2xl border border-[var(--line)] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      key={payment.id}
                    >
                      <span className="font-semibold text-[var(--ink)]">
                        {formatDisplayDate(payment.paid_at)} ·{' '}
                        {moneyFormatter.format(payment.amount)}
                      </span>
                      <span className="text-[var(--muted)]">
                        {paymentStatusLabels[payment.status]} ·{' '}
                        {paymentMethodLabels[payment.method]}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="order-2 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            Selecciona un alumno de la tabla para ver la ficha, editar datos,
                asignar programas o registrar pagos.
          </div>
        )}
      </div>

      <aside className="order-3 grid min-w-0 gap-5">
        <form
          className="min-w-0 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
          onSubmit={handleCreateStudent}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Alta segura
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
            Crear alumno
          </h3>
          <p className="mt-2 whitespace-normal break-words text-sm text-[var(--muted)]">
            Creá la cuenta del alumno con una contraseña provisoria. La
            contraseña no queda visible después del alta.
          </p>
          <div className="mt-5 grid gap-3">
            <input
              aria-label="Nombre del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, first_name: event.target.value })
              }
              placeholder="Nombre"
              value={studentForm.first_name}
            />
            <input
              aria-label="Apellido del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, last_name: event.target.value })
              }
              placeholder="Apellido"
              value={studentForm.last_name}
            />
            <input
              aria-label="Email del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, email: event.target.value })
              }
              placeholder="Email"
              type="email"
              value={studentForm.email}
            />
            <input
              aria-label="Telefono del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, phone: event.target.value })
              }
              placeholder="Telefono"
              value={studentForm.phone}
            />
            <input
              aria-label="Contraseña provisoria del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, password: event.target.value })
              }
              placeholder="Contraseña provisoria"
              type="password"
              value={studentForm.password}
            />
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                checked={studentForm.receives_emails}
                onChange={(event) =>
                  setStudentForm({
                    ...studentForm,
                    receives_emails: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Recibe emails
            </label>
            <button
              className="w-full rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              Crear alumno
            </button>
          </div>
        </form>

        {selectedStudent && editForm ? (
          <form
            className="min-w-0 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
            onSubmit={handleUpdateStudent}
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Edicion
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Datos basicos
            </h3>
            <div className="mt-5 grid gap-3">
              <input
                aria-label="Nombre editable del alumno"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setEditForm({ ...editForm, first_name: event.target.value })
                }
                value={editForm.first_name}
              />
              <input
                aria-label="Apellido editable del alumno"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setEditForm({ ...editForm, last_name: event.target.value })
                }
                value={editForm.last_name}
              />
              <input
                aria-label="Telefono editable del alumno"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setEditForm({ ...editForm, phone: event.target.value })
                }
                placeholder="Telefono"
                value={editForm.phone}
              />
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={editForm.active}
                  onChange={(event) =>
                    setEditForm({ ...editForm, active: event.target.checked })
                  }
                  type="checkbox"
                />
                Alumno activo
              </label>
              <p className="-mt-2 text-xs text-[var(--muted)]">
                Alumno activo puede iniciar sesion, reservar y operar. Si se
                desactiva, conserva su historial pero no puede usar la app.
              </p>
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={editForm.receives_emails}
                  onChange={(event) =>
                    setEditForm({
                      ...editForm,
                      receives_emails: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Recibe emails
              </label>
              <p className="-mt-2 text-xs text-[var(--muted)]">
                Recibe emails indica si acepta comunicaciones informativas.
              </p>
              <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Acceso del alumno
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Esto cambiará la contraseña de acceso del alumno. No se
                    guarda ni se muestra la contraseña actual.
                  </p>
                </div>
                <input
                  aria-label="Nueva contrasena del alumno"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setPasswordForm({
                      ...passwordForm,
                      password: event.target.value,
                    })
                  }
                  placeholder="Nueva contraseña"
                  type="password"
                  value={passwordForm.password}
                />
                <input
                  aria-label="Confirmar nueva contrasena del alumno"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setPasswordForm({
                      ...passwordForm,
                      confirmation: event.target.value,
                    })
                  }
                  placeholder="Confirmar nueva contraseña"
                  type="password"
                  value={passwordForm.confirmation}
                />
                <button
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold transition hover:bg-[var(--brand-soft)] disabled:opacity-60"
                  disabled={
                    passwordSaving ||
                    passwordForm.password.trim().length === 0 ||
                    passwordForm.confirmation.trim().length === 0
                  }
                  onClick={() => void handleUpdateStudentPassword()}
                  type="button"
                >
                  {passwordSaving ? 'Cambiando...' : 'Cambiar contraseña'}
                </button>
                {passwordMessage ? (
                  <p className="rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)]">
                    {passwordMessage}
                  </p>
                ) : null}
              </div>
              <button
                className="w-full rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                Guardar alumno
              </button>
              <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Baja segura
                </p>
                <p className="whitespace-normal break-words text-xs text-[var(--muted)]">
                  Desactivar conserva el historial y bloquea el acceso. Eliminar
                  borra definitivamente al alumno, su usuario de acceso y datos
                  asociados; usalo solo para pruebas o cargas por error.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-white disabled:opacity-60"
                    disabled={saving || !selectedStudent.active}
                    onClick={() => void handleDeactivateStudent()}
                    type="button"
                  >
                    Desactivar alumno
                  </button>
                  <button
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                    disabled={saving}
                    onClick={openDeleteStudentModal}
                    type="button"
                  >
                    Eliminar alumno
                  </button>
                </div>
              </div>
            </div>
          </form>
        ) : null}

        {deleteModalOpen && selectedStudent ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
            <div
              aria-modal="true"
              className="w-full max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
              role="dialog"
            >
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                Baja definitiva
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                Eliminar alumno definitivamente
              </h3>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Esta acción elimina el alumno y sus datos asociados. Usala solo
                para alumnos de prueba o cargados por error. Para alumnos reales
                con historial, recomendamos desactivarlo.
              </p>
              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4">
                <p className="text-sm font-bold text-[var(--ink)]">
                  Se eliminará:
                </p>
                <ul className="mt-2 grid gap-1 text-sm text-[var(--muted)]">
                  <li>Pagos</li>
                  <li>Programas</li>
                  <li>Reservas</li>
                  <li>Asistencia</li>
                  <li>Archivos</li>
                  <li>Notas / planes</li>
                  <li>Usuario de acceso</li>
                </ul>
              </div>
              <p className="mt-4 text-sm text-[var(--ink)]">
                Para confirmar la eliminación de{' '}
                <strong>
                  {selectedStudent.first_name} {selectedStudent.last_name}
                </strong>
                , escribí <strong>ELIMINAR</strong>.
              </p>
              <input
                aria-label="Confirmar eliminacion definitiva"
                className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold tracking-[0.12em]"
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                value={deleteConfirmation}
              />
              {error ? (
                <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
                  {error}
                </p>
              ) : null}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button
                  className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                  disabled={saving}
                  onClick={closeDeleteStudentModal}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                  disabled={saving || deleteConfirmation !== 'ELIMINAR'}
                  onClick={() => void handleDeleteStudent()}
                  type="button"
                >
                  {saving ? 'Eliminando...' : 'Eliminar definitivamente'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {programEditForm && programEditTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
            <form
              aria-modal="true"
              className="w-full max-w-2xl rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
              onSubmit={handleUpdateProgram}
              role="dialog"
            >
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Programa asignado
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                Editar programa
              </h3>
              {programHasHistory(programEditTarget) ? (
                <div className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-4 text-sm text-[var(--accent)]">
                  <p className="font-bold">Editar programa con historial</p>
                  <p className="mt-2">
                    Este programa tiene pagos, reservas o asistencia asociados.
                    Si lo editas, puede cambiar que clases puede reservar el
                    alumno desde ahora. No se eliminaran pagos ni historial.
                    Para confirmar, escribi EDITAR.
                  </p>
                  <input
                    aria-label="Confirmar edicion de programa con historial"
                    className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)]"
                    onChange={(event) =>
                      setProgramEditForm({
                        ...programEditForm,
                        confirmation: event.target.value,
                      })
                    }
                    placeholder="Escribi EDITAR"
                    value={programEditForm.confirmation}
                  />
                </div>
              ) : null}

              <div className="mt-5 grid gap-3">
                <select
                  aria-label="Programa asignado"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    handleProgramEditPlanChange(event.target.value)
                  }
                  value={programEditForm.plan_id}
                >
                  {activePlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {describePlanOption(plan)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Estado del programa"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setProgramEditForm({
                      ...programEditForm,
                      status: event.target.value as MembershipStatus,
                    })
                  }
                  value={programEditForm.status}
                >
                  <option value="active">Activo</option>
                  <option value="suspended">Suspendido</option>
                  <option value="expired">Vencido</option>
                  <option value="cancelled">Eliminado</option>
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    aria-label="Fecha de inicio del programa"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setProgramEditForm({
                        ...programEditForm,
                        start_date: event.target.value,
                      })
                    }
                    type="date"
                    value={programEditForm.start_date}
                  />
                  <input
                    aria-label="Fecha de vencimiento del programa"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    onChange={(event) =>
                      setProgramEditForm({
                        ...programEditForm,
                        end_date: event.target.value,
                      })
                    }
                    type="date"
                    value={programEditForm.end_date}
                  />
                </div>
                <input
                  aria-label="Clases disponibles del programa"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  disabled={selectedProgramEditPlan?.plan_type === 'weekly'}
                  onChange={(event) =>
                    setProgramEditForm({
                      ...programEditForm,
                      remaining_credits: event.target.value,
                    })
                  }
                  placeholder={
                    selectedProgramEditPlan?.plan_type === 'weekly'
                      ? 'Se controla por semana'
                      : 'Clases disponibles'
                  }
                  type="number"
                  value={programEditForm.remaining_credits}
                />
                <p className="-mt-1 text-xs text-[var(--muted)]">
                  {selectedProgramEditPlan?.plan_type === 'weekly'
                    ? 'Los programas semanales limitan reservas por semana dentro de la vigencia paga y no usan saldo visible.'
                    : 'Las clases disponibles aplican a paquetes o programas con saldo.'}
                </p>
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button
                  className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                  disabled={saving}
                  onClick={() => setProgramEditForm(null)}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="rounded-2xl bg-[var(--brand)] px-4 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                  disabled={
                    saving ||
                    (programHasHistory(programEditTarget) &&
                      programEditForm.confirmation !== 'EDITAR')
                  }
                  type="submit"
                >
                  {saving ? 'Guardando...' : 'Confirmar edicion'}
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {programDeleteTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
            <div
              aria-modal="true"
              className="w-full max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
              role="dialog"
            >
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                Eliminar programa asignado
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                {programDeleteTarget.plan_name}
              </h3>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Vas a eliminar este programa asignado al alumno. No se
                eliminaran pagos, alumno, plan ni auditoria. Si hay reservas
                futuras vinculadas, se cancelaran. Esta accion no se puede
                deshacer. Para confirmar, escribi ELIMINAR.
              </p>
              {programDeleteTarget.future_active_bookings_count > 0 ? (
                <p className="mt-3 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm font-semibold text-[var(--accent)]">
                  Reservas futuras activas vinculadas:{' '}
                  {programDeleteTarget.future_active_bookings_count}. Se
                  cancelaran si confirmas.
                </p>
              ) : null}
              {programHasHistory(programDeleteTarget) ? (
                <p className="mt-3 rounded-2xl bg-[var(--page)] p-3 text-xs font-semibold text-[var(--muted)]">
                  Historial: {programHistorySummary(programDeleteTarget)}
                </p>
              ) : null}
              <input
                aria-label="Confirmar eliminacion de programa"
                className="mt-4 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)]"
                onChange={(event) =>
                  setProgramDeleteConfirmation(event.target.value)
                }
                placeholder="Escribi ELIMINAR"
                value={programDeleteConfirmation}
              />
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button
                  className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                  disabled={saving}
                  onClick={() => {
                    setProgramDeleteTarget(null)
                    setProgramDeleteConfirmation('')
                  }}
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                  disabled={saving || programDeleteConfirmation !== 'ELIMINAR'}
                  onClick={() => void handleDeleteProgram()}
                  type="button"
                >
                  {saving ? 'Eliminando...' : 'Eliminar programa'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {selectedStudent ? (
          <form
            className="min-w-0 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
            onSubmit={handleAssignMembership}
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Programa
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Asignar programa
            </h3>
            <div className="mt-5 grid gap-3">
              <select
                aria-label="Plan para asignar"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) => handlePlanChange(event.target.value)}
                value={membershipForm.plan_id}
              >
                <option value="">Seleccionar plan</option>
                {activePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {describePlanOption(plan)}
                  </option>
                ))}
              </select>
              <input
                aria-label="Fecha de inicio del programa"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setMembershipForm({
                    ...membershipForm,
                    start_date: event.target.value,
                  })
                }
                type="date"
                value={membershipForm.start_date}
              />
              <input
                aria-label="Fecha de vencimiento del programa"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setMembershipForm({
                    ...membershipForm,
                    end_date: event.target.value,
                  })
                }
                type="date"
                value={membershipForm.end_date}
              />
              <input
                aria-label="Clases disponibles del programa"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                disabled={selectedMembershipPlan?.plan_type === 'weekly'}
                onChange={(event) =>
                  setMembershipForm({
                    ...membershipForm,
                    remaining_credits: event.target.value,
                  })
                }
                placeholder={
                  selectedMembershipPlan?.plan_type === 'weekly'
                    ? 'Se controla por semana'
                    : 'Clases del paquete'
                }
                type="number"
                value={membershipForm.remaining_credits}
              />
              <p className="-mt-1 text-xs text-[var(--muted)]">
                {selectedMembershipPlan?.plan_type === 'weekly'
                  ? 'Los planes semanales limitan reservas por semana dentro de la vigencia paga y no usan saldo visible.'
                  : 'Las clases se cargan desde el paquete elegido y pueden ajustarse antes de asignar el programa.'}
              </p>
              <button
                className="w-full rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                Asignar programa
              </button>
            </div>
          </form>
        ) : null}

        {selectedStudent ? (
          <form
            className="min-w-0 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
            onSubmit={handleRegisterPayment}
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Pago
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Registrar manual
            </h3>
            <div className="mt-5 grid gap-3">
              <select
                aria-label="Programa para pago manual"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) => {
                  const nextProgram = payableSelectedStudentPrograms.find(
                    (program) => program.program_id === event.target.value,
                  )
                  setPaymentForm({
                    ...paymentForm,
                    membership_id: event.target.value,
                    ...paymentValidityFields(
                      paymentForm.payment_date || todayDate(),
                      plansById.get(nextProgram?.plan_id ?? ''),
                    ),
                  })
                }}
                value={paymentForm.membership_id}
              >
                <option value="">Seleccionar programa</option>
                {payableSelectedStudentPrograms.map((program) => {
                  const plan = plansById.get(program.plan_id)
                  return (
                    <option key={program.program_id} value={program.program_id}>
                      {describeProgramOption(program, plan)}
                    </option>
                  )
                })}
              </select>
              <input
                aria-label="Monto del pago manual"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                min="0"
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, amount: event.target.value })
                }
                placeholder="Monto"
                step="0.01"
                type="number"
                value={paymentForm.amount}
              />
              <input
                aria-label="Fecha del pago manual"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) => {
                  const nextDate = event.target.value
                  const nextProgram = payableSelectedStudentPrograms.find(
                    (program) => program.program_id === paymentForm.membership_id,
                  )
                  setPaymentForm({
                    ...paymentForm,
                    payment_date: nextDate,
                    ...paymentValidityFields(
                      nextDate,
                      plansById.get(nextProgram?.plan_id ?? ''),
                    ),
                  })
                }}
                type="date"
                value={paymentForm.payment_date}
              />
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  aria-label="Inicio de vigencia del programa"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) => {
                    const nextStart = event.target.value
                    setPaymentForm({
                      ...paymentForm,
                      membership_start_date: nextStart,
                      membership_end_date: endForValidityMode(
                        nextStart,
                        paymentForm.validity_mode,
                        paymentForm.validity_days,
                      ),
                    })
                  }}
                  type="date"
                  value={paymentForm.membership_start_date}
                />
                <select
                  aria-label="Tipo de vigencia del programa"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) => {
                    const nextMode = event.target.value as PaymentValidityMode
                    setPaymentForm({
                      ...paymentForm,
                      validity_mode: nextMode,
                      membership_end_date: endForValidityMode(
                        paymentForm.membership_start_date,
                        nextMode,
                        paymentForm.validity_days,
                      ),
                    })
                  }}
                  value={paymentForm.validity_mode}
                >
                  <option value="monthly">
                    Mensual: mismo dia siguiente inclusive
                  </option>
                  <option value="manual">
                    Manual: dias incluidos exactos
                  </option>
                </select>
                {paymentForm.validity_mode === 'manual' ? (
                  <input
                    aria-label="Dias incluidos de vigencia"
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                    min="1"
                    onChange={(event) => {
                      const nextDays = event.target.value
                      setPaymentForm({
                        ...paymentForm,
                        validity_days: nextDays,
                        membership_end_date: addIncludedDays(
                          paymentForm.membership_start_date,
                          Number(nextDays) || 1,
                        ),
                      })
                    }}
                    type="number"
                    value={paymentForm.validity_days}
                  />
                ) : null}
                <input
                  aria-label="Fin de vigencia inclusive del programa"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setPaymentForm({
                      ...paymentForm,
                      validity_mode: 'manual',
                      membership_end_date: event.target.value,
                      validity_days: includedDaysBetween(
                        paymentForm.membership_start_date,
                        event.target.value,
                      ),
                    })
                  }
                  type="date"
                  value={paymentForm.membership_end_date}
                />
              </div>
              <p className="rounded-2xl bg-[var(--brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">
                {validityCopy(
                  paymentForm.membership_start_date,
                  paymentForm.membership_end_date,
                  paymentForm.validity_mode,
                )}
              </p>
              <select
                aria-label="Metodo del pago manual"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    method: event.target.value as PaymentMethod,
                  })
                }
                value={paymentForm.method}
              >
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
              </select>
              <textarea
                aria-label="Nota o comprobante del pago manual"
                className="min-h-24 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, notes: event.target.value })
                }
                placeholder="Nota o comprobante recibido por WhatsApp/persona"
                value={paymentForm.notes}
              />
              <button
                className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                Registrar pago
              </button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p className="rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-2xl bg-[var(--brand-soft)] p-3 text-sm font-semibold text-[var(--brand)]">
            {success}
          </p>
        ) : null}
      </aside>
    </section>
  )
}
