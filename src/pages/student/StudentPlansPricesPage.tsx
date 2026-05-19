import { useEffect, useMemo, useState } from 'react'
import { formatAppError, listActivePlansCatalog } from '../../app/api'
import { formatCurrency } from '../../app/format'
import type { StudentPlanCatalogItem } from '../../app/types'

function planTypeLabel(plan: StudentPlanCatalogItem) {
  if (plan.plan_type === 'weekly') {
    return 'Plan semanal'
  }

  if (plan.plan_type === 'package') {
    return 'Paquete de clases'
  }

  return 'Plan manual'
}

function planClassesLabel(plan: StudentPlanCatalogItem) {
  if (plan.plan_type === 'weekly') {
    const total = plan.plan_activities.reduce(
      (sum, item) => sum + (item.weekly_class_limit ?? 0),
      0,
    )

    return total > 0 ? `${total} clases por semana` : 'Clases por semana segun actividad'
  }

  if (plan.plan_type === 'package') {
    return plan.package_class_count
      ? `${plan.package_class_count} clases del paquete`
      : 'Paquete de clases'
  }

  return 'Condiciones a coordinar con administracion'
}

function activityLabel(
  activity: StudentPlanCatalogItem['plan_activities'][number],
  planType: StudentPlanCatalogItem['plan_type'],
) {
  const name = activity.activities?.name ?? 'Actividad'

  if (planType === 'weekly' && activity.weekly_class_limit) {
    return `${name}: ${activity.weekly_class_limit} por semana`
  }

  return name
}

function PlanCard({ plan }: { plan: StudentPlanCatalogItem }) {
  const activities = useMemo(
    () =>
      plan.plan_activities
        .filter((item) => item.activities?.active !== false)
        .map((item) => activityLabel(item, plan.plan_type)),
    [plan],
  )

  return (
    <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
            {planTypeLabel(plan)}
          </p>
          <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">{plan.name}</h3>
          {plan.description ? (
            <p className="mt-2 text-sm text-[var(--muted)]">{plan.description}</p>
          ) : null}
        </div>
        <div className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-left sm:text-right">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            Precio
          </p>
          <p className="mt-1 text-xl font-bold text-[var(--ink)]">
            {formatCurrency(Number(plan.price))}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-[var(--muted)]">Incluye</dt>
          <dd className="mt-1 text-[var(--ink)]">{planClassesLabel(plan)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--muted)]">Periodo</dt>
          <dd className="mt-1 text-[var(--ink)]">
            {plan.billing_period_days} dias
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <p className="text-sm font-semibold text-[var(--muted)]">
          Actividades incluidas
        </p>
        {activities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {activities.map((activity) => (
              <span
                className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-semibold text-[var(--ink)]"
                key={activity}
              >
                {activity}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Consultar actividades disponibles con administracion.
          </p>
        )}
      </div>

      <p className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--page)] px-4 py-3 text-sm text-[var(--muted)]">
        Consultá con administración para cambiar o contratar este plan. Los
        precios pueden actualizarse por administración.
      </p>
    </article>
  )
}

export function StudentPlansPricesPage() {
  const [plans, setPlans] = useState<StudentPlanCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadPlans() {
      setLoading(true)
      setError(null)
      try {
        const nextPlans = await listActivePlansCatalog()
        if (active) {
          setPlans(nextPlans.filter((plan) => plan.active))
        }
      } catch (loadError) {
        if (active) {
          setError(formatAppError(loadError))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPlans()

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Cargando planes...</p>
  }

  if (error) {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
        {error}
      </p>
    )
  }

  return (
    <section className="grid gap-5">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Planes y precios
        </p>
        <h2 className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">
          Planes disponibles
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Consultá con administración para cambiar o contratar otro plan. Esta
          pantalla es informativa y no realiza compras online.
        </p>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          No hay planes activos publicados en este momento.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </section>
  )
}
