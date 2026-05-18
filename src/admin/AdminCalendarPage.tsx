import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  cancelClassSession,
  createClassSession,
  formatAdminError,
  listActivities,
  listCalendarSessions,
  updateClassSession,
} from './api'
import type {
  Activity,
  CalendarSession,
  ClassSessionInput,
  UpdateClassSessionInput,
} from './types'
import { WeeklyScheduleGrid } from '../components/calendar/WeeklyScheduleGrid'

type ClassFormState = {
  activity_id: string
  title: string
  starts_at: string
  ends_at: string
  capacity: string
  coach_name: string
  notes: string
  active: boolean
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeLocal(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${formatLocalDate(date)}T${hours}:${minutes}`
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

function dateTimeLocalToIso(value: string) {
  return new Date(value).toISOString()
}

function buildEmptyForm(activities: Activity[]): ClassFormState {
  const start = new Date()
  start.setHours(start.getHours() + 2, 0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)

  return {
    activity_id: activities[0]?.id ?? '',
    title: '',
    starts_at: formatDateTimeLocal(start),
    ends_at: formatDateTimeLocal(end),
    capacity: '8',
    coach_name: '',
    notes: '',
    active: true,
  }
}

function sessionToForm(session: CalendarSession): ClassFormState {
  return {
    activity_id: session.activity_id,
    title: session.title,
    starts_at: formatDateTimeLocal(new Date(session.starts_at)),
    ends_at: formatDateTimeLocal(new Date(session.ends_at)),
    capacity: String(session.capacity),
    coach_name: session.trainer_name ?? '',
    notes: session.notes ?? '',
    active: session.active,
  }
}

function formToInput(form: ClassFormState): ClassSessionInput {
  return {
    activity_id: form.activity_id,
    title: form.title,
    starts_at: dateTimeLocalToIso(form.starts_at),
    ends_at: dateTimeLocalToIso(form.ends_at),
    capacity: Number(form.capacity),
    coach_name: form.coach_name,
    notes: form.notes,
  }
}

export function AdminCalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [activities, setActivities] = useState<Activity[]>([])
  const [sessions, setSessions] = useState<CalendarSession[]>([])
  const [fromDate, setFromDate] = useState(formatLocalDate(today))
  const [toDate, setToDate] = useState(formatLocalDate(addDays(today, 6)))
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [form, setForm] = useState<ClassFormState>(buildEmptyForm([]))
  const [cancelReason, setCancelReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedSession = useMemo(
    () =>
      sessions.find((session) => session.session_id === selectedSessionId) ??
      null,
    [selectedSessionId, sessions],
  )

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [nextActivities, nextSessions] = await Promise.all([
        listActivities(),
        listCalendarSessions(
          dateInputToRangeStart(fromDate),
          dateInputToRangeEnd(toDate),
        ),
      ])
      setActivities(nextActivities)
      setSessions(nextSessions)
      setForm((current) =>
        current.activity_id ? current : buildEmptyForm(nextActivities),
      )
      if (
        selectedSessionId &&
        !nextSessions.some((session) => session.session_id === selectedSessionId)
      ) {
        setSelectedSessionId(null)
        setForm(buildEmptyForm(nextActivities))
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

  function selectSession(session: CalendarSession) {
    setSelectedSessionId(session.session_id)
    setForm(sessionToForm(session))
    setCancelReason('')
    setError(null)
    setSuccess(null)
  }

  function resetForm() {
    setSelectedSessionId(null)
    setForm(buildEmptyForm(activities))
    setCancelReason('')
    setError(null)
    setSuccess(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const capacity = Number(form.capacity)

    if (!form.activity_id || !form.title.trim()) {
      setError('Selecciona actividad y titulo para la clase.')
      return
    }

    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError('El cupo debe ser mayor a cero.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = formToInput(form)
      if (selectedSession) {
        await updateClassSession({
          ...input,
          session_id: selectedSession.session_id,
          active: form.active,
        } satisfies UpdateClassSessionInput)
        setSuccess('Clase actualizada.')
      } else {
        await createClassSession(input)
        setSuccess('Clase creada.')
      }
      await loadData()
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelSession() {
    if (!selectedSession) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await cancelClassSession(selectedSession.session_id, cancelReason)
      setSuccess('Clase cancelada y reservas activas procesadas.')
      resetForm()
      await loadData()
    } catch (cancelError) {
      setError(formatAdminError(cancelError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Calendario
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Clases y cupos
            </h3>
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

        <div className="mt-5">
          {loading ? (
            <p className="text-sm text-[var(--muted)]">Cargando clases...</p>
          ) : (
            <WeeklyScheduleGrid
              fromDate={fromDate}
              mode="admin"
              onSelectSession={selectSession}
              selectedSessionId={selectedSessionId}
              sessions={sessions}
              toDate={toDate}
            />
          )}
        </div>
      </div>

      <aside className="grid gap-5">
        <form
          className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5"
          onSubmit={handleSubmit}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                {selectedSession ? 'Edicion' : 'Nueva clase'}
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                {selectedSession ? 'Editar clase' : 'Crear clase'}
              </h3>
            </div>
            {selectedSession ? (
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
                onClick={resetForm}
                type="button"
              >
                Nueva
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3">
            <select
              aria-label="Actividad"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) =>
                setForm({ ...form, activity_id: event.target.value })
              }
              value={form.activity_id}
            >
              <option value="">Seleccionar actividad</option>
              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Titulo de la clase"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Titulo"
              value={form.title}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                aria-label="Inicio"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setForm({ ...form, starts_at: event.target.value })
                }
                type="datetime-local"
                value={form.starts_at}
              />
              <input
                aria-label="Fin"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setForm({ ...form, ends_at: event.target.value })
                }
                type="datetime-local"
                value={form.ends_at}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                aria-label="Cupo"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                min="1"
                onChange={(event) =>
                  setForm({ ...form, capacity: event.target.value })
                }
                placeholder="Cupo"
                type="number"
                value={form.capacity}
              />
              <input
                aria-label="Entrenador"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setForm({ ...form, coach_name: event.target.value })
                }
                placeholder="Entrenador"
                value={form.coach_name}
              />
            </div>
            <textarea
              aria-label="Notas"
              className="min-h-24 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notas internas"
              value={form.notes}
            />
            {selectedSession ? (
              <label className="flex items-center gap-3 text-sm font-semibold">
                <input
                  checked={form.active}
                  onChange={(event) =>
                    setForm({ ...form, active: event.target.checked })
                  }
                  type="checkbox"
                />
                Clase activa
              </label>
            ) : null}
            <button
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Guardando...' : selectedSession ? 'Guardar clase' : 'Crear clase'}
            </button>
          </div>
        </form>

        {selectedSession ? (
          <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              Cancelacion
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Cancela la clase y procesa reservas activas. Los creditos se
              devuelven desde la RPC.
            </p>
            <textarea
              className="mt-4 min-h-20 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Motivo de cancelacion"
              value={cancelReason}
            />
            <button
              className="mt-3 rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={saving || Boolean(selectedSession.cancelled_at)}
              onClick={() => void handleCancelSession()}
              type="button"
            >
              Cancelar clase
            </button>
          </div>
        ) : null}

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
