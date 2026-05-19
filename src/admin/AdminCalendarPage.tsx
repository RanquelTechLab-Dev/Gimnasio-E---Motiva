import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  archiveActivity,
  cancelClassSession,
  createActivity,
  createClassSession,
  deleteActivity,
  deleteClassSession,
  formatAdminError,
  listActivities,
  listCalendarSessions,
  updateActivity,
  updateClassSession,
} from './api'
import type {
  Activity,
  ActivityInput,
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

type RecurrenceFormState = {
  enabled: boolean
  weekday: string
  date_from: string
  date_to: string
  start_time: string
  end_time: string
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

const weekdayLabels = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado',
]

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

function formatLocalTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
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

function localDateTimeToIso(dateValue: string, timeValue: string) {
  return dateTimeLocalToIso(`${dateValue}T${timeValue}`)
}

function getDateTimeParts(value: string) {
  const [date = '', time = ''] = value.split('T')
  return {
    date,
    time: time.slice(0, 5),
  }
}

function buildRecurrenceForm(form: ClassFormState): RecurrenceFormState {
  const start = new Date(form.starts_at)
  const end = new Date(form.ends_at)
  return {
    enabled: false,
    weekday: String(start.getDay()),
    date_from: formatLocalDate(start),
    date_to: formatLocalDate(addDays(start, 28)),
    start_time: formatLocalTime(start),
    end_time: formatLocalTime(end),
  }
}

function buildRecurringDates(
  dateFrom: string,
  dateTo: string,
  weekday: number,
) {
  const start = new Date(`${dateFrom}T00:00:00`)
  const end = new Date(`${dateTo}T00:00:00`)
  const dates: string[] = []

  for (
    let cursor = start;
    cursor <= end && dates.length <= 80;
    cursor = addDays(cursor, 1)
  ) {
    if (cursor.getDay() === weekday) {
      dates.push(formatLocalDate(cursor))
    }
  }

  return dates
}

function buildEmptyForm(activities: Activity[]): ClassFormState {
  const firstActiveActivity = activities.find((activity) => activity.active)
  const start = new Date()
  start.setHours(start.getHours() + 2, 0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)

  return {
    activity_id: firstActiveActivity?.id ?? '',
    title: '',
    starts_at: formatDateTimeLocal(start),
    ends_at: formatDateTimeLocal(end),
    capacity: '8',
    coach_name: '',
    notes: '',
    active: true,
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
  const [recurrence, setRecurrence] = useState<RecurrenceFormState>(
    buildRecurrenceForm(buildEmptyForm([])),
  )
  const [activityForm, setActivityForm] =
    useState<ActivityFormState>(emptyActivityForm)
  const [showActivityEditor, setShowActivityEditor] = useState(false)
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
  const selectedActivity = useMemo(
    () => activities.find((activity) => activity.id === form.activity_id) ?? null,
    [activities, form.activity_id],
  )
  const selectedManagedActivity = useMemo(
    () =>
      activities.find((activity) => activity.id === activityForm.id) ?? null,
    [activities, activityForm.id],
  )
  const classActivities = useMemo(
    () =>
      activities.filter(
        (activity) =>
          activity.active ||
          (selectedSession ? activity.id === form.activity_id : false),
      ),
    [activities, form.activity_id, selectedSession],
  )
  const hasActiveActivities = useMemo(
    () => activities.some((activity) => activity.active),
    [activities],
  )
  const canSubmitClass =
    Boolean(selectedSession) || (hasActiveActivities && Boolean(form.activity_id))
  const isPersonalizedOneOnOne =
    selectedActivity?.slug === 'personalizado_1_1'
  const startParts = getDateTimeParts(form.starts_at)
  const endParts = getDateTimeParts(form.ends_at)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [nextActivities, nextSessions] = await Promise.all([
        listActivities(true),
        listCalendarSessions(
          dateInputToRangeStart(fromDate),
          dateInputToRangeEnd(toDate),
        ),
      ])
      setActivities(nextActivities)
      setSessions(nextSessions)
      setForm((current) => {
        if (current.activity_id) {
          const currentActivity = nextActivities.find(
            (activity) => activity.id === current.activity_id,
          )
          if (
            currentActivity?.active ||
            nextSessions.some(
              (session) =>
                session.session_id === selectedSessionId &&
                session.activity_id === current.activity_id,
            )
          ) {
            return current
          }
        }

        return buildEmptyForm(nextActivities)
      })
      if (activityForm.id) {
        const nextSelected = nextActivities.find(
          (activity) => activity.id === activityForm.id,
        )
        if (nextSelected) {
          setActivityForm(activityToForm(nextSelected))
        }
      }
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
    const nextForm = {
      ...sessionToForm(session),
      capacity:
        session.activity_slug === 'personalizado_1_1'
          ? '1'
          : String(session.capacity),
    }
    setForm(nextForm)
    setRecurrence(buildRecurrenceForm(nextForm))
    setCancelReason('')
    setError(null)
    setSuccess(null)
  }

  function selectManagedActivity(activity: Activity) {
    setActivityForm(activityToForm(activity))
    setShowActivityEditor(true)
    setError(null)
    setSuccess(null)
  }

  function resetForm() {
    const nextForm = buildEmptyForm(activities)
    setSelectedSessionId(null)
    setForm(nextForm)
    setRecurrence(buildRecurrenceForm(nextForm))
    setCancelReason('')
    setError(null)
    setSuccess(null)
  }

  function updateStartDateTime(dateValue: string, timeValue: string) {
    const nextStartsAt = `${dateValue}T${timeValue}`
    const previousStart = new Date(form.starts_at)
    const previousEnd = new Date(form.ends_at)
    const previousRecurrenceStart = new Date(`${recurrence.date_from}T00:00:00`)
    const previousRecurrenceEnd = new Date(`${recurrence.date_to}T00:00:00`)
    const dayMs = 24 * 60 * 60 * 1000
    const previousSpanDays =
      Number.isFinite(previousRecurrenceStart.getTime()) &&
      Number.isFinite(previousRecurrenceEnd.getTime()) &&
      previousRecurrenceEnd >= previousRecurrenceStart
        ? Math.round(
            (previousRecurrenceEnd.getTime() -
              previousRecurrenceStart.getTime()) /
              dayMs,
          )
        : 28
    const durationMs = Math.max(
      previousEnd.getTime() - previousStart.getTime(),
      30 * 60 * 1000,
    )
    const nextEnd = new Date(new Date(nextStartsAt).getTime() + durationMs)
    const nextRecurrenceEnd = addDays(
      new Date(`${dateValue}T00:00:00`),
      previousSpanDays,
    )

    setForm({
      ...form,
      starts_at: nextStartsAt,
      ends_at: formatDateTimeLocal(nextEnd),
    })
    setRecurrence({
      ...recurrence,
      date_from: dateValue,
      date_to: formatLocalDate(nextRecurrenceEnd),
      start_time: timeValue,
      end_time: formatLocalTime(nextEnd),
      weekday: String(new Date(`${dateValue}T00:00:00`).getDay()),
    })
  }

  function updateEndDateTime(dateValue: string, timeValue: string) {
    setForm({
      ...form,
      ends_at: `${dateValue}T${timeValue}`,
    })
    setRecurrence({
      ...recurrence,
      end_time: timeValue,
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedForm = {
      ...form,
      capacity: isPersonalizedOneOnOne ? '1' : form.capacity,
    }
    const capacity = Number(normalizedForm.capacity)

    if (!selectedSession && !hasActiveActivities) {
      setError(
        'No hay actividades activas disponibles. Activa o crea una actividad antes de crear clases.',
      )
      return
    }

    if (!form.activity_id || !form.title.trim()) {
      setError('Selecciona actividad y titulo para la clase.')
      return
    }

    if (!Number.isFinite(capacity) || capacity <= 0) {
      setError('El cupo debe ser mayor a cero.')
      return
    }

    if (isPersonalizedOneOnOne && capacity > 1) {
      setError('Personalizado 1:1 permite maximo 1 alumno.')
      return
    }

    if (recurrence.enabled && !selectedSession) {
      const weekday = Number(recurrence.weekday)
      const recurringDates = buildRecurringDates(
        recurrence.date_from,
        recurrence.date_to,
        weekday,
      )

      if (
        !Number.isInteger(weekday) ||
        !recurrence.date_from ||
        !recurrence.date_to ||
        recurrence.date_to < recurrence.date_from
      ) {
        setError('Completa un rango valido para repetir la clase.')
        return
      }

      if (recurringDates.length === 0) {
        setError('No hay fechas para crear con ese dia de semana y rango.')
        return
      }

      if (recurringDates.length > 52) {
        setError('La recurrencia no puede crear mas de 52 clases por vez.')
        return
      }

      if (
        new Date(`${recurrence.date_from}T${recurrence.start_time}`) >=
        new Date(`${recurrence.date_from}T${recurrence.end_time}`)
      ) {
        setError('La hora de fin debe ser posterior a la hora de inicio.')
        return
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const input = formToInput(normalizedForm)
      if (selectedSession) {
        await updateClassSession({
          ...input,
          session_id: selectedSession.session_id,
          active: form.active,
        } satisfies UpdateClassSessionInput)
        setSuccess('Clase actualizada.')
      } else if (recurrence.enabled) {
        const recurringDates = buildRecurringDates(
          recurrence.date_from,
          recurrence.date_to,
          Number(recurrence.weekday),
        )
        const existingSessions = await listCalendarSessions(
          dateInputToRangeStart(recurrence.date_from),
          dateInputToRangeEnd(recurrence.date_to),
        )
        const existingKeys = new Set(
          existingSessions.map((session) => {
            return [
              session.activity_id,
              formatDateTimeLocal(new Date(session.starts_at)),
              formatDateTimeLocal(new Date(session.ends_at)),
            ].join('|')
          }),
        )
        const createdDates: string[] = []
        const skippedDates: string[] = []

        for (const dateValue of recurringDates) {
          const startsAt = localDateTimeToIso(dateValue, recurrence.start_time)
          const endsAt = localDateTimeToIso(dateValue, recurrence.end_time)
          const duplicateKey = [
            form.activity_id,
            `${dateValue}T${recurrence.start_time}`,
            `${dateValue}T${recurrence.end_time}`,
          ].join('|')

          if (existingKeys.has(duplicateKey)) {
            skippedDates.push(dateValue)
            continue
          }

          await createClassSession({
            ...input,
            starts_at: startsAt,
            ends_at: endsAt,
          })
          createdDates.push(dateValue)
        }

        if (createdDates.length === 0) {
          setError('No se crearon clases nuevas porque ya existian en ese rango.')
        } else {
          setSuccess(
            skippedDates.length > 0
              ? `Se crearon ${createdDates.length} clases. Se omitieron ${skippedDates.length} duplicadas.`
              : `Se crearon ${createdDates.length} clases recurrentes.`,
          )
        }
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

  async function handleDeleteSession() {
    if (!selectedSession) {
      return
    }

    const confirmed = window.confirm(
      'Solo se eliminara si la clase no tiene reservas ni asistencia. Si tiene historial, cancelala. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteClassSession(selectedSession.session_id)
      setSuccess('Clase eliminada definitivamente.')
      resetForm()
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
          ? 'Actividad guardada. Tiene historial: los cambios aplican a nuevas clases.'
          : activityForm.id
            ? 'Actividad actualizada.'
            : 'Actividad creada.',
      )
      setShowActivityEditor(false)
      await loadData()
    } catch (saveError) {
      setError(formatAdminError(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveActivity(activity = selectedManagedActivity) {
    if (!activity) {
      return
    }

    const confirmed = window.confirm(
      'Archivar oculta para nuevas clases, pero conserva historial. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await archiveActivity(activity.id)
      setSuccess('Actividad archivada. No aparecera para nuevas clases.')
      setShowActivityEditor(false)
      await loadData()
    } catch (archiveError) {
      setError(formatAdminError(archiveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteActivity(activity = selectedManagedActivity) {
    if (!activity) {
      return
    }

    const confirmed = window.confirm(
      'Eliminar solo esta disponible si nunca fue usada. Esta accion es definitiva. ¿Continuar?',
    )
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteActivity(activity.id)
      setSuccess('Tipo de clase eliminado definitivamente.')
      setActivityForm(emptyActivityForm)
      setShowActivityEditor(false)
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-5 pb-24">
      <div className="contents">
        <div className="order-1 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
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

        <div className="order-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Tipos de clase
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
                Tipos de clase
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Las actividades definen tipos de clase, colores, cupos y reglas
                de cancelacion. Los planes solo indican que actividades incluye
                el alumno.
              </p>
            </div>
            <button
              className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
              onClick={() => {
                setActivityForm(emptyActivityForm)
                setShowActivityEditor(true)
                setError(null)
                setSuccess(null)
              }}
              type="button"
            >
              Nuevo tipo de clase
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {activities.map((activity) => (
              <div
                className={`rounded-[20px] border p-4 text-left transition ${
                  activityForm.id === activity.id
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-[var(--line)] bg-[var(--surface-strong)]'
                }`}
                key={activity.id}
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
                      {activity.requires_24h_cancel
                        ? 'Cancelacion 24h'
                        : 'Cancelacion 12h'}
                      {activity.default_capacity
                        ? ` · cupo ${activity.default_capacity}`
                        : ''}
                      {activity.max_capacity
                        ? ` · maximo ${activity.max_capacity}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold transition hover:bg-white"
                    onClick={() => selectManagedActivity(activity)}
                    type="button"
                  >
                    Editar tipo
                  </button>
                  <button
                    className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold transition hover:bg-white disabled:opacity-60"
                    disabled={saving || !activity.active}
                    onClick={() => {
                      setActivityForm(activityToForm(activity))
                      void handleArchiveActivity(activity)
                    }}
                    type="button"
                  >
                    Archivar tipo
                  </button>
                  <button
                    className="rounded-2xl border border-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                    disabled={saving}
                    onClick={() => {
                      setActivityForm(activityToForm(activity))
                      void handleDeleteActivity(activity)
                    }}
                    type="button"
                  >
                    Eliminar tipo
                  </button>
                </div>
              </div>
            ))}
          </div>

          {showActivityEditor ? (
            <form
              className="mt-5 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              onSubmit={handleActivitySubmit}
            >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
                  Configuracion
                </p>
                <h4 className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {activityForm.id
                    ? 'Configurar tipo de clase'
                    : 'Nuevo tipo de clase'}
                </h4>
              </div>
              <button
                className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold"
                onClick={() => {
                  setActivityForm(emptyActivityForm)
                  setShowActivityEditor(true)
                }}
                type="button"
              >
                Nuevo tipo
              </button>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Estos cambios afectan al tipo de clase seleccionado y a futuras
              clases de este tipo. Archivar oculta para nuevas clases, pero
              conserva historial.
            </p>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-3 lg:grid-cols-2">
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
                    value={activityForm.name}
                  />
                </label>
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
              </div>
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
              <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="grid gap-2 sm:grid-cols-3">
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
                  Cancelacion 24h
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
                  Tipo activo
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
                    ? 'Guardar tipo'
                    : 'Crear tipo'}
              </button>
            </div>
            </form>
          ) : null}
        </div>
      </div>

      <div className="order-2 grid gap-5">
        <form
          className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5"
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
              disabled={!selectedSession && !hasActiveActivities}
              onChange={(event) => {
                const nextActivity = activities.find(
                  (activity) => activity.id === event.target.value,
                )
                setForm({
                  ...form,
                  activity_id: event.target.value,
                  capacity:
                    nextActivity?.slug === 'personalizado_1_1'
                      ? '1'
                      : form.capacity,
                })
              }}
              value={form.activity_id}
            >
              <option value="">Seleccionar actividad</option>
              {classActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                  {activity.active ? '' : ' (archivada)'}
                </option>
              ))}
            </select>
            {!selectedSession && !hasActiveActivities ? (
              <p className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                No hay actividades activas disponibles. Activa o crea una
                actividad antes de crear clases.
              </p>
            ) : null}
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Configuracion del tipo de clase
                  </p>
                  {selectedActivity ? (
                    <div className="mt-2 flex items-start gap-3">
                      <span
                        className="mt-1 h-4 w-4 rounded-full border border-[var(--line)]"
                        style={{
                          backgroundColor:
                            selectedActivity.color_hex ?? '#75cfc2',
                        }}
                      />
                      <div>
                        <p className="text-sm font-bold text-[var(--ink)]">
                          {selectedActivity.name}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {selectedActivity.default_capacity
                            ? `Cupo ${selectedActivity.default_capacity}`
                            : 'Sin cupo por defecto'}
                          {selectedActivity.max_capacity
                            ? ` · maximo ${selectedActivity.max_capacity}`
                            : ''}
                          {' · '}
                          {selectedActivity.requires_24h_cancel
                            ? 'cancelacion 24h'
                            : 'cancelacion 12h'}
                          {selectedActivity.flexible_schedule
                            ? ' · horario flexible'
                            : ''}
                          {' · '}
                          {selectedActivity.active ? 'tipo activo' : 'archivado'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Selecciona un tipo de clase para ver su configuracion.
                    </p>
                  )}
                </div>
                {selectedActivity ? (
                  <button
                    className="shrink-0 rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold transition hover:bg-white"
                    onClick={() => {
                      setActivityForm(activityToForm(selectedActivity))
                      setShowActivityEditor(true)
                    }}
                    type="button"
                  >
                    Configurar tipo
                  </button>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                Estos cambios afectan al tipo de clase seleccionado y a futuras
                clases de este tipo.
              </p>
            </div>
            <input
              aria-label="Titulo de la clase"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Titulo"
              value={form.title}
            />
            <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Fecha y hora
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                  Fecha de inicio
                  <input
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                    onChange={(event) =>
                      updateStartDateTime(event.target.value, startParts.time)
                    }
                    type="date"
                    value={startParts.date}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                  Hora de inicio
                  <input
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                    onChange={(event) =>
                      updateStartDateTime(startParts.date, event.target.value)
                    }
                    type="time"
                    value={startParts.time}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                  Fecha de fin
                  <input
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                    onChange={(event) =>
                      updateEndDateTime(event.target.value, endParts.time)
                    }
                    type="date"
                    value={endParts.date}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                  Hora de fin
                  <input
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                    onChange={(event) =>
                      updateEndDateTime(endParts.date, event.target.value)
                    }
                    type="time"
                    value={endParts.time}
                  />
                </label>
              </div>
            </div>
            {!selectedSession ? (
              <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3">
                <label className="flex items-start gap-3 text-sm font-semibold text-[var(--ink)]">
                  <input
                    checked={recurrence.enabled}
                    className="mt-1"
                    onChange={(event) =>
                      setRecurrence({
                        ...recurrence,
                        enabled: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    Crear clase recurrente
                    <span className="block text-xs font-normal text-[var(--muted)]">
                      Repite la clase en el dia elegido, evita duplicados exactos
                      y crea hasta 52 clases por vez.
                    </span>
                  </span>
                </label>
                {recurrence.enabled ? (
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                      Dia de semana
                      <select
                        className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                        onChange={(event) =>
                          setRecurrence({
                            ...recurrence,
                            weekday: event.target.value,
                          })
                        }
                        value={recurrence.weekday}
                      >
                        {weekdayLabels.map((label, index) => (
                          <option key={label} value={String(index)}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                        Fecha desde
                        <input
                          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                          onChange={(event) =>
                            setRecurrence({
                              ...recurrence,
                              date_from: event.target.value,
                            })
                          }
                          type="date"
                          value={recurrence.date_from}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                        Fecha hasta
                        <input
                          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                          onChange={(event) =>
                            setRecurrence({
                              ...recurrence,
                              date_to: event.target.value,
                            })
                          }
                          type="date"
                          value={recurrence.date_to}
                        />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                        Hora inicio
                        <input
                          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                          onChange={(event) =>
                            setRecurrence({
                              ...recurrence,
                              start_time: event.target.value,
                            })
                          }
                          type="time"
                          value={recurrence.start_time}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                        Hora fin
                        <input
                          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                          onChange={(event) =>
                            setRecurrence({
                              ...recurrence,
                              end_time: event.target.value,
                            })
                          }
                          type="time"
                          value={recurrence.end_time}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                aria-label="Cupo"
                className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                disabled={isPersonalizedOneOnOne}
                max={isPersonalizedOneOnOne ? '1' : undefined}
                min="1"
                onChange={(event) => {
                  const nextCapacity = isPersonalizedOneOnOne
                    ? '1'
                    : event.target.value
                  setForm({ ...form, capacity: nextCapacity })
                }}
                placeholder="Cupo"
                type="number"
                value={isPersonalizedOneOnOne ? '1' : form.capacity}
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
            {isPersonalizedOneOnOne ? (
              <p className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                Personalizado 1:1 permite maximo 1 alumno.
              </p>
            ) : null}
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
              disabled={saving || !canSubmitClass}
              type="submit"
            >
              {saving
                ? 'Guardando...'
                : selectedSession
                  ? 'Guardar clase'
                  : recurrence.enabled
                    ? 'Crear clases recurrentes'
                    : 'Crear clase'}
            </button>
          </div>
        </form>

        {selectedSession ? (
          <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
              Cancelacion
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Cancela la clase y procesa reservas activas segun las reglas del
              plan.
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
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Eliminacion segura
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Esta clase solo se elimina si no tiene reservas ni asistencia.
                Si tiene historial, no se puede eliminar; podes cancelarla.
              </p>
              <button
                className="mt-3 rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                disabled={saving}
                onClick={() => void handleDeleteSession()}
                type="button"
              >
                Eliminar clase
              </button>
            </div>
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
      </div>
    </section>
  )
}
