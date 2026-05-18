import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatAppError, getMyProfileSummary } from '../../app/api'
import { formatCurrency, formatDate, formatDateTime } from '../../app/format'
import type { StudentProfileSummary } from '../../app/types'

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold text-[var(--ink)]">{value}</p>
      {detail ? <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p> : null}
    </article>
  )
}

function membershipClassesSummary(
  membership: StudentProfileSummary['active_membership'],
) {
  if (!membership) {
    return {
      label: 'Clases',
      value: 'Sin datos',
      detail: undefined,
    }
  }

  if (membership.plan_type === 'weekly') {
    return {
      label: 'Plan semanal',
      value: 'Por semana',
      detail: 'El calendario muestra cuantas clases quedan por actividad.',
    }
  }

  if (membership.plan_type === 'package') {
    return {
      label: 'Clases restantes',
      value:
        membership.remaining_credits === null
          ? 'Sin datos'
          : String(membership.remaining_credits),
      detail: membership.package_class_count
        ? `${membership.package_class_count} clases del paquete`
        : undefined,
    }
  }

  return {
    label: 'Clases',
    value:
      membership.remaining_credits === null
        ? 'Segun plan'
        : String(membership.remaining_credits),
    detail: undefined,
  }
}

export function StudentDashboardPage() {
  const [summary, setSummary] = useState<StudentProfileSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadSummary() {
      setLoading(true)
      setError(null)
      try {
        const nextSummary = await getMyProfileSummary()
        if (active) {
          setSummary(nextSummary)
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

    void loadSummary()

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Cargando resumen...</p>
  }

  if (error) {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
        {error}
      </p>
    )
  }

  if (!summary) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
        No hay datos de alumno disponibles.
      </div>
    )
  }

  const membership = summary.active_membership
  const nextBooking = summary.next_booking
  const lastPayment = summary.last_payment
  const lastAttendance = summary.last_attendance
  const classesSummary = membershipClassesSummary(membership)

  return (
    <section className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          detail={membership ? `Vence ${formatDate(membership.end_date)}` : undefined}
          label="Membresia"
          value={membership?.plan_name ?? 'Sin membresia activa'}
        />
        <SummaryCard
          detail={classesSummary.detail}
          label={classesSummary.label}
          value={classesSummary.value}
        />
        <SummaryCard
          detail={nextBooking?.activity_name}
          label="Proxima clase"
          value={nextBooking ? formatDateTime(nextBooking.starts_at) : 'Sin reservas'}
        />
        <SummaryCard
          detail={lastAttendance?.title}
          label="Ultima asistencia"
          value={lastAttendance ? formatDateTime(lastAttendance.recorded_at) : 'Sin asistencia'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Perfil
          </p>
          <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
            {summary.profile.first_name} {summary.profile.last_name}
          </h3>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-[var(--muted)]">Email</dt>
              <dd>{summary.profile.email}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Telefono</dt>
              <dd>{summary.profile.phone ?? 'Sin telefono'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Emails</dt>
              <dd>{summary.profile.receives_emails ? 'Recibe novedades' : 'No recibe novedades'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--muted)]">Actividad real</dt>
              <dd>{formatDateTime(summary.profile.last_real_activity_at)}</dd>
            </div>
          </dl>
          <Link
            className="mt-5 inline-flex rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
            to="/app/profile"
          >
            Editar datos permitidos
          </Link>
        </article>

        <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
            Pagos
          </p>
          {lastPayment ? (
            <div className="mt-3 text-sm">
              <p className="text-2xl font-bold text-[var(--ink)]">
                {formatCurrency(Number(lastPayment.amount))}
              </p>
              <p className="mt-1 text-[var(--muted)]">
                {lastPayment.status} · {formatDateTime(lastPayment.paid_at)}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Todavia no hay pagos registrados.
            </p>
          )}
          <Link
            className="mt-5 inline-flex rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
            to="/app/payments"
          >
            Ver pagos
          </Link>
        </article>
      </div>
    </section>
  )
}
