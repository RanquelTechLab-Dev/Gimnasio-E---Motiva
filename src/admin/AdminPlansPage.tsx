import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  archivePlan,
  deletePlan,
  formatAdminError,
  listPlans,
  updatePlan,
} from './api'
import type { Plan } from './types'

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

type PlanFormState = {
  description: string
  price: string
  active: boolean
}

function planToForm(plan: Plan): PlanFormState {
  return {
    description: plan.description ?? '',
    price: String(plan.price ?? 0),
    active: plan.active,
  }
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

export function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [form, setForm] = useState<PlanFormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  )

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const nextPlans = await listPlans()
      setPlans(nextPlans)
      const nextSelected =
        nextPlans.find((plan) => plan.id === selectedPlanId) ??
        nextPlans[0] ??
        null
      setSelectedPlanId(nextSelected?.id ?? null)
      setForm(nextSelected ? planToForm(nextSelected) : null)
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
    setSelectedPlanId(plan.id)
    setForm(planToForm(plan))
    setSuccess(null)
    setError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedPlan || !form) {
      return
    }

    const price = Number(form.price)
    if (!Number.isFinite(price) || price < 0) {
      setError('El precio debe ser un numero mayor o igual a cero.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await updatePlan(selectedPlan.id, {
        description: form.description,
        price,
        active: form.active,
      })
      setSuccess('Plan actualizado.')
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
      'Este plan se archivara para que no aparezca en nuevas asignaciones. El historial se conserva. ¿Continuar?',
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
      'Solo se eliminara si nunca fue usado. Si tiene historial, hay que archivarlo. ¿Continuar?',
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
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Planes
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Planes y actividades
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
          <p className="mt-5 text-sm text-[var(--muted)]">Cargando planes...</p>
        ) : plans.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            No hay planes disponibles. Los seeds base deberian aparecer despues
            de aplicar la migracion inicial.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {plans.map((plan) => (
              <button
                className={`rounded-[20px] border p-4 text-left transition ${
                  selectedPlanId === plan.id
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
                {plan.price === 0 ? (
                  <p className="mt-3 rounded-2xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)]">
                    Sin precio vigente en el catalogo actual
                  </p>
                ) : null}
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
                  {plan.billing_period_days} dias
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Edicion
        </p>
        <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
          Precio y estado
        </h3>

        {!selectedPlan || !form ? (
          <p className="mt-5 text-sm text-[var(--muted)]">
            Selecciona un plan para editar precio, descripcion y estado.
          </p>
        ) : (
          <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-sm font-semibold" htmlFor="plan-name">
                Plan
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                disabled
                id="plan-name"
                value={selectedPlan.name}
              />
            </div>
            <div>
              <label className="text-sm font-semibold" htmlFor="plan-price">
                Precio
              </label>
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="plan-price"
                min="0"
                onChange={(event) =>
                  setForm({ ...form, price: event.target.value })
                }
                step="0.01"
                type="number"
                value={form.price}
              />
            </div>
            <div>
              <label
                className="text-sm font-semibold"
                htmlFor="plan-description"
              >
                Descripcion
              </label>
              <textarea
                className="mt-2 min-h-28 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                id="plan-description"
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                value={form.description}
              />
            </div>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                checked={form.active}
                onChange={(event) =>
                  setForm({ ...form, active: event.target.checked })
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
              {saving ? 'Guardando...' : 'Guardar plan'}
            </button>
            <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Baja segura
              </p>
              <p className="text-xs text-[var(--muted)]">
                Si el plan tiene historial, no se elimina: se archiva para que
                no aparezca en nuevas asignaciones.
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
          </form>
        )}

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
