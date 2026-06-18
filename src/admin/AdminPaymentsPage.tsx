import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  deletePaymentDefinitive,
  formatAdminError,
  listMemberships,
  listPayments,
  listPlans,
  previewDeletePayment,
  listStudents,
  registerManualPayment,
  updatePayment,
  voidPayment,
} from './api'
import type {
  DeletePaymentPreview,
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
  voided: 'Anulado',
}

type PaymentFilter = PaymentStatus | 'all'
type PaymentValidityMode = 'monthly' | 'manual'

type PaymentFormState = {
  student_id: string
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

type EditPaymentState = {
  payment_id: string
  amount: string
  method: PaymentMethod
  payment_date: string
  membership_start_date: string
  validity_mode: PaymentValidityMode
  validity_days: string
  membership_end_date: string
  notes: string
}

type PaymentFeedback = {
  type: 'error' | 'success'
  message: string
}

function todayDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateInputValue(value: string) {
  return value.slice(0, 10)
}

function formatDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

  return formatDateValue(
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
  return formatDateValue(start)
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

function defaultValidityEnd(startDate: string, plan?: Plan | null) {
  return plan?.billing_period_days
    ? addIncludedDays(startDate, plan.billing_period_days)
    : addMonthsSameDayInclusive(startDate)
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

function describeMembership(membership: Membership, plan?: Plan | null) {
  const classes = (() => {
    if (plan?.plan_type === 'weekly') {
      const weeklyTotal = (plan.plan_activities ?? []).reduce((sum, item) => {
        return sum + (item.weekly_class_limit ?? 0)
      }, 0)

      return weeklyTotal > 0
        ? `${weeklyTotal} clases por semana`
        : 'limite semanal pendiente'
    }

    if (membership.remaining_credits === null) {
      return 'clases segun plan'
    }

    return `${membership.remaining_credits} clases restantes`
  })()
  const price = plan ? ` · ${moneyFormatter.format(plan.price)}` : ''

  return `${plan?.name ?? 'Plan'}${price} · ${classes} · Vigencia ${membership.start_date} a ${membership.end_date}`
}

export function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [students, setStudents] = useState<StudentProfile[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [filter, setFilter] = useState<PaymentFilter>('approved')
  const [form, setForm] = useState<PaymentFormState>({
    student_id: '',
    membership_id: '',
    amount: '',
    method: 'cash',
    payment_date: todayDate(),
    membership_start_date: todayDate(),
    validity_mode: 'monthly',
    validity_days: '30',
    membership_end_date: addMonthsSameDayInclusive(todayDate()),
    notes: '',
  })
  const [voidReason, setVoidReason] = useState<Record<string, string>>({})
  const [voidFeedback, setVoidFeedback] = useState<
    Record<string, PaymentFeedback>
  >({})
  const [paymentsMessage, setPaymentsMessage] =
    useState<PaymentFeedback | null>(null)
  const [editingPayment, setEditingPayment] = useState<EditPaymentState | null>(
    null,
  )
  const [deletePaymentPreview, setDeletePaymentPreview] =
    useState<DeletePaymentPreview | null>(null)
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<Payment | null>(
    null,
  )
  const [deletePaymentConfirmation, setDeletePaymentConfirmation] = useState('')
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
  const selectedFormMembership = form.membership_id
    ? membershipsById.get(form.membership_id)
    : null
  const selectedFormPlan = selectedFormMembership
    ? plansById.get(selectedFormMembership.plan_id)
    : null

  function nextValidityFromStart(
    startDate: string,
    plan?: Plan | null,
    mode: PaymentValidityMode = 'monthly',
    validityDays = String(plan?.billing_period_days ?? 30),
  ) {
    const days = Number(validityDays)
    const safeDays = Number.isFinite(days) && days > 0
      ? Math.floor(days)
      : plan?.billing_period_days ?? 30
    return {
      membership_start_date: startDate,
      validity_mode: mode,
      validity_days: String(safeDays),
      membership_end_date:
        mode === 'monthly'
          ? addMonthsSameDayInclusive(startDate)
          : addIncludedDays(startDate, safeDays),
    }
  }

  function paymentValidityLabel(payment: Payment, membership?: Membership | null) {
    const start = payment.membership_start_date ?? membership?.start_date ?? null
    const end = payment.membership_end_date ?? membership?.end_date ?? null

    return start && end
      ? `${start} a ${end} inclusive`
      : 'Sin vigencia cargada'
  }

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
        const firstPlan = firstMembership
          ? nextPlans.find((plan) => plan.id === firstMembership.plan_id)
          : null
        const nextStart = todayDate()
        setForm((current) => ({
          ...current,
          student_id: nextStudents[0].id,
          membership_id: firstMembership?.id ?? '',
          ...nextValidityFromStart(nextStart, firstPlan),
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
    const plan = firstMembership ? plansById.get(firstMembership.plan_id) : null
    setForm({
      ...form,
      student_id: studentId,
      membership_id: firstMembership?.id ?? '',
      ...nextValidityFromStart(form.payment_date || todayDate(), plan),
    })
  }

  function handleMembershipChange(membershipId: string) {
    const membership = membershipsById.get(membershipId)
    const plan = membership ? plansById.get(membership.plan_id) : null
    setForm({
      ...form,
      membership_id: membershipId,
      ...nextValidityFromStart(form.payment_date || todayDate(), plan),
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

    if (
      !form.membership_start_date ||
      !form.membership_end_date ||
      form.membership_end_date < form.membership_start_date
    ) {
      setError('La vigencia del programa no es valida.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const paymentResult = await registerManualPayment({
        student_id: form.student_id,
        membership_id: form.membership_id,
        amount,
        method: form.method,
        payment_date: form.payment_date,
        membership_start_date: form.membership_start_date,
        membership_end_date: form.membership_end_date,
        notes: form.notes,
      })
      setSuccess(
        paymentResult.is_fully_paid === false
          ? `Pago registrado, pero el programa todavia no se activa porque falta ${moneyFormatter.format(paymentResult.pending_amount ?? 0)}.`
          : 'Pago registrado y programa activado.',
      )
      const nextStart = todayDate()
      setForm({
        ...form,
        amount: '',
        payment_date: nextStart,
        notes: '',
        ...nextValidityFromStart(nextStart, selectedFormPlan),
      })
      await loadData(filter)
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  function startEditPayment(payment: Payment) {
    const membership = payment.membership_id
      ? membershipsById.get(payment.membership_id)
      : null
    const startDate =
      payment.membership_start_date ??
      membership?.start_date ??
      dateInputValue(payment.paid_at)
    const endDate =
      payment.membership_end_date ??
      membership?.end_date ??
      defaultValidityEnd(startDate, membership ? plansById.get(membership.plan_id) : null)
    const inferredValidityMode: PaymentValidityMode =
      endDate === addMonthsSameDayInclusive(startDate) ? 'monthly' : 'manual'

    setEditingPayment({
      payment_id: payment.id,
      amount: String(payment.amount),
      method: payment.method,
      payment_date: dateInputValue(payment.paid_at),
      membership_start_date: startDate,
      validity_mode: inferredValidityMode,
      validity_days: includedDaysBetween(startDate, endDate),
      membership_end_date: endDate,
      notes: payment.notes ?? '',
    })
  }

  async function handleUpdatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingPayment) {
      return
    }

    const amount = Number(editingPayment.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('El monto debe ser mayor a cero.')
      return
    }

    if (!editingPayment.payment_date) {
      setError('La fecha de pago es obligatoria.')
      return
    }

    if (
      !editingPayment.membership_start_date ||
      !editingPayment.membership_end_date ||
      editingPayment.membership_end_date < editingPayment.membership_start_date
    ) {
      setError('La vigencia del programa no es valida.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updatePayment({
        payment_id: editingPayment.payment_id,
        amount,
        method: editingPayment.method,
        payment_date: editingPayment.payment_date,
        membership_start_date: editingPayment.membership_start_date,
        membership_end_date: editingPayment.membership_end_date,
        notes: editingPayment.notes,
      })
      setSuccess('Pago actualizado con auditoria.')
      setEditingPayment(null)
      await loadData(filter)
    } catch (updateError) {
      setError(formatAdminError(updateError))
    } finally {
      setSaving(false)
    }
  }

  async function handleVoidPayment(payment: Payment) {
    const reason = voidReason[payment.id]?.trim() ?? ''
    if (!reason) {
      setVoidFeedback({
        ...voidFeedback,
        [payment.id]: {
          type: 'error',
          message: 'Escribi un motivo para poder anular el pago.',
        },
      })
      return
    }

    const confirmed = window.confirm(
      payment.membership_id
        ? 'Anular conserva el pago para historial, pero lo deja sin validez administrativa. Si el programa vinculado deja de estar pago completo, se suspendera y se cancelaran sus reservas futuras activas. ¿Continuar?'
        : 'Anular conserva el pago para historial, pero lo deja sin validez administrativa. ¿Continuar?',
    )

    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    setPaymentsMessage(null)
    setVoidFeedback({
      ...voidFeedback,
      [payment.id]: {
        type: 'success',
        message: 'Anulando pago...',
      },
    })
    try {
      await voidPayment(payment.id, reason)
      setPaymentsMessage({
        type: 'success',
        message: 'Pago anulado. Podes verlo en la pestana Anulado.',
      })
      setVoidReason({ ...voidReason, [payment.id]: '' })
      setVoidFeedback((current) => {
        const next = { ...current }
        delete next[payment.id]
        return next
      })
      await loadData(filter)
    } catch (voidError) {
      setVoidFeedback({
        ...voidFeedback,
        [payment.id]: {
          type: 'error',
          message: formatAdminError(voidError),
        },
      })
    } finally {
      setSaving(false)
    }
  }

  async function openDeletePaymentModal(payment: Payment) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    setPaymentsMessage(null)
    setDeletePaymentConfirmation('')
    setDeletePaymentTarget(payment)
    setDeletePaymentPreview(null)

    try {
      const preview = await previewDeletePayment(payment.id)
      setDeletePaymentPreview(preview)
    } catch (previewError) {
      setDeletePaymentTarget(null)
      setError(formatAdminError(previewError))
    } finally {
      setSaving(false)
    }
  }

  function closeDeletePaymentModal() {
    if (saving) {
      return
    }

    setDeletePaymentConfirmation('')
    setDeletePaymentPreview(null)
    setDeletePaymentTarget(null)
  }

  async function handleDeletePaymentDefinitive() {
    if (
      !deletePaymentTarget ||
      deletePaymentConfirmation !==
        (deletePaymentPreview?.details.confirmation_required ?? 'ELIMINAR PAGO')
    ) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    setPaymentsMessage(null)
    try {
      const result = await deletePaymentDefinitive(
        deletePaymentTarget.id,
        deletePaymentConfirmation,
      )
      setPaymentsMessage({
        type: 'success',
        message:
          result.warnings?.[0] ??
          'Pago eliminado definitivamente y estado del programa recalculado.',
      })
      setDeletePaymentConfirmation('')
      setDeletePaymentPreview(null)
      setDeletePaymentTarget(null)
      await loadData(filter)
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
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
            {(['approved', 'voided', 'all'] as PaymentFilter[]).map((item) => (
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
              ))}
          </div>
        </div>

        {paymentsMessage ? (
          <p
            className={`mt-5 rounded-2xl p-3 text-sm font-semibold ${
              paymentsMessage.type === 'error'
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'bg-[var(--brand-soft)] text-[var(--brand)]'
            }`}
          >
            {paymentsMessage.message}
          </p>
        ) : null}

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
              const voidReasonValue = voidReason[payment.id] ?? ''
              const canVoidPayment = voidReasonValue.trim().length > 0
              const currentVoidFeedback = voidFeedback[payment.id]
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
                      {membership ? (
                        <div className="mt-1 grid gap-1 text-xs text-[var(--muted)]">
                          <p>{describeMembership(membership, plan)}</p>
                          <p>
                            Pago: {dateInputValue(payment.paid_at)} · Vigencia
                            del programa:{' '}
                            {paymentValidityLabel(payment, membership)}
                          </p>
                        </div>
                      ) : null}
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Nota/comprobante:{' '}
                        {payment.notes?.trim() || 'Sin nota cargada'}
                      </p>
                      {payment.status === 'voided' ? (
                        <p className="mt-2 rounded-2xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)]">
                          Anulado: {payment.void_reason ?? 'sin motivo cargado'}
                        </p>
                      ) : payment.status === 'approved' && payment.membership_id ? (
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          Si este pago se anula, el programa vinculado se
                          recalcula. Si queda sin pago completo, se suspende y
                          cancela reservas futuras activas.
                        </p>
                      ) : null}
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

                  {editingPayment?.payment_id === payment.id ? (
                    <form
                      className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4"
                      onSubmit={handleUpdatePayment}
                    >
                      <p className="text-sm font-bold text-[var(--ink)]">
                        Editar estos datos recalcula el estado y la vigencia
                        del programa vinculado.
                      </p>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="text-sm font-semibold">
                          Monto
                          <input
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            min="0.01"
                            onChange={(event) =>
                              setEditingPayment({
                                ...editingPayment,
                                amount: event.target.value,
                              })
                            }
                            step="0.01"
                            type="number"
                            value={editingPayment.amount}
                          />
                        </label>
                        <label className="text-sm font-semibold">
                          Fecha de pago
                          <input
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            onChange={(event) =>
                              setEditingPayment({
                                ...editingPayment,
                                payment_date: event.target.value,
                              })
                            }
                            type="date"
                            value={editingPayment.payment_date}
                          />
                        </label>
                        <label className="text-sm font-semibold">
                          Metodo
                          <select
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            onChange={(event) =>
                              setEditingPayment({
                                ...editingPayment,
                                method: event.target.value as PaymentMethod,
                              })
                            }
                            value={editingPayment.method}
                          >
                            <option value="cash">Efectivo</option>
                            <option value="transfer">Transferencia</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-4">
                        <label className="text-sm font-semibold">
                          Inicio de vigencia
                          <input
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            onChange={(event) => {
                              const nextStart = event.target.value
                              setEditingPayment({
                                ...editingPayment,
                                membership_start_date: nextStart,
                                membership_end_date: endForValidityMode(
                                  nextStart,
                                  editingPayment.validity_mode,
                                  editingPayment.validity_days,
                                ),
                              })
                            }}
                            type="date"
                            value={editingPayment.membership_start_date}
                          />
                        </label>
                        <label className="text-sm font-semibold">
                          Tipo de vigencia
                          <select
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            onChange={(event) => {
                              const nextMode = event.target
                                .value as PaymentValidityMode
                              setEditingPayment({
                                ...editingPayment,
                                validity_mode: nextMode,
                                membership_end_date: endForValidityMode(
                                  editingPayment.membership_start_date,
                                  nextMode,
                                  editingPayment.validity_days,
                                ),
                              })
                            }}
                            value={editingPayment.validity_mode}
                          >
                            <option value="monthly">
                              Mensual: mismo dia siguiente inclusive
                            </option>
                            <option value="manual">
                              Manual: dias incluidos exactos
                            </option>
                          </select>
                        </label>
                        {editingPayment.validity_mode === 'manual' ? (
                          <label className="text-sm font-semibold">
                            Dias incluidos
                            <input
                              className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                              min="1"
                              onChange={(event) => {
                                const nextDays = event.target.value
                                setEditingPayment({
                                  ...editingPayment,
                                  validity_days: nextDays,
                                  membership_end_date: addIncludedDays(
                                    editingPayment.membership_start_date,
                                    Number(nextDays) || 1,
                                  ),
                                })
                              }}
                              type="number"
                              value={editingPayment.validity_days}
                            />
                          </label>
                        ) : null}
                        <label className="text-sm font-semibold">
                          Fin de vigencia inclusive
                          <input
                            className="mt-2 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                            onChange={(event) => {
                              const nextEnd = event.target.value
                              setEditingPayment({
                                ...editingPayment,
                                validity_mode: 'manual',
                                membership_end_date: nextEnd,
                                validity_days: includedDaysBetween(
                                  editingPayment.membership_start_date,
                                  nextEnd,
                                ),
                              })
                            }}
                            type="date"
                            value={editingPayment.membership_end_date}
                          />
                        </label>
                      </div>
                      <p className="rounded-2xl bg-[var(--brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">
                        {validityCopy(
                          editingPayment.membership_start_date,
                          editingPayment.membership_end_date,
                          editingPayment.validity_mode,
                        )}
                      </p>
                      <label className="text-sm font-semibold">
                        Nota / comprobante
                        <textarea
                          className="mt-2 min-h-20 w-full rounded-2xl border border-[var(--line)] px-4 py-2 text-sm"
                          onChange={(event) =>
                            setEditingPayment({
                              ...editingPayment,
                              notes: event.target.value,
                            })
                          }
                          value={editingPayment.notes}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-2xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                          disabled={saving}
                          type="submit"
                        >
                          Guardar cambios
                        </button>
                        <button
                          className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold"
                          disabled={saving}
                          onClick={() => setEditingPayment(null)}
                          type="button"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {payment.status !== 'voided' ? (
                    <div className="mt-4 grid gap-2">
                      <div className="grid gap-2 lg:grid-cols-[1fr_auto_auto]">
                        <input
                          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
                          onChange={(event) => {
                            setVoidReason({
                              ...voidReason,
                              [payment.id]: event.target.value,
                            })
                            setVoidFeedback((current) => {
                              const next = { ...current }
                              delete next[payment.id]
                              return next
                            })
                          }}
                          placeholder="Motivo obligatorio para anular"
                          value={voidReasonValue}
                        />
                        <button
                          className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold text-[var(--ink)] disabled:opacity-60"
                          disabled={saving}
                          onClick={() => startEditPayment(payment)}
                          type="button"
                        >
                          Editar pago
                        </button>
                        <button
                          className="rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] disabled:opacity-60"
                          disabled={saving || !canVoidPayment}
                          onClick={() => void handleVoidPayment(payment)}
                          type="button"
                        >
                          Anular pago
                        </button>
                        <button
                          className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                          disabled={saving}
                          onClick={() => void openDeletePaymentModal(payment)}
                          type="button"
                        >
                          Eliminar pago
                        </button>
                      </div>
                      <p className="text-xs text-[var(--muted)]">
                        No borra el pago. Lo marca como anulado y conserva
                        historial.
                      </p>
                      {!canVoidPayment ? (
                        <p className="text-xs font-semibold text-[var(--accent)]">
                          Escribi un motivo para poder anular el pago.
                        </p>
                      ) : null}
                      {currentVoidFeedback ? (
                        <p
                          className={`rounded-2xl p-3 text-sm font-semibold ${
                            currentVoidFeedback.type === 'error'
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'bg-[var(--brand-soft)] text-[var(--brand)]'
                          }`}
                        >
                          {currentVoidFeedback.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {deletePaymentTarget && deletePaymentPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div
            aria-modal="true"
            className="w-full max-w-2xl rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
            role="dialog"
          >
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              Pago definitivo
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Eliminar pago definitivamente
            </h3>
            <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-sm sm:grid-cols-2">
              <p>
                <strong>Alumno:</strong>{' '}
                {studentsById.get(deletePaymentTarget.student_id)?.first_name}{' '}
                {studentsById.get(deletePaymentTarget.student_id)?.last_name}
              </p>
              <p>
                <strong>Monto:</strong>{' '}
                {moneyFormatter.format(deletePaymentTarget.amount)}
              </p>
              <p>
                <strong>Estado:</strong>{' '}
                {statusLabels[deletePaymentTarget.status]}
              </p>
              <p>
                <strong>Metodo:</strong> {deletePaymentTarget.method}
              </p>
              <p>
                <strong>Fecha:</strong> {deletePaymentTarget.paid_at.slice(0, 10)}
              </p>
              <p>
                <strong>Programa:</strong>{' '}
                {deletePaymentTarget.membership_id ? 'Vinculado' : 'Sin programa'}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white p-4 text-sm">
              <p>
                <strong>Required amount:</strong>{' '}
                {deletePaymentPreview.details.required_amount === null
                  ? 'No aplica'
                  : moneyFormatter.format(deletePaymentPreview.details.required_amount)}
              </p>
              <p className="mt-1">
                <strong>Aprobado actual:</strong>{' '}
                {moneyFormatter.format(
                  deletePaymentPreview.details.approved_paid_total,
                )}
              </p>
              <p className="mt-1">
                <strong>Aprobado sin este pago:</strong>{' '}
                {moneyFormatter.format(
                  deletePaymentPreview.details.approved_without_payment,
                )}
              </p>
              <p className="mt-1">
                <strong>Reservas futuras que podrian cancelarse:</strong>{' '}
                {
                  deletePaymentPreview.affected
                    .future_active_bookings_to_cancel
                }
              </p>
            </div>
            {deletePaymentPreview.warnings.length ? (
              <div className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
                {deletePaymentPreview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <label className="mt-4 block text-sm font-semibold">
              Escribi {deletePaymentPreview.details.confirmation_required} para confirmar
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-bold"
                onChange={(event) =>
                  setDeletePaymentConfirmation(event.target.value)
                }
                value={deletePaymentConfirmation}
              />
            </label>
            {error ? (
              <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
                {error}
              </p>
            ) : null}
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
                disabled={saving}
                onClick={closeDeletePaymentModal}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={
                  saving ||
                  deletePaymentConfirmation !==
                    deletePaymentPreview.details.confirmation_required
                }
                onClick={() => void handleDeletePaymentDefinitive()}
                type="button"
              >
                {saving ? 'Eliminando...' : 'Eliminar pago'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        <p className="mt-2 rounded-2xl bg-[var(--brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">
          El pago habilita el programa desde la fecha de inicio hasta la fecha
          de fin indicada, con el dia final incluido.
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
              Plan / membresia
            </label>
            <select
              className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="payment-membership"
              onChange={(event) => handleMembershipChange(event.target.value)}
              value={form.membership_id}
            >
              <option value="">Seleccionar membresia</option>
              {studentMemberships.map((membership) => {
                const plan = plansById.get(membership.plan_id)
                return (
                  <option key={membership.id} value={membership.id}>
                    {describeMembership(membership, plan)}
                  </option>
                )
              })}
            </select>
            <p className="mt-2 text-xs text-[var(--muted)]">
              El pago queda asociado al plan, periodo y clases de esta membresia.
            </p>
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
              <label className="text-sm font-semibold" htmlFor="payment-date">
                Fecha
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-date"
                onChange={(event) => {
                  const nextDate = event.target.value
                  setForm({
                    ...form,
                    payment_date: nextDate,
                    ...nextValidityFromStart(
                      nextDate,
                      selectedFormPlan,
                      form.validity_mode,
                      form.validity_days,
                    ),
                  })
                }}
                type="date"
                value={form.payment_date}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                className="text-sm font-semibold"
                htmlFor="payment-validity-start"
              >
                Inicio de vigencia
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-validity-start"
                onChange={(event) => {
                  const nextStart = event.target.value
                  setForm({
                    ...form,
                    membership_start_date: nextStart,
                    membership_end_date: endForValidityMode(
                      nextStart,
                      form.validity_mode,
                      form.validity_days,
                    ),
                  })
                }}
                type="date"
                value={form.membership_start_date}
              />
            </div>
            <div>
              <label
                className="text-sm font-semibold"
                htmlFor="payment-validity-mode"
              >
                Tipo de vigencia
              </label>
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-validity-mode"
                onChange={(event) => {
                  const nextMode = event.target.value as PaymentValidityMode
                  setForm({
                    ...form,
                    validity_mode: nextMode,
                    membership_end_date: endForValidityMode(
                      form.membership_start_date,
                      nextMode,
                      form.validity_days,
                    ),
                  })
                }}
                value={form.validity_mode}
              >
                <option value="monthly">
                  Mensual: mismo dia siguiente inclusive
                </option>
                <option value="manual">
                  Manual: dias incluidos exactos
                </option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {form.validity_mode === 'manual' ? (
              <div>
                <label
                  className="text-sm font-semibold"
                  htmlFor="payment-validity-days"
                >
                  Dias incluidos
                </label>
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  id="payment-validity-days"
                  min="1"
                  onChange={(event) => {
                    const nextDays = event.target.value
                    setForm({
                      ...form,
                      validity_days: nextDays,
                      membership_end_date: addIncludedDays(
                        form.membership_start_date,
                        Number(nextDays) || 1,
                      ),
                    })
                  }}
                  type="number"
                  value={form.validity_days}
                />
              </div>
            ) : null}
            <div>
              <label
                className="text-sm font-semibold"
                htmlFor="payment-validity-end"
              >
                Fin de vigencia inclusive
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="payment-validity-end"
                onChange={(event) => {
                  const nextEnd = event.target.value
                  setForm({
                    ...form,
                    validity_mode: 'manual',
                    membership_end_date: nextEnd,
                    validity_days: includedDaysBetween(
                      form.membership_start_date,
                      nextEnd,
                    ),
                  })
                }}
                type="date"
                value={form.membership_end_date}
              />
            </div>
          </div>
          <p className="rounded-2xl bg-[var(--brand-soft)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">
            {validityCopy(
              form.membership_start_date,
              form.membership_end_date,
              form.validity_mode,
            )}
          </p>
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
