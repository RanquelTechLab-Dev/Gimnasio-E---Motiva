import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  approveManualPayment,
  formatAdminError,
  listMemberships,
  listPayments,
  listPlans,
  listStudents,
  registerManualPayment,
  rejectManualPayment,
} from './api'
import type {
  Membership,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Plan,
  StudentProfile,
} from './types'

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const statusLabels: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
}

type PaymentFilter = PaymentStatus | 'all'

type PaymentFormState = {
  student_id: string
  membership_id: string
  amount: string
  method: PaymentMethod
  notes: string
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

export function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [filter, setFilter] = useState<PaymentFilter>('pending')
  const [form, setForm] = useState<PaymentFormState>({
    student_id: '',
    membership_id: '',
    amount: '',
    method: 'cash',
    notes: '',
  })
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const studentsById = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students],
  )
  const membershipsById = useMemo(
    () =>
      new Map(
        memberships.map((membership) => [membership.id, membership] as const),
      ),
    [memberships],
  )
  const plansById = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  )
  const studentMemberships = memberships.filter(
    (membership) => membership.student_id === form.student_id,
  )

  async function loadData(nextFilter = filter) {
    setLoading(true)
    setError(null)
    try {
      const [nextStudents, nextPlans, nextMemberships, nextPayments] =
        await Promise.all([
          listStudents(),
          listPlans(),
          listMemberships(),
          listPayments(nextFilter),
        ])
      setStudents(nextStudents)
      setPlans(nextPlans)
      setMemberships(nextMemberships)
      setPayments(nextPayments)

      if (!form.student_id && nextStudents[0]) {
        const firstMembership = nextMemberships.find(
          (membership) => membership.student_id === nextStudents[0].id,
        )
        setForm((current) => ({
          ...current,
          student_id: nextStudents[0].id,
          membership_id: firstMembership?.id ?? '',
        }))
      }
    } catch (loadError) {
      setError(formatAdminError(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData(filter)
    }, 0)
    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  function handleStudentChange(studentId: string) {
    const firstMembership = memberships.find(
      (membership) => membership.student_id === studentId,
    )
    setForm({
      ...form,
      student_id: studentId,
      membership_id: firstMembership?.id ?? '',
    })
  }

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(form.amount)

    if (!form.student_id || !form.membership_id) {
      setError('Selecciona alumno y membresia para registrar el pago.')
      return
    }

    if (!Number.isFinite(amount) || amount < 0) {
      setError('El monto debe ser un numero mayor o igual a cero.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await registerManualPayment({
        student_id: form.student_id,
        membership_id: form.membership_id,
        amount,
        method: form.method,
        notes: form.notes,
      })
      setSuccess('Pago manual registrado como pendiente.')
      setForm({ ...form, amount: '', notes: '' })
      await loadData(filter)
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove(paymentId: string) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await approveManualPayment(paymentId)
      setSuccess(`Pago aprobado. Fecha operativa: ${todayDate()}.`)
      await loadData(filter)
    } catch (approveError) {
      setError(formatAdminError(approveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleReject(paymentId: string) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await rejectManualPayment(paymentId, rejectReason[paymentId] ?? '')
      setSuccess('Pago rechazado.')
      await loadData(filter)
    } catch (rejectError) {
      setError(formatAdminError(rejectError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Pagos
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Pagos manuales
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as PaymentFilter[]).map(
              (item) => (
                <button
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    filter === item
                      ? 'bg-[var(--brand)] text-white'
                      : 'border border-[var(--line)] bg-white text-[var(--ink)]'
                  }`}
                  key={item}
                  onClick={() => setFilter(item)}
                  type="button"
                >
                  {item === 'all' ? 'Todos' : statusLabels[item]}
                </button>
              ),
            )}
          </div>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-[var(--muted)]">Cargando pagos...</p>
        ) : payments.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            No hay pagos para este filtro.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {payments.map((payment) => {
              const student = studentsById.get(payment.student_id)
              const membership = payment.membership_id
                ? membershipsById.get(payment.membership_id)
                : null
              const plan = membership ? plansById.get(membership.plan_id) : null
              return (
                <article
                  className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
                  key={payment.id}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">
                        {student
                          ? `${student.first_name} ${student.last_name}`
                          : 'Alumno no disponible'}
                      </p>
                      <p className="text-sm text-[var(--muted)]">
                        {plan?.name ?? 'Plan no disponible'} ·{' '}
                        {payment.method === 'cash'
                          ? 'Efectivo'
                          : 'Transferencia'}
                      </p>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Nota/comprobante:{' '}
                        {payment.notes?.trim() || 'Sin nota cargada'}
                      </p>
                    </div>
                    <div className="text-left lg:text-right">
                      <p className="font-display text-xl font-bold text-[var(--ink)]">
                        {moneyFormatter.format(payment.amount)}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                        {statusLabels[payment.status]}
                      </p>
                    </div>
                  </div>

                  {payment.status === 'pending' ? (
                    <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_auto]">
                      <input
                        className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
                        onChange={(event) =>
                          setRejectReason({
                            ...rejectReason,
                            [payment.id]: event.target.value,
                          })
                        }
                        placeholder="Motivo si se rechaza"
                        value={rejectReason[payment.id] ?? ''}
                      />
                      <button
                        className="rounded-2xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void handleApprove(payment.id)}
                        type="button"
                      >
                        Aprobar
                      </button>
                      <button
                        className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void handleReject(payment.id)}
                        type="button"
                      >
                        Rechazar
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>

      <aside className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Nuevo pago
        </p>
        <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
          Registrar manual
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Solo efectivo o transferencia. El comprobante por WhatsApp o en
          persona queda registrado como nota.
        </p>

        <form className="mt-5 grid gap-4" onSubmit={handleCreatePayment}>
          <div>
            <label className="text-sm font-semibold" htmlFor="payment-student">
              Alumno
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="payment-student"
              onChange={(event) => handleStudentChange(event.target.value)}
              value={form.student_id}
            >
              <option value="">Seleccionar alumno</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.first_name} {student.last_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="text-sm font-semibold"
              htmlFor="payment-membership"
            >
              Membresia
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="payment-membership"
              onChange={(event) =>
                setForm({ ...form, membership_id: event.target.value })
              }
              value={form.membership_id}
            >
              <option value="">Seleccionar membresia</option>
              {studentMemberships.map((membership) => {
                const plan = plansById.get(membership.plan_id)
                return (
                  <option key={membership.id} value={membership.id}>
                    {plan?.name ?? 'Plan'} · {membership.start_date} a{' '}
                    {membership.end_date}
                  </option>
                )
              })}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold" htmlFor="payment-amount">
                Monto
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-amount"
                min="0"
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value })
                }
                step="0.01"
                type="number"
                value={form.amount}
              />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="payment-method">
                Metodo
              </label>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-method"
                onChange={(event) =>
                  setForm({
                    ...form,
                    method: event.target.value as PaymentMethod,
                  })
                }
                value={form.method}
              >
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="payment-notes">
              Nota / comprobante
            </label>
            <textarea
              className="mt-2 min-h-24 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="payment-notes"
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              value={form.notes}
            />
          </div>
          <button
            className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            {saving ? 'Registrando...' : 'Registrar pago'}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 rounded-2xl bg-[var(--brand-soft)] p-3 text-sm font-semibold text-[var(--brand)]">
            {success}
          </p>
        ) : null}
      </aside>
    </section>
  )
}
