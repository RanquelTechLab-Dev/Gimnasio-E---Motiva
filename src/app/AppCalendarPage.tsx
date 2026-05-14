import { useEffect, useMemo, useState } from 'react'
import {
  bookClassSession,
  formatAppError,
  listCalendarSessions,
} from './api'
import type { CalendarSession } from './types'

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateInputToRangeStart(value: string) {
  return new Date(`${value}T00:00:00`).toISOString()
}

function dateInputToRangeEnd(value: string) {
  return new Date(`${value}T23:59:59.999`).toISOString()
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AppCalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [sessions, setSessions] = useState<CalendarSession[]>([])
  const [fromDate, setFromDate] = useState(formatLocalDate(today))
  const [toDate, setToDate] = useState(formatLocalDate(addDays(today, 14)))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const nextSessions = await listCalendarSessions(
        dateInputToRangeStart(fromDate),
        dateInputToRangeEnd(toDate),
      )
      setSessions(nextSessions)
    } catch (loadError) {
      setError(formatAppError(loadError))
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

  async function handleBook(session: CalendarSession) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await bookClassSession(session.session_id)
      setSuccess('Reserva creada. El credito se desconto al reservar si correspondia.')
      await loadData()
    } catch (bookError) {
      setError(formatAppError(bookError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Calendario
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
            Clases disponibles
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Las reservas se confirman segun tu plan, membresia, cupo disponible
            y creditos.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Fecha desde"
            className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
            onChange={(event) => setFromDate(event.target.value)}
            type="date"
            value={fromDate}
          />
          <input
            aria-label="Fecha hasta"
            className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
            onChange={(event) => setToDate(event.target.value)}
            type="date"
            value={toDate}
          />
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
            onClick={() => void loadData()}
            type="button"
          >
            Actualizar
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Cargando clases...</p>
      ) : sessions.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          No hay clases disponibles en este rango.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {sessions.map((session) => (
            <article
              className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              key={session.session_id}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold text-[var(--ink)]">
                    {session.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {session.activity_name} · {formatDateTime(session.starts_at)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Termina {formatDateTime(session.ends_at)}
                  </p>
                </div>
                <div className="text-sm font-semibold text-[var(--ink)]">
                  {session.spots_left} cupos libres
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent)]">
                    {session.requires_24h_cancel
                      ? 'Cancelacion 24h'
                      : 'Cancelacion 12h'}
                  </span>
                  {session.own_booking_id ? (
                    <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-[var(--brand)]">
                      Ya reservada
                    </span>
                  ) : null}
                  {session.block_reason ? (
                    <span className="rounded-full bg-white px-3 py-1 text-[var(--muted)]">
                      {session.block_reason}
                    </span>
                  ) : null}
                </div>
                <button
                  className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                  disabled={saving || !session.can_book}
                  onClick={() => void handleBook(session)}
                  type="button"
                >
                  Reservar
                </button>
              </div>
            </article>
          ))}
        </div>
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
    </section>
  )
}
