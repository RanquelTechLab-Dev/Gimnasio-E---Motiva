import { useEffect, useState } from 'react'
import { formatAppError, getMyProfileSummary } from '../../app/api'
import { formatDate } from '../../app/format'
import type { StudentProfileSummary } from '../../app/types'

export function StudentPlanPage() {
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
    return <p className="text-sm text-[var(--muted)]">Cargando membresia...</p>
  }

  if (error) {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
        {error}
      </p>
    )
  }

  const membership = summary?.active_membership

  return (
    <section className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
        Mi plan
      </p>
      {membership ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-[var(--muted)]">Plan actual</p>
            <p className="mt-1 text-2xl font-bold text-[var(--ink)]">
              {membership.plan_name}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--muted)]">Estado</p>
            <p className="mt-1 text-xl font-bold text-[var(--ink)]">
              {membership.status}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--muted)]">Vigencia</p>
            <p className="mt-1 text-[var(--ink)]">
              {formatDate(membership.start_date)} - {formatDate(membership.end_date)}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--muted)]">Creditos</p>
            <p className="mt-1 text-[var(--ink)]">
              {membership.remaining_credits === null
                ? 'Ilimitados'
                : membership.remaining_credits}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          No hay membresia activa para mostrar.
        </div>
      )}
    </section>
  )
}
