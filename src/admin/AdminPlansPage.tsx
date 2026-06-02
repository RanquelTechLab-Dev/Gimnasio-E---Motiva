import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
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
  visible_to_students: boolean
  max_active_memberships: string
  activities: Array<{
    activity_id: string
    weekly_class_limit: string
    monthly_credits: string
  }>
}

type PendingPlanEdit = {
  planId: string
  input: PlanInput
}

type ActivityFormState = {
  name: string
  description: string
  color_hex: string
  default_capacity: string
  max_capacity: string
  active: boolean
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
  visible_to_students: true,
  max_active_memberships: '',
  activities: [],
}

const emptyActivityForm: ActivityFormState = {
  name: '',
  description: '',
  color_hex: '#75cfc2',
  default_capacity: '10',
  max_capacity: '10',
  active: true,
}

function activityToForm(activity: Activity): ActivityFormState {
  const capacity = String(
    activity.max_capacity ?? activity.default_capacity ?? 10,
  )

  return {
    name: activity.name,
    description: activity.description ?? '',
    color_hex: activity.color_hex ?? '#75cfc2',
    default_capacity: capacity,
    max_capacity: capacity,
    active: activity.active,
  }
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
    visible_to_students: plan.visible_to_students,
    max_active_memberships: plan.max_active_memberships
      ? String(plan.max_active_memberships)
      : '',
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

function normalizeActivityName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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
      ? `${plan.package_class_count} clases configuradas`
      : 'Clases sin cantidad definida'
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

function activitySummary(activity: Activity | null | undefined) {
  if (!activity) {
    return null
  }

  const parts = [
    activity.active ? 'Activa' : 'Archivada',
    'Cancelacion alumnos hasta 3h antes',
  ]

  if (activity.max_capacity ?? activity.default_capacity) {
    parts.push(`cupo maximo ${activity.max_capacity ?? activity.default_capacity}`)
  }

  return parts.join(' · ')
}

function planHasHistory(plan: Plan | null) {
  return Boolean(plan?.memberships?.length)
}

function normalizePlanActivities(plan: Plan | null) {
  return (plan?.plan_activities ?? [])
    .map((item) => ({
      activity_id: item.activities?.id ?? item.activity_id ?? '',
      monthly_credits: item.monthly_credits ?? null,
      weekly_class_limit: item.weekly_class_limit ?? null,
    }))
    .filter((item) => item.activity_id)
    .sort((left, right) => left.activity_id.localeCompare(right.activity_id))
}

function normalizeFormActivities(form: PlanFormState) {
  return form.activities
    .filter((item) => item.activity_id)
    .map((item) => ({
      activity_id: item.activity_id,
      monthly_credits:
        form.plan_type === 'weekly' || !item.monthly_credits.trim()
          ? null
          : Number(item.monthly_credits),
      weekly_class_limit:
        form.plan_type === 'weekly' ? Number(item.weekly_class_limit) : null,
    }))
    .sort((left, right) => left.activity_id.localeCompare(right.activity_id))
}

function planActivitiesChanged(plan: Plan | null, form: PlanFormState) {
  return (
    JSON.stringify(normalizePlanActivities(plan)) !==
    JSON.stringify(normalizeFormActivities(form))
  )
}

function toPlanInput(form: PlanFormState): PlanInput {
  const price = parseNonNegativeNumber(form.price, 'El precio')
  const billingPeriodDays = parsePositiveInteger(
    form.billing_period_days,
    'La vigencia del pago',
    true,
  )
  const packageClassCount =
    form.plan_type === 'package'
      ? parsePositiveInteger(
          form.package_class_count,
          'La cantidad de clases del plan',
          true,
        )
      : null
  const maxActiveMemberships = parsePositiveInteger(
    form.max_active_memberships,
    'El limite de inscriptos',
    false,
  )

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
    visible_to_students: form.visible_to_students,
    max_active_memberships: maxActiveMemberships,
    activities,
  }
}

function toActivityInput(form: ActivityFormState): ActivityInput {
  if (!form.name.trim()) {
    throw new Error('El nombre de la actividad principal es obligatorio.')
  }

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    requires_24h_cancel: false,
    flexible_schedule: false,
    active: form.active,
    color_hex: form.color_hex.trim() || '#75cfc2',
    default_capacity: parsePositiveInteger(
      form.max_capacity || form.default_capacity,
      'El cupo maximo',
      false,
    ),
    max_capacity: parsePositiveInteger(
      form.max_capacity,
      'El cupo maximo',
      false,
    ),
  }
}

export function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [planDeleteTarget, setPlanDeleteTarget] = useState<Plan | null>(null)
  const [planDeleteConfirmation, setPlanDeleteConfirmation] = useState('')
  const [pendingPlanEdit, setPendingPlanEdit] = useState<PendingPlanEdit | null>(
    null,
  )
  const [planEditConfirmation, setPlanEditConfirmation] = useState('')
  const [editorMode, setEditorMode] = useState<'activity' | 'plan'>('plan')
  const [activityForm, setActivityForm] =
    useState<ActivityFormState>(emptyActivityForm)
  const [selectedActivityId, setSelectedActivityId] = useState('')
  const [activityDeleteTarget, setActivityDeleteTarget] =
    useState<Activity | null>(null)
  const [activityDeleteConfirmation, setActivityDeleteConfirmation] =
    useState('')

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === planForm.id) ?? null,
    [plans, planForm.id],
  )
  const selectedPlanHasHistory = planHasHistory(selectedPlan)
  const selectedActivity = useMemo(
    () => activities.find((activity) => activity.id === selectedActivityId) ?? null,
    [activities, selectedActivityId],
  )

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

      if (selectedActivityId) {
        const nextSelectedActivity = nextActivities.find(
          (activity) => activity.id === selectedActivityId,
        )
        if (nextSelectedActivity) {
          setActivityForm(activityToForm(nextSelectedActivity))
        } else {
          setSelectedActivityId('')
          setActivityForm(emptyActivityForm)
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
    setPendingPlanEdit(null)
    setPlanEditConfirmation('')
    setEditorMode('plan')
  }

  function selectActivity(activityId: string) {
    setSelectedActivityId(activityId)
    setError(null)
    setSuccess(null)

    const activity = activities.find((item) => item.id === activityId)
    setActivityForm(activity ? activityToForm(activity) : emptyActivityForm)
  }

  function startNewActivity() {
    setSelectedActivityId('')
    setActivityForm(emptyActivityForm)
    setError(null)
    setSuccess(null)
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

  async function handleActivitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = toActivityInput(activityForm)
      const nextNameKey = normalizeActivityName(input.name)
      const duplicate = activities.find(
        (activity) =>
          activity.id !== selectedActivityId &&
          normalizeActivityName(activity.name) === nextNameKey,
      )

      if (duplicate) {
        throw new Error(
          duplicate.active
            ? 'Ya existe una actividad principal activa con ese nombre.'
            : 'Ya existe una actividad principal inactiva con ese nombre. Revisala antes de crear otra.',
        )
      }

      const result = selectedActivityId
        ? await updateActivity(selectedActivityId, input)
        : await createActivity(input)
      const nextActivities = await listActivities(true)
      setActivities(nextActivities)

      const resultActivityId =
        result && typeof result === 'object' && 'activity_id' in result
          ? String((result as { activity_id?: unknown }).activity_id ?? '')
          : ''
      const createdActivity =
        nextActivities.find((activity) => activity.id === resultActivityId) ??
        nextActivities.find(
          (activity) => normalizeActivityName(activity.name) === nextNameKey,
        )

      if (createdActivity) {
        setSelectedActivityId(createdActivity.id)
        setPlanForm((current) =>
          current.activities.some(
            (item) => item.activity_id === createdActivity.id,
          )
            ? current
            : {
                ...current,
                activities: [
                  ...current.activities,
                  {
                    activity_id: createdActivity.id,
                    weekly_class_limit:
                      current.plan_type === 'weekly' ? '1' : '',
                    monthly_credits: '',
                  },
                ],
              },
        )
      }

      const updatedActivity =
        nextActivities.find((activity) => activity.id === selectedActivityId) ??
        createdActivity
      if (updatedActivity) {
        setActivityForm(activityToForm(updatedActivity))
      }

      setSuccess(
        selectedActivityId
          ? 'Actividad principal actualizada.'
          : 'Actividad principal creada. Ya podes asociarla a un plan.',
      )
    } catch (createError) {
      setError(formatAdminError(createError))
    } finally {
      setSaving(false)
    }
  }

  function requestDeleteActivity(activity: Activity | null) {
    if (!activity) {
      return
    }

    setError(null)
    setSuccess(null)
    setActivityDeleteTarget(activity)
    setActivityDeleteConfirmation('')
  }

  async function handleDeleteActivity() {
    if (!activityDeleteTarget || activityDeleteConfirmation !== 'ELIMINAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteActivity(activityDeleteTarget.id, activityDeleteConfirmation)
      setPlanForm((current) => ({
        ...current,
        activities: current.activities.filter(
          (item) => item.activity_id !== activityDeleteTarget.id,
        ),
      }))
      if (selectedActivityId === activityDeleteTarget.id) {
        setSelectedActivityId('')
        setActivityForm(emptyActivityForm)
      }
      setActivityDeleteTarget(null)
      setActivityDeleteConfirmation('')
      setSuccess('Actividad principal eliminada definitivamente.')
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  async function savePlan(input: PlanInput, planId: string | null) {
    const result = planId ? await updatePlan(planId, input) : await createPlan(input)
    setSuccess(
      result.has_history
        ? 'Plan guardado. Tiene historial: no se eliminaron pagos, alumnos ni membresias.'
        : planId
          ? 'Plan actualizado.'
          : 'Plan creado.',
    )
    await loadData()
  }

  async function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = toPlanInput(planForm)
      if (
        planForm.id &&
        selectedPlanHasHistory &&
        planActivitiesChanged(selectedPlan, planForm)
      ) {
        setPendingPlanEdit({ input, planId: planForm.id })
        setPlanEditConfirmation('')
        return
      }

      await savePlan(input, planForm.id)
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmPlanEdit() {
    if (!pendingPlanEdit || planEditConfirmation !== 'EDITAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await savePlan(pendingPlanEdit.input, pendingPlanEdit.planId)
      setPendingPlanEdit(null)
      setPlanEditConfirmation('')
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  function requestDeletePlan() {
    if (!selectedPlan) {
      return
    }

    setError(null)
    setSuccess(null)
    setPlanDeleteTarget(selectedPlan)
    setPlanDeleteConfirmation('')
  }

  async function handleDeletePlan() {
    if (!planDeleteTarget || planDeleteConfirmation !== 'ELIMINAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deletePlan(planDeleteTarget.id)
      setSuccess('Plan eliminado definitivamente.')
      setPlanDeleteTarget(null)
      setPlanDeleteConfirmation('')
      setPlanForm(emptyPlanForm)
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
                    {plan.active ? 'Activo' : 'Inactivo'} ·{' '}
                    {plan.visible_to_students
                      ? 'Visible para alumnos'
                      : 'Oculto para alumnos'}{' '}
                    · {plan.max_active_memberships
                      ? `${plan.max_active_memberships} inscriptos max.`
                      : 'Sin limite de inscriptos'}{' '}
                    · {plan.billing_period_days} dias · {plan.plan_type}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      <aside className="grid gap-5">
        <div className="inline-flex h-auto w-fit max-w-full self-start flex-wrap items-center gap-1 rounded-full border border-[var(--line)] bg-white p-1 shadow-sm">
          <button
            className={`h-auto rounded-full px-3 py-1.5 text-[11px] font-bold leading-none transition ${
              editorMode === 'activity'
                ? 'bg-[var(--brand)] text-white'
                : 'bg-[var(--surface-strong)] text-[var(--ink)] hover:bg-[var(--brand-soft)]'
            }`}
            onClick={() => {
              setEditorMode('activity')
              startNewActivity()
              setError(null)
              setSuccess(null)
            }}
            type="button"
          >
            Nueva actividad principal
          </button>
          <button
            className={`h-auto rounded-full px-3 py-1.5 text-[11px] font-bold leading-none transition ${
              editorMode === 'plan'
                ? 'bg-[var(--brand)] text-white'
                : 'bg-[var(--surface-strong)] text-[var(--ink)] hover:bg-[var(--brand-soft)]'
            }`}
            onClick={() => {
              setEditorMode('plan')
              setPlanForm(emptyPlanForm)
              setPendingPlanEdit(null)
              setPlanEditConfirmation('')
              setError(null)
              setSuccess(null)
            }}
            type="button"
          >
            Nuevo plan
          </button>
        </div>
        {editorMode === 'plan' ? (
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
              onClick={() => {
                setEditorMode('plan')
                setPlanForm(emptyPlanForm)
              }}
              type="button"
            >
              Nuevo plan
            </button>
          </div>

          {selectedPlan ? (
            <p className="mt-3 rounded-2xl bg-[var(--brand-soft)] p-3 text-xs text-[var(--brand)]">
              {selectedPlanHasHistory
                ? 'Este plan tiene historial operativo. Podes editar sus actividades incluidas; los cambios aplican hacia adelante y no eliminan pagos, alumnos ni membresias.'
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
                Vigencia del pago (dias)
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
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  La vigencia corre desde el dia de pago hasta el mismo dia del
                  mes siguiente.
                </span>
              </label>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3 text-sm">
              <p className="font-bold text-[var(--ink)]">Regla de uso</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {planForm.plan_type === 'weekly'
                  ? 'Este plan habilita clases por semana dentro de la vigencia paga. Las clases no usadas no se acumulan.'
                  : 'Este plan conserva una configuracion anterior de clases. Para convertirlo a clases semanales hace falta una migracion aprobada.'}
              </p>
            </div>
            {planForm.plan_type === 'package' ? (
              <label className="text-sm font-semibold">
                Clases configuradas del plan
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-[var(--ink)]">
                    Actividades incluidas
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Elegi que actividad principal habilita este plan. Por
                    ejemplo, un plan Programa Kids 3 clases debe incluir la
                    actividad principal Programa Kids.
                    Los planes semanales habilitan clases por semana dentro de
                    la vigencia paga; las clases no usadas no se acumulan.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
                    onClick={addPlanActivity}
                    type="button"
                  >
                    Agregar actividad al plan
                  </button>
                </div>
              </div>
              {planForm.activities.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  Este plan no tiene actividades incluidas. No habilitara
                  reservas hasta que agregues al menos una actividad.
                </p>
              ) : null}
              {planForm.activities.map((item, index) => (
                <div className="grid gap-2 rounded-2xl bg-white p-3" key={index}>
                  {(() => {
                    const selectedPlanActivity =
                      activities.find(
                        (activity) => activity.id === item.activity_id,
                      ) ?? null
                    const summary = activitySummary(selectedPlanActivity)

                    return (
                      <>
                        <select
                          className="rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
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
                        {summary ? (
                          <p className="text-xs text-[var(--muted)]">
                            {summary}
                          </p>
                        ) : null}
                        {planForm.plan_type === 'weekly' ? (
                          <label className="text-xs font-semibold">
                            Clases por semana para esta actividad
                            <input
                              className="mt-1 w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
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
                            Clases para esta actividad
                            <input
                              className="mt-1 w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
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
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold text-[var(--ink)]"
                            onClick={() => removePlanActivity(index)}
                            type="button"
                          >
                            Quitar actividad del plan
                          </button>
                        </div>
                        <p className="text-[11px] text-[var(--muted)]">
                          Esto solo quita la actividad de este plan. La
                          actividad principal sigue existiendo.
                        </p>
                      </>
                    )
                  })()}
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
            <label className="grid gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3 text-sm font-semibold">
              <span className="flex items-center gap-3">
                <input
                  checked={planForm.visible_to_students}
                  onChange={(event) =>
                    setPlanForm({
                      ...planForm,
                      visible_to_students: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Visible para alumnos
              </span>
              <span className="pl-6 text-xs font-normal text-[var(--muted)]">
                Si está desactivado, el plan puede usarse internamente pero no
                aparece en Planes y precios del alumno.
              </span>
            </label>
            <label className="text-sm font-semibold">
              Límite de inscriptos
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                min="1"
                onChange={(event) =>
                  setPlanForm({
                    ...planForm,
                    max_active_memberships: event.target.value,
                  })
                }
                placeholder="Sin límite"
                type="number"
                value={planForm.max_active_memberships}
              />
              <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                Dejalo vacío para sin límite.
              </span>
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
                  Eliminar borra definitivamente el plan y sus relaciones
                  operativas. Si tiene pagos reales, la base lo bloquea para
                  evitar borrar cobros.
                </p>
                <div className="grid gap-2">
                  <button
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                    disabled={saving}
                    onClick={requestDeletePlan}
                    type="button"
                  >
                    Eliminar plan
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </form>
        ) : (
          <form
            className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
            onSubmit={handleActivitySubmit}
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
              Actividad principal
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              {selectedActivity ? 'Editar actividad principal' : 'Nueva actividad principal'}
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Administra el catalogo base de actividades. Despues podes usar
              estas actividades en uno o mas planes y crear horarios en
              Calendario.
            </p>
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <label className="text-sm font-semibold sm:flex-1">
                    Gestionar actividad principal
                    <select
                      className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                      onChange={(event) => selectActivity(event.target.value)}
                      value={selectedActivityId}
                    >
                      <option value="">Crear nueva actividad</option>
                      {activities
                        .slice()
                        .sort((left, right) => left.name.localeCompare(right.name))
                        .map((activity) => (
                          <option key={activity.id} value={activity.id}>
                            {activity.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-xs font-bold transition hover:bg-white"
                    onClick={startNewActivity}
                    type="button"
                  >
                    Crear nueva actividad
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Crear o editar una actividad principal no crea horarios ni
                  planes automaticamente.
                </p>
              </div>
              <label className="text-sm font-semibold">
                Nombre
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      name: event.target.value,
                    })
                  }
                  placeholder="Programa Kids"
                  value={activityForm.name}
                />
              </label>
              <label className="text-sm font-semibold">
                Descripcion
                <textarea
                  className="mt-2 min-h-24 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      description: event.target.value,
                    })
                  }
                  value={activityForm.description}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Color
                  <input
                    className="mt-2 h-12 w-full rounded-2xl border border-[var(--line)] bg-white px-2 py-1"
                    onChange={(event) =>
                      setActivityForm({
                        ...activityForm,
                        color_hex: event.target.value,
                      })
                    }
                    type="color"
                    value={activityForm.color_hex}
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
                        default_capacity: event.target.value,
                        max_capacity: event.target.value,
                      })
                    }
                    type="number"
                    value={activityForm.max_capacity || activityForm.default_capacity}
                  />
                  <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                    El cupo maximo define cuantos alumnos pueden reservar una
                    clase de esta actividad.
                  </span>
                </label>
              </div>
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
                Actividad activa / disponible para usar
              </label>
              <button
                className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? 'Guardando...'
                  : selectedActivity
                    ? 'Guardar cambios'
                    : 'Crear actividad principal'}
              </button>
              {selectedActivity ? (
                <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                  <p className="text-xs text-[var(--muted)]">
                    Eliminar borra definitivamente esta actividad principal y
                    sus datos operativos relacionados. Para evitar errores, se
                    pide escribir ELIMINAR.
                  </p>
                  <button
                    className="rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                    disabled={saving}
                    onClick={() => requestDeleteActivity(selectedActivity)}
                    type="button"
                  >
                    Eliminar actividad principal
                  </button>
                </div>
              ) : null}
            </div>
          </form>
        )}

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
      {activityDeleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[24px] bg-[var(--surface)] p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              Eliminacion definitiva
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Eliminar actividad principal
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Esta accion eliminara definitivamente esta actividad principal y
              sus datos operativos relacionados. Se quitara de los planes que la
              usen y no se podra deshacer. No se borraran alumnos, pagos,
              programas asignados ni planes. Para confirmar, escribi ELIMINAR.
            </p>
            <p className="mt-3 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm font-semibold text-[var(--accent)]">
              {activityDeleteTarget.name}
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Escribi ELIMINAR para confirmar
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setActivityDeleteConfirmation(event.target.value)
                }
                value={activityDeleteConfirmation}
              />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-[var(--surface-strong)]"
                disabled={saving}
                onClick={() => {
                  setActivityDeleteTarget(null)
                  setActivityDeleteConfirmation('')
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={saving || activityDeleteConfirmation !== 'ELIMINAR'}
                onClick={() => void handleDeleteActivity()}
                type="button"
              >
                {saving ? 'Eliminando...' : 'Eliminar actividad'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {planDeleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[24px] bg-[var(--surface)] p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              Eliminacion definitiva
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Eliminar {planDeleteTarget.name}
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Esta accion eliminara definitivamente este plan y sus relaciones
              operativas. No se podra deshacer. Si tiene pagos reales, la base
              lo va a bloquear.
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Escribi ELIMINAR para confirmar
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPlanDeleteConfirmation(event.target.value)
                }
                value={planDeleteConfirmation}
              />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-[var(--surface-strong)]"
                disabled={saving}
                onClick={() => {
                  setPlanDeleteTarget(null)
                  setPlanDeleteConfirmation('')
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={saving || planDeleteConfirmation !== 'ELIMINAR'}
                onClick={() => void handleDeletePlan()}
                type="button"
              >
                {saving ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingPlanEdit ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[24px] bg-[var(--surface)] p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
              Editar plan
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Editar plan con historial
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Este plan tiene historial operativo. Si cambiás las actividades
              incluidas o las clases por semana, se modificará qué clases pueden
              reservar los alumnos con este plan desde ahora. No se eliminarán
              pagos, alumnos ni membresías. Para confirmar, escribí EDITAR.
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Escribí EDITAR para confirmar
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setPlanEditConfirmation(event.target.value)
                }
                value={planEditConfirmation}
              />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-[var(--surface-strong)]"
                disabled={saving}
                onClick={() => {
                  setPendingPlanEdit(null)
                  setPlanEditConfirmation('')
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-2xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={saving || planEditConfirmation !== 'EDITAR'}
                onClick={() => void handleConfirmPlanEdit()}
                type="button"
              >
                {saving ? 'Guardando...' : 'Confirmar edición'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
