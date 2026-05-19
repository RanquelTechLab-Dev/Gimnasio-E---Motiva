import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  archiveActivity,
  archivePlan,
  createActivity,
  createPlan,
  deleteActivity,
  deletePlan,
  formatAdminError,
  listActivities,
  listPlans,
  updateActivity,
  updatePlan,
} from './api'
import type {
  Activity,
  ActivityInput,
  Plan,
  PlanActivityInput,
  PlanInput,
  PlanType,
} from './types'

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

type PlanFormState = {
  id: string | null
  name: string
  description: string
  price: string
  billing_period_days: string
  plan_type: PlanType
  package_class_count: string
  active: boolean
  activities: Array<{
    activity_id: string
    weekly_class_limit: string
    monthly_credits: string
  }>
}

type ActivityFormState = {
  id: string | null
  name: string
  description: string
  requires_24h_cancel: boolean
  flexible_schedule: boolean
  active: boolean
  color_hex: string
  default_capacity: string
  max_capacity: string
}

const emptyPlanForm: PlanFormState = {
  id: null,
  name: '',
  description: '',
  price: '0',
  billing_period_days: '30',
  plan_type: 'weekly',
  package_class_count: '',
  active: true,
  activities: [],
}

const emptyActivityForm: ActivityFormState = {
  id: null,
  name: '',
  description: '',
  requires_24h_cancel: false,
  flexible_schedule: false,
  active: true,
  color_hex: '',
  default_capacity: '',
  max_capacity: '',
}

function planToForm(plan: Plan): PlanFormState {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description ?? '',
    price: String(plan.price ?? 0),
    billing_period_days: String(plan.billing_period_days ?? 30),
    plan_type: plan.plan_type,
    package_class_count: plan.package_class_count
      ? String(plan.package_class_count)
      : '',
    active: plan.active,
    activities: (plan.plan_activities ?? [])
      .filter((item) => item.activities)
      .map((item) => ({
        activity_id: item.activities?.id ?? item.activity_id ?? '',
        weekly_class_limit: item.weekly_class_limit
          ? String(item.weekly_class_limit)
          : '',
        monthly_credits: item.monthly_credits ? String(item.monthly_credits) : '',
      })),
  }
}

function activityToForm(activity: Activity): ActivityFormState {
  return {
    id: activity.id,
    name: activity.name,
    description: activity.description ?? '',
    requires_24h_cancel: activity.requires_24h_cancel,
    flexible_schedule: activity.flexible_schedule,
    active: activity.active,
    color_hex: activity.color_hex ?? '',
    default_capacity: activity.default_capacity
      ? String(activity.default_capacity)
      : '',
    max_capacity: activity.max_capacity ? String(activity.max_capacity) : '',
  }
}

function parsePositiveInteger(value: string, label: string, required = false) {
  if (!value.trim()) {
    if (required) {
      throw new Error(`${label} es obligatorio.`)
    }
    return null
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} debe ser un numero entero mayor a cero.`)
  }

  return parsed
}

function parseNonNegativeNumber(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} debe ser mayor o igual a cero.`)
  }

  return parsed
}

function planAccessLabel(plan: Plan) {
  if (plan.plan_type === 'weekly') {
    const limits = (plan.plan_activities ?? [])
      .map((item) => item.weekly_class_limit)
      .filter((value): value is number => value !== null)

    if (limits.length === 0) {
      return 'Limite semanal pendiente'
    }

    const total = limits.reduce((sum, value) => sum + value, 0)
    return `${total} clases por semana`
  }

  if (plan.plan_type === 'package') {
    return plan.package_class_count
      ? `${plan.package_class_count} clases del paquete`
      : 'Paquete sin cantidad definida'
  }

  return 'Configuracion manual'
}

function planActivityLabel(item: NonNullable<Plan['plan_activities']>[number]) {
  if (!item.activities) {
    return null
  }

  if (item.weekly_class_limit !== null) {
    return `${item.activities.name} · ${item.weekly_class_limit} por semana`
  }

  if (item.monthly_credits !== null) {
    return `${item.activities.name} · ${item.monthly_credits} clases`
  }

  return item.activities.name
}

function planHasHistory(plan: Plan | null) {
  return Boolean(plan?.memberships?.length)
}

function toPlanInput(form: PlanFormState): PlanInput {
  const price = parseNonNegativeNumber(form.price, 'El precio')
  const billingPeriodDays = parsePositiveInteger(
    form.billing_period_days,
    'El periodo de facturacion',
    true,
  )
  const packageClassCount =
    form.plan_type === 'package'
      ? parsePositiveInteger(
          form.package_class_count,
          'La cantidad de clases del paquete',
          true,
        )
      : null

  const activities: PlanActivityInput[] = form.activities
    .filter((item) => item.activity_id)
    .map((item) => ({
      activity_id: item.activity_id,
      weekly_class_limit:
        form.plan_type === 'weekly'
          ? parsePositiveInteger(
              item.weekly_class_limit,
              'El limite semanal',
              true,
            )
          : null,
      monthly_credits:
        form.plan_type === 'weekly'
          ? null
          : parsePositiveInteger(item.monthly_credits, 'Las clases', false),
    }))

  if (form.plan_type === 'weekly' && activities.length === 0) {
    throw new Error('Los planes semanales requieren al menos una actividad.')
  }

  return {
    name: form.name,
    description: form.description,
    price,
    billing_period_days: billingPeriodDays ?? 30,
    plan_type: form.plan_type,
    package_class_count: packageClassCount,
    active: form.active,
    activities,
  }
}

function toActivityInput(form: ActivityFormState): ActivityInput {
  const defaultCapacity = parsePositiveInteger(
    form.default_capacity,
    'El cupo por defecto',
  )
  const maxCapacity = parsePositiveInteger(form.max_capacity, 'El cupo maximo')

  if (defaultCapacity && maxCapacity && defaultCapacity > maxCapacity) {
    throw new Error('El cupo por defecto no puede superar el cupo maximo.')
  }

  return {
    name: form.name,
    description: form.description,
    requires_24h_cancel: form.requires_24h_cancel,
    flexible_schedule: form.flexible_schedule,
    active: form.active,
    color_hex: form.color_hex,
    default_capacity: defaultCapacity,
    max_capacity: maxCapacity,
  }
}

export function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm)
  const [activityForm, setActivityForm] =
    useState<ActivityFormState>(emptyActivityForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === planForm.id) ?? null,
    [plans, planForm.id],
  )
  const selectedActivity = useMemo(
    () =>
      activities.find((activity) => activity.id === activityForm.id) ?? null,
    [activities, activityForm.id],
  )
  const selectedPlanHasHistory = planHasHistory(selectedPlan)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [nextPlans, nextActivities] = await Promise.all([
        listPlans(),
        listActivities(true),
      ])
      setPlans(nextPlans)
      setActivities(nextActivities)

      if (planForm.id) {
        const nextSelected = nextPlans.find((plan) => plan.id === planForm.id)
        if (nextSelected) {
          setPlanForm(planToForm(nextSelected))
        }
      }

      if (activityForm.id) {
        const nextSelected = nextActivities.find(
          (activity) => activity.id === activityForm.id,
        )
        if (nextSelected) {
          setActivityForm(activityToForm(nextSelected))
        }
      }
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

  function selectPlan(plan: Plan) {
    setPlanForm(planToForm(plan))
    setSuccess(null)
    setError(null)
  }

  function selectActivity(activity: Activity) {
    setActivityForm(activityToForm(activity))
    setSuccess(null)
    setError(null)
  }

  function addPlanActivity() {
    const firstAvailable = activities.find(
      (activity) =>
        activity.active &&
        !planForm.activities.some((item) => item.activity_id === activity.id),
    )

    if (!firstAvailable) {
      setError('No hay actividades activas disponibles para agregar.')
      return
    }

    setPlanForm({
      ...planForm,
      activities: [
        ...planForm.activities,
        {
          activity_id: firstAvailable.id,
          weekly_class_limit: planForm.plan_type === 'weekly' ? '1' : '',
          monthly_credits: '',
        },
      ],
    })
  }

  function updatePlanActivity(
    index: number,
    patch: Partial<PlanFormState['activities'][number]>,
  ) {
    setPlanForm({
      ...planForm,
      activities: planForm.activities.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    })
  }

  function removePlanActivity(index: number) {
    setPlanForm({
      ...planForm,
      activities: planForm.activities.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  async function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = toPlanInput(planForm)
      const result = planForm.id
        ? await updatePlan(planForm.id, input)
        : await createPlan(input)
      setSuccess(
        result.has_history
          ? 'Plan guardado. Tiene historial: solo se actualizaron datos administrativos.'
          : planForm.id
            ? 'Plan actualizado.'
            : 'Plan creado.',
      )
      await loadData()
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchivePlan() {
    if (!selectedPlan) {
      return
    }

    const confirmed = window.confirm(
      'Archivar oculta para nuevos usos, pero conserva historial. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await archivePlan(selectedPlan.id)
      setSuccess('Plan archivado. No aparecera en nuevas asignaciones.')
      await loadData()
    } catch (archiveError) {
      setError(formatAdminError(archiveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePlan() {
    if (!selectedPlan) {
      return
    }

    const confirmed = window.confirm(
      'Eliminar solo esta disponible si nunca fue usado. Esta accion es definitiva. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deletePlan(selectedPlan.id)
      setSuccess('Plan eliminado definitivamente.')
      setPlanForm(emptyPlanForm)
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  async function handleActivitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = toActivityInput(activityForm)
      const result = activityForm.id
        ? await updateActivity(activityForm.id, input)
        : await createActivity(input)
      setSuccess(
        result.has_history
          ? 'Actividad guardada. Tiene historial: los cambios aplican a nuevos usos.'
          : activityForm.id
            ? 'Actividad actualizada.'
            : 'Actividad creada.',
      )
      await loadData()
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveActivity() {
    if (!selectedActivity) {
      return
    }

    const confirmed = window.confirm(
      'Archivar oculta para nuevas clases y nuevos planes, pero conserva historial. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await archiveActivity(selectedActivity.id)
      setSuccess('Actividad archivada.')
      await loadData()
    } catch (archiveError) {
      setError(formatAdminError(archiveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteActivity() {
    if (!selectedActivity) {
      return
    }

    const confirmed = window.confirm(
      'Eliminar solo esta disponible si nunca fue usada ni vinculada a planes. Esta accion es definitiva. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteActivity(selectedActivity.id)
      setSuccess('Actividad eliminada definitivamente.')
      setActivityForm(emptyActivityForm)
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  const planFormActivityIds = new Set(
    planForm.activities.map((item) => item.activity_id).filter(Boolean),
  )
  const selectableActivities = activities.filter(
    (activity) => activity.active || planFormActivityIds.has(activity.id),
  )

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="grid gap-5">
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Planes
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                Catalogo de planes
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
            <p className="mt-5 text-sm text-[var(--muted)]">
              Cargando planes...
            </p>
          ) : plans.length === 0 ? (
            <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
              No hay planes disponibles.
            </div>
          ) : (
            <div className="mt-5 grid gap-3">
              {plans.map((plan) => (
                <button
                  className={`rounded-[20px] border p-4 text-left transition ${
                    planForm.id === plan.id
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                      : 'border-[var(--line)] bg-[var(--surface-strong)] hover:border-[var(--brand)]'
                  }`}
                  key={plan.id}
                  onClick={() => selectPlan(plan)}
                  type="button"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">
                        {plan.name}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {plan.description ?? 'Sin descripcion cargada.'}
                      </p>
                    </div>
                    <div className="text-sm font-semibold text-[var(--ink)]">
                      {moneyFormatter.format(plan.price)}
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                    {planAccessLabel(plan)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(plan.plan_activities ?? []).map((item) =>
                      item.activities ? (
                        <span
                          className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[var(--ink)]"
                          key={`${plan.id}-${item.activities.id}`}
                        >
                          {planActivityLabel(item)}
                        </span>
                      ) : null,
                    )}
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                    {plan.active ? 'Activo' : 'Archivado'} ·{' '}
                    {plan.billing_period_days} dias · {plan.plan_type}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Actividades
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                Actividades del gimnasio
              </h3>
            </div>
            <button
              className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
              onClick={() => setActivityForm(emptyActivityForm)}
              type="button"
            >
              Nueva actividad
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {activities.map((activity) => (
              <button
                className={`rounded-[20px] border p-4 text-left transition ${
                  activityForm.id === activity.id
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-strong)] hover:border-[var(--brand)]'
                }`}
                key={activity.id}
                onClick={() => selectActivity(activity)}
                type="button"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 h-4 w-4 rounded-full border border-[var(--line)]"
                    style={{ backgroundColor: activity.color_hex ?? '#75cfc2' }}
                  />
                  <div>
                    <p className="font-semibold text-[var(--ink)]">
                      {activity.name}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {activity.active ? 'Activa' : 'Archivada'} ·{' '}
                      {activity.requires_24h_cancel ? 'Cancela 24h' : 'Cancela 12h'}
                      {activity.max_capacity
                        ? ` · maximo ${activity.max_capacity}`
                        : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <aside className="grid gap-5">
        <form
          className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
          onSubmit={handlePlanSubmit}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Edicion
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                {planForm.id ? 'Editar plan' : 'Nuevo plan'}
              </h3>
            </div>
            <button
              className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
              onClick={() => setPlanForm(emptyPlanForm)}
              type="button"
            >
              Nuevo plan
            </button>
          </div>

          {selectedPlan ? (
            <p className="mt-3 rounded-2xl bg-[var(--brand-soft)] p-3 text-xs text-[var(--brand)]">
              {selectedPlanHasHistory
                ? 'Este plan tiene historial. Solo se pueden editar datos administrativos. Para cambiar actividades, limites o tipo, crea un plan nuevo y archiva el anterior.'
                : 'Este plan no tiene membresias asociadas; se puede editar la configuracion completa.'}
            </p>
          ) : null}

          <div className="mt-5 grid gap-4">
            <label className="text-sm font-semibold">
              Nombre
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPlanForm({ ...planForm, name: event.target.value })
                }
                value={planForm.name}
              />
            </label>
            <label className="text-sm font-semibold">
              Descripcion
              <textarea
                className="mt-2 min-h-24 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPlanForm({ ...planForm, description: event.target.value })
                }
                value={planForm.description}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Precio
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="0"
                  onChange={(event) =>
                    setPlanForm({ ...planForm, price: event.target.value })
                  }
                  step="0.01"
                  type="number"
                  value={planForm.price}
                />
              </label>
              <label className="text-sm font-semibold">
                Dias del periodo
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="1"
                  onChange={(event) =>
                    setPlanForm({
                      ...planForm,
                      billing_period_days: event.target.value,
                    })
                  }
                  type="number"
                  value={planForm.billing_period_days}
                />
              </label>
            </div>
            <label className="text-sm font-semibold">
              Tipo de plan
              <select
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                disabled={selectedPlanHasHistory}
                onChange={(event) =>
                  setPlanForm({
                    ...planForm,
                    plan_type: event.target.value as PlanType,
                    package_class_count:
                      event.target.value === 'package'
                        ? planForm.package_class_count
                        : '',
                    activities: planForm.activities.map((item) => ({
                      ...item,
                      weekly_class_limit:
                        event.target.value === 'weekly'
                          ? item.weekly_class_limit || '1'
                          : '',
                    })),
                  })
                }
                value={planForm.plan_type}
              >
                <option value="weekly">Semanal</option>
                <option value="package">Paquete</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            {planForm.plan_type === 'package' ? (
              <label className="text-sm font-semibold">
                Clases del paquete
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  disabled={selectedPlanHasHistory}
                  min="1"
                  onChange={(event) =>
                    setPlanForm({
                      ...planForm,
                      package_class_count: event.target.value,
                    })
                  }
                  type="number"
                  value={planForm.package_class_count}
                />
              </label>
            ) : null}

            <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-[var(--ink)]">
                  Actividades incluidas
                </p>
                <button
                  className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
                  disabled={selectedPlanHasHistory}
                  onClick={addPlanActivity}
                  type="button"
                >
                  Agregar
                </button>
              </div>
              {planForm.activities.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  Agrega actividades para planes semanales o paquetes.
                </p>
              ) : null}
              {planForm.activities.map((item, index) => (
                <div className="grid gap-2 rounded-2xl bg-white p-3" key={index}>
                  <select
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
                    disabled={selectedPlanHasHistory}
                    onChange={(event) =>
                      updatePlanActivity(index, {
                        activity_id: event.target.value,
                      })
                    }
                    value={item.activity_id}
                  >
                    {selectableActivities.map((activity) => (
                      <option key={activity.id} value={activity.id}>
                        {activity.name}
                      </option>
                    ))}
                  </select>
                  {planForm.plan_type === 'weekly' ? (
                    <label className="text-xs font-semibold">
                      Clases por semana para esta actividad
                      <input
                        className="mt-1 w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
                        disabled={selectedPlanHasHistory}
                        min="1"
                        onChange={(event) =>
                          updatePlanActivity(index, {
                            weekly_class_limit: event.target.value,
                          })
                        }
                        type="number"
                        value={item.weekly_class_limit}
                      />
                    </label>
                  ) : (
                    <label className="text-xs font-semibold">
                      Clases asociadas opcionales
                      <input
                        className="mt-1 w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
                        disabled={selectedPlanHasHistory}
                        min="1"
                        onChange={(event) =>
                          updatePlanActivity(index, {
                            monthly_credits: event.target.value,
                          })
                        }
                        type="number"
                        value={item.monthly_credits}
                      />
                    </label>
                  )}
                  <button
                    className="justify-self-start rounded-2xl border border-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent)]"
                    disabled={selectedPlanHasHistory}
                    onClick={() => removePlanActivity(index)}
                    type="button"
                  >
                    Quitar actividad
                  </button>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                checked={planForm.active}
                onChange={(event) =>
                  setPlanForm({ ...planForm, active: event.target.checked })
                }
                type="checkbox"
              />
              Plan activo
            </label>
            <button
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Guardando...' : planForm.id ? 'Guardar plan' : 'Crear plan'}
            </button>
            {selectedPlan ? (
              <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Archivar oculta para nuevos usos, pero conserva historial.
                  Eliminar solo esta disponible si nunca fue usado.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-white disabled:opacity-60"
                    disabled={saving || !selectedPlan.active}
                    onClick={() => void handleArchivePlan()}
                    type="button"
                  >
                    Archivar plan
                  </button>
                  <button
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => void handleDeletePlan()}
                    type="button"
                  >
                    Eliminar plan
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </form>

        <form
          className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
          onSubmit={handleActivitySubmit}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Actividades
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                {activityForm.id ? 'Editar actividad' : 'Nueva actividad'}
              </h3>
            </div>
            <button
              className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
              onClick={() => setActivityForm(emptyActivityForm)}
              type="button"
            >
              Nueva
            </button>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="text-sm font-semibold">
              Nombre
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setActivityForm({ ...activityForm, name: event.target.value })
                }
                value={activityForm.name}
              />
            </label>
            <label className="text-sm font-semibold">
              Descripcion
              <textarea
                className="mt-2 min-h-20 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setActivityForm({
                    ...activityForm,
                    description: event.target.value,
                  })
                }
                value={activityForm.description}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">
                Color
                <input
                  className="mt-2 h-11 w-full rounded-2xl border border-[var(--line)] bg-white px-2 py-1"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      color_hex: event.target.value,
                    })
                  }
                  type="color"
                  value={activityForm.color_hex || '#75cfc2'}
                />
              </label>
              <label className="text-sm font-semibold">
                Cupo por defecto
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="1"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      default_capacity: event.target.value,
                    })
                  }
                  type="number"
                  value={activityForm.default_capacity}
                />
              </label>
              <label className="text-sm font-semibold">
                Cupo maximo
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="1"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      max_capacity: event.target.value,
                    })
                  }
                  type="number"
                  value={activityForm.max_capacity}
                />
              </label>
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={activityForm.requires_24h_cancel}
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      requires_24h_cancel: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Requiere cancelacion con 24h
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={activityForm.flexible_schedule}
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      flexible_schedule: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Horario flexible
              </label>
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={activityForm.active}
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      active: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Actividad activa
              </label>
            </div>
            {activityForm.max_capacity === '1' ? (
              <p className="rounded-2xl bg-[var(--brand-soft)] p-3 text-xs font-semibold text-[var(--brand)]">
                Personalizado 1:1 permite maximo 1 alumno.
              </p>
            ) : null}
            <button
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving
                ? 'Guardando...'
                : activityForm.id
                  ? 'Guardar actividad'
                  : 'Crear actividad'}
            </button>
            {selectedActivity ? (
              <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  La actividad usada por clases o planes no se elimina: se
                  archiva para conservar historial.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-white disabled:opacity-60"
                    disabled={saving || !selectedActivity.active}
                    onClick={() => void handleArchiveActivity()}
                    type="button"
                  >
                    Archivar actividad
                  </button>
                  <button
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => void handleDeleteActivity()}
                    type="button"
                  >
                    Eliminar actividad
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </form>

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
