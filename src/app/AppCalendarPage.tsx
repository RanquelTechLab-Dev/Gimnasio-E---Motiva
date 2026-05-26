import { useEffect, useMemo, useState } from 'react'
import {
  bookClassSession,
  cancelBooking,
  formatAppError,
  listCalendarSessions,
} from './api'
import type { CalendarSession } from './types'
import { WeeklyScheduleGrid } from '../components/calendar/WeeklyScheduleGrid'

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

export function AppCalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [sessions, setSessions] = useState<CalendarSession[]>([])
  const [fromDate, setFromDate] = useState(formatLocalDate(today))
  const [toDate, setToDate] = useState(formatLocalDate(addDays(today, 6)))
  const [loading, setLoading] = useState(true)
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null)
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
    setSavingSessionId(session.session_id)
    setError(null)
    setSuccess(null)
    try {
      await bookClassSession(session.session_id)
      setSuccess('Reserva creada.')
      await loadData()
    } catch (bookError) {
      setError(formatAppError(bookError))
    } finally {
      setSavingSessionId(null)
    }
  }

  async function handleCancel(session: CalendarSession) {
    if (!session.own_booking_id) {
      return
    }

    setSavingSessionId(session.session_id)
    setError(null)
    setSuccess(null)
    try {
      await cancelBooking(session.own_booking_id, 'Cancelada desde calendario.')
      setSuccess('Reserva cancelada.')
      await loadData()
    } catch (cancelError) {
      setError(formatAppError(cancelError))
    } finally {
      setSavingSessionId(null)
    }
  }

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
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
            y clases disponibles.
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

      <div className="mt-5 min-w-0 max-w-full overflow-hidden">
        {loading ? (
          <p className="text-sm text-[var(--muted)]">Cargando clases...</p>
        ) : (
          <WeeklyScheduleGrid
            fromDate={fromDate}
            mode="student"
            onBookSession={(session) => void handleBook(session)}
            onCancelBooking={(session) => void handleCancel(session)}
            savingSessionId={savingSessionId}
            sessions={sessions}
            toDate={toDate}
          />
        )}
      </div>

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
