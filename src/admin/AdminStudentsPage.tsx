import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  archiveStudentFileMetadata,
  archiveTrainingNote,
  assignMembership,
  checkDriveStatus,
  createStudentFileMetadata,
  createStudent,
  formatAdminError,
  listStudentFiles,
  listStudentTrainingNotes,
  listMemberships,
  listPayments,
  listPlans,
  listStudents,
  registerManualPayment,
  updateStudentFileMetadata,
  updateStudent,
  uploadStudentFile,
  upsertTrainingNote,
} from './api'
import type {
  AdminStudentFile,
  AdminTrainingNote,
  DriveStatusResult,
  FileKind,
  Membership,
  PaymentMethod,
  Payment,
  Plan,
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

type MembershipFormState = {
  plan_id: string
  start_date: string
  end_date: string
  remaining_credits: string
}

type PaymentFormState = {
  membership_id: string
  amount: string
  method: PaymentMethod
  payment_date: string
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

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

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

function todayDate() {
  return formatLocalDate(new Date())
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function describeMembershipOption(membership: Membership, plan?: Plan | null) {
  const classes = (() => {
    if (plan?.plan_type === 'weekly') {
      return weeklyPlanLabel(plan)
    }

    if (membership.remaining_credits === null) {
      return 'clases segun plan'
    }

    return `${membership.remaining_credits} clases restantes`
  })()
  const price = plan ? ` · ${moneyFormatter.format(plan.price)}` : ''

  return `${plan?.name ?? 'Plan'}${price} · ${classes} · ${membership.start_date} a ${membership.end_date}`
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
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [trainingNotes, setTrainingNotes] = useState<AdminTrainingNote[]>([])
  const [studentFiles, setStudentFiles] = useState<AdminStudentFile[]>([])
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
  const [membershipForm, setMembershipForm] = useState<MembershipFormState>(
    buildMembershipForm([]),
  )
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({
    membership_id: '',
    amount: '',
    method: 'cash',
    payment_date: todayDate(),
    notes: '',
  })
  const [trainingNoteForm, setTrainingNoteForm] =
    useState<TrainingNoteFormState>(buildTrainingNoteForm())
  const [fileMetadataForm, setFileMetadataForm] =
    useState<FileMetadataFormState>(buildFileMetadataForm())
  const [uploadFileForm, setUploadFileForm] =
    useState<UploadFileFormState>(buildUploadFileForm())
  const [driveStatus, setDriveStatus] = useState<DriveStatusResult | null>(null)
  const [uploadInputKey, setUploadInputKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
  const selectedMemberships = memberships.filter(
    (membership) => membership.student_id === selectedStudent?.id,
  )
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
  const activePlans = plans.filter((plan) => plan.active)
  const selectedMembershipPlan = plansById.get(membershipForm.plan_id) ?? null

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [nextStudents, nextPlans, nextMemberships, nextPayments] =
        await Promise.all([
          listStudents(),
          listPlans(),
          listMemberships(),
          listPayments('all'),
        ])
      setStudents(nextStudents)
      setPlans(nextPlans)
      setMemberships(nextMemberships)
      setPayments(nextPayments)
      const nextSelected =
        nextStudents.find((student) => student.id === selectedStudentId) ??
        nextStudents[0] ??
        null
      setSelectedStudentId(nextSelected?.id ?? null)
      setEditForm(nextSelected ? studentToEditForm(nextSelected) : null)
      setMembershipForm(buildMembershipForm(nextPlans))
      const firstMembership = nextMemberships.find(
        (membership) => membership.student_id === nextSelected?.id,
      )
      setPaymentForm((current) => ({
        ...current,
        membership_id: firstMembership?.id ?? '',
        payment_date: current.payment_date || todayDate(),
      }))
      if (nextSelected) {
        const [nextNotes, nextFiles] = await Promise.all([
          listStudentTrainingNotes(nextSelected.id),
          listStudentFiles(nextSelected.id),
        ])
        setTrainingNotes(nextNotes)
        setStudentFiles(nextFiles)
      } else {
        setTrainingNotes([])
        setStudentFiles([])
      }
    } catch (loadError) {
      setError(formatAdminError(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function loadSelectedStudentOperations(studentId: string) {
    const [nextNotes, nextFiles] = await Promise.all([
      listStudentTrainingNotes(studentId),
      listStudentFiles(studentId),
    ])
    setTrainingNotes(nextNotes)
    setStudentFiles(nextFiles)
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearSelectedStudentForms() {
    setSelectedStudentId(null)
    setEditForm(null)
    setTrainingNotes([])
    setStudentFiles([])
    setTrainingNoteForm(buildTrainingNoteForm())
    setFileMetadataForm(buildFileMetadataForm())
    setUploadFileForm(buildUploadFileForm())
    setDriveStatus(null)
    setUploadInputKey((current) => current + 1)
    setMembershipForm(buildMembershipForm(plans))
    setPaymentForm((current) => ({
      ...current,
      membership_id: '',
      amount: '',
      payment_date: current.payment_date || todayDate(),
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
    const firstMembership = memberships.find(
      (membership) => membership.student_id === student.id,
    )
    setSelectedStudentId(student.id)
    setEditForm(studentToEditForm(student))
    setPaymentForm((current) => ({
      ...current,
      membership_id: firstMembership?.id ?? '',
    }))
    setError(null)
    setSuccess(null)
    setTrainingNoteForm(buildTrainingNoteForm())
    setFileMetadataForm(buildFileMetadataForm())
    setUploadFileForm(buildUploadFileForm())
    setDriveStatus(null)
    setUploadInputKey((current) => current + 1)
    void loadSelectedStudentOperations(student.id)
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await createStudent(studentForm)
      setSuccess(
        'Alumno creado. Entrega la contrasena provisoria de forma manual y no la guardes.',
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
      setSuccess('Membresia asignada.')
      await loadData()
    } catch (assignError) {
      setError(formatAdminError(assignError))
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

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await registerManualPayment({
        student_id: selectedStudent.id,
        membership_id: paymentForm.membership_id,
        amount,
        method: paymentForm.method,
        payment_date: paymentForm.payment_date,
        notes: paymentForm.notes,
      })
      setSuccess('Pago manual registrado como pendiente.')
      setPaymentForm({
        ...paymentForm,
        amount: '',
        payment_date: todayDate(),
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
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
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
            Todavia no hay alumnos creados. El alta real requiere desplegar la
            Edge Function `create-student` en el bloque posterior.
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
              <div className="overflow-hidden rounded-[20px] border border-[var(--line)]">
            <div className="grid min-w-[780px] grid-cols-[1.4fr_1.4fr_0.8fr_0.8fr_0.9fr] bg-[var(--surface-strong)] px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              <span>Nombre</span>
              <span>Email</span>
              <span>Telefono</span>
              <span>Estado</span>
              <span>Ultimo pago</span>
            </div>
            <div className="grid max-h-[520px] overflow-auto">
              {filteredStudents.map((student) => (
                <button
                  className={`grid min-w-[780px] grid-cols-[1.4fr_1.4fr_0.8fr_0.8fr_0.9fr] px-4 py-3 text-left text-sm transition ${
                    selectedStudent?.id === student.id
                      ? 'bg-[var(--brand-soft)]'
                      : 'bg-white hover:bg-[var(--surface-strong)]'
                  }`}
                  key={student.id}
                  onClick={() => selectStudent(student)}
                  type="button"
                >
                  <span className="font-semibold text-[var(--brand)] underline-offset-4 hover:underline">
                    {studentDisplayName(student)}
                  </span>
                  <span>{student.email}</span>
                  <span>{student.phone ?? '-'}</span>
                  <span>{student.active ? 'Activo' : 'Inactivo'}</span>
                  <span>
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

        {selectedStudent ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
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

            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Membresias
              </p>
              <div className="mt-3 grid gap-2 text-sm">
                {selectedMemberships.length === 0 ? (
                  <p className="text-[var(--muted)]">
                    Sin membresias asignadas.
                  </p>
                ) : (
                  selectedMemberships.map((membership) => {
                    const plan = plansById.get(membership.plan_id)
                    return (
                      <div
                        className="rounded-2xl border border-[var(--line)] bg-white p-3"
                        key={membership.id}
                      >
                        <p className="font-semibold">
                          {plan?.name ?? 'Plan no disponible'}
                        </p>
                        <p className="text-[var(--muted)]">
                          {membership.status} · {membership.start_date} a{' '}
                          {membership.end_date}
                        </p>
                      </div>
                    )
                  })
                )}
              </div>
            </article>

            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
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

            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 lg:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                    Plan y observaciones
                  </p>
                  <h4 className="mt-2 font-display text-xl font-bold">
                    Seguimiento operativo
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

            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 lg:col-span-2">
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

            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 lg:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Pagos
              </p>
              <div className="mt-3 grid gap-2 text-sm">
                {selectedPayments.length === 0 ? (
                  <p className="text-[var(--muted)]">Sin pagos registrados.</p>
                ) : (
                  selectedPayments.slice(0, 5).map((payment) => (
                    <div
                      className="flex flex-col gap-1 rounded-2xl border border-[var(--line)] bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                      key={payment.id}
                    >
                      <span>{moneyFormatter.format(payment.amount)}</span>
                      <span className="text-[var(--muted)]">
                        {payment.method === 'cash'
                          ? 'Efectivo'
                          : 'Transferencia'}{' '}
                        · {payment.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            Selecciona un alumno de la tabla para ver la ficha, editar datos,
            asignar membresias o registrar pagos.
          </div>
        )}
      </div>

      <aside className="grid gap-5">
        <form
          className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
          onSubmit={handleCreateStudent}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Alta segura
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
            Crear alumno
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Requiere deploy posterior de la Edge Function. No se guarda la
            contrasena provisoria.
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
              aria-label="Contrasena provisoria del alumno"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setStudentForm({ ...studentForm, password: event.target.value })
              }
              placeholder="Contrasena provisoria"
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
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              Crear alumno
            </button>
          </div>
        </form>

        {selectedStudent && editForm ? (
          <form
            className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
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
              <button
                className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                Guardar alumno
              </button>
            </div>
          </form>
        ) : null}

        {selectedStudent ? (
          <form
            className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
            onSubmit={handleAssignMembership}
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Membresia
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Asignar plan
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
                aria-label="Fecha de inicio de membresia"
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
                aria-label="Fecha de fin de membresia"
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
                aria-label="Clases del paquete de membresia"
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
                  ? 'Los planes semanales limitan reservas por semana y no usan saldo visible.'
                  : 'Las clases se cargan desde el paquete elegido y pueden ajustarse antes de asignar la membresia.'}
              </p>
              <button
                className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                Asignar membresia
              </button>
            </div>
          </form>
        ) : null}

        {selectedStudent ? (
          <form
            className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
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
                aria-label="Membresia para pago manual"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    membership_id: event.target.value,
                  })
                }
                value={paymentForm.membership_id}
              >
                <option value="">Seleccionar membresia</option>
                {selectedMemberships.map((membership) => {
                  const plan = plansById.get(membership.plan_id)
                  return (
                    <option key={membership.id} value={membership.id}>
                      {describeMembershipOption(membership, plan)}
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
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    payment_date: event.target.value,
                  })
                }
                type="date"
                value={paymentForm.payment_date}
              />
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
