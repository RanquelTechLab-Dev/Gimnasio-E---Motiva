import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  assignMembership,
  createStudent,
  formatAdminError,
  listMemberships,
  listPayments,
  listPlans,
  listStudents,
  registerManualPayment,
  updateStudent,
} from './api'
import type {
  Membership,
  PaymentMethod,
  Payment,
  Plan,
  StudentProfile,
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
  notes: string
}

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

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

function studentToEditForm(student: StudentProfile): EditStudentState {
  return {
    first_name: student.first_name,
    last_name: student.last_name,
    phone: student.phone ?? '',
    active: student.active,
    receives_emails: student.receives_emails,
  }
}

function buildMembershipForm(plans: Plan[]): MembershipFormState {
  const startDate = todayDate()
  const firstPlan = plans[0]
  return {
    plan_id: firstPlan?.id ?? '',
    start_date: startDate,
    end_date: addDays(startDate, (firstPlan?.billing_period_days ?? 30) - 1),
    remaining_credits: '',
  }
}

export function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
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
    notes: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedStudent = useMemo(
    () =>
      students.find((student) => student.id === selectedStudentId) ??
      students[0] ??
      null,
    [selectedStudentId, students],
  )

  const selectedMemberships = memberships.filter(
    (membership) => membership.student_id === selectedStudent?.id,
  )
  const selectedPayments = payments.filter(
    (payment) => payment.student_id === selectedStudent?.id,
  )
  const plansById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  )

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
      }))
    } catch (loadError) {
      setError(formatAdminError(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectStudent(student: StudentProfile) {
    const firstMembership = memberships.find(
      (membership) => membership.student_id === student.id,
    )
    setSelectedStudentId(student.id)
    setEditForm(studentToEditForm(student))
    setPaymentForm({ ...paymentForm, membership_id: firstMembership?.id ?? '' })
    setError(null)
    setSuccess(null)
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
        notes: paymentForm.notes,
      })
      setSuccess('Pago manual registrado como pendiente.')
      setPaymentForm({ ...paymentForm, amount: '', notes: '' })
      await loadData()
    } catch (paymentError) {
      setError(formatAdminError(paymentError))
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
          <div className="mt-5 overflow-hidden rounded-[20px] border border-[var(--line)]">
            <div className="grid min-w-[780px] grid-cols-[1.4fr_1.4fr_0.8fr_0.8fr_0.9fr] bg-[var(--surface-strong)] px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              <span>Nombre</span>
              <span>Email</span>
              <span>Telefono</span>
              <span>Estado</span>
              <span>Ultimo pago</span>
            </div>
            <div className="grid max-h-[520px] overflow-auto">
              {students.map((student) => (
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
                  <span className="font-semibold">
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
        ) : null}
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
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
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
                aria-label="Creditos opcionales de membresia"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setMembershipForm({
                    ...membershipForm,
                    remaining_credits: event.target.value,
                  })
                }
                placeholder="Creditos opcionales"
                type="number"
                value={membershipForm.remaining_credits}
              />
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
                      {plan?.name ?? 'Plan'} · {membership.start_date} a{' '}
                      {membership.end_date}
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
