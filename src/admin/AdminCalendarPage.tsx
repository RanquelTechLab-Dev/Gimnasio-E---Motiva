import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  cancelClassSession,
  convertClassSessionToRecurringRule,
  createActivity,
  createClassSession,
  createClassRecurringRule,
  deleteActivity,
  deleteClassSession,
  formatAdminError,
  listActivities,
  listCalendarSessions,
  updateActivity,
  updateRecurringClassSession,
  updateClassSession,
} from './api'
import type { DeleteClassSessionScope } from './api'
import type {
  Activity,
  ActivityInput,
  CalendarSession,
  ClassSessionInput,
  UpdateClassSessionInput,
} from './types'
import { WeeklyScheduleGrid } from '../components/calendar/WeeklyScheduleGrid'
import {
  addLocalDays,
  calendarDateRange,
  formatLocalDate,
} from '../lib/calendarRange'

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
  booking_cutoff_hours: string
  cancellation_cutoff_hours: string
}

type SessionDeleteRequest = {
  scope: DeleteClassSessionScope
  title: string
  description: string
}

type RecurringEditScope = 'single' | 'series'

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
  booking_cutoff_hours: '3',
  cancellation_cutoff_hours: '3',
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

function dateTimeLocalToIso(value: string) {
  return new Date(value).toISOString()
}

function getDateTimeParts(value: string) {
  const [date = '', time = ''] = value.split('T')
  return {
    date,
    time: time.slice(0, 5),
  }
}

function buildRecurrenceForm(
  form: ClassFormState,
  enabled = false,
): RecurrenceFormState {
  const start = new Date(form.starts_at)
  const end = new Date(form.ends_at)
  return {
    enabled,
    weekday: String(start.getDay()),
    date_from: formatLocalDate(start),
    start_time: formatLocalTime(start),
    end_time: formatLocalTime(end),
  }
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
    booking_cutoff_hours: String(activity.booking_cutoff_hours ?? 3),
    cancellation_cutoff_hours: String(
      activity.cancellation_cutoff_hours ?? 3,
    ),
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

function parseCutoffHours(value: string, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 168) {
    throw new Error(`${label} debe ser un numero entero entre 0 y 168.`)
  }

  return parsed
}

function toActivityInput(form: ActivityFormState): ActivityInput {
  const defaultCapacity = parsePositiveInteger(
    form.default_capacity,
    'El cupo por defecto',
  )
  const maxCapacity = parsePositiveInteger(form.max_capacity, 'El cupo maximo')

  return {
    name: form.name,
    description: form.description,
    requires_24h_cancel: form.requires_24h_cancel,
    flexible_schedule: form.flexible_schedule,
    active: form.active,
    color_hex: form.color_hex,
    default_capacity: defaultCapacity,
    max_capacity: maxCapacity,
    booking_cutoff_hours: parseCutoffHours(
      form.booking_cutoff_hours,
      'Las horas limite para reservar',
    ),
    cancellation_cutoff_hours: parseCutoffHours(
      form.cancellation_cutoff_hours,
      'Las horas limite para cancelar',
    ),
  }
}

function cutoffSummaryLabel(value: number | null | undefined, action: string) {
  const hours = value ?? 3
  if (hours === 0) {
    return `${action} hasta el inicio`
  }

  return `${action} hasta ${hours}h antes`
}

function getSessionDetail(session: CalendarSession) {
  const title = session.title.trim()
  return title && title !== session.activity_name ? title : ''
}

function sessionToForm(session: CalendarSession): ClassFormState {
  return {
    activity_id: session.activity_id,
    title: getSessionDetail(session),
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
    title: form.title.trim(),
    starts_at: dateTimeLocalToIso(form.starts_at),
    ends_at: dateTimeLocalToIso(form.ends_at),
    capacity: Number(form.capacity),
    coach_name: form.coach_name,
    notes: form.notes,
  }
}

function normalizeCapacityForActivity(
  activity: Activity | null | undefined,
  currentCapacity: string,
) {
  if (!activity) {
    return { capacity: currentCapacity, adjusted: false }
  }

  if (activity.slug === 'personalizado_1_1') {
    return { capacity: '1', adjusted: currentCapacity !== '1' }
  }

  if (!currentCapacity.trim() && activity.default_capacity) {
    return { capacity: String(activity.default_capacity), adjusted: true }
  }

  return { capacity: currentCapacity, adjusted: false }
}

export function AdminCalendarPage() {
  const today = useMemo(() => new Date(), [])
  const [activities, setActivities] = useState<Activity[]>([])
  const [sessions, setSessions] = useState<CalendarSession[]>([])
  const [fromDate, setFromDate] = useState(formatLocalDate(today))
  const [toDate, setToDate] = useState(
    addLocalDays(formatLocalDate(today), 6),
  )
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
  const [capacityNotice, setCapacityNotice] = useState<string | null>(null)
  const [activityDeleteTarget, setActivityDeleteTarget] =
    useState<Activity | null>(null)
  const [activityDeleteConfirmation, setActivityDeleteConfirmation] =
    useState('')
  const [sessionDeleteRequest, setSessionDeleteRequest] =
    useState<SessionDeleteRequest | null>(null)
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] =
    useState('')
  const [recurringEditScope, setRecurringEditScope] =
    useState<RecurringEditScope>('single')

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
  const selectedIsRecurring = Boolean(selectedSession?.recurring_rule_id)
  const selectedSessionHasReservations = Boolean(
    selectedSession && selectedSession.reserved_count > 0,
  )
  const isPersonalizedOneOnOne =
    selectedActivity?.slug === 'personalizado_1_1'
  const startParts = getDateTimeParts(form.starts_at)
  const endParts = getDateTimeParts(form.ends_at)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const range = calendarDateRange(fromDate, toDate)
      const [nextActivities, nextSessions] = await Promise.all([
        listActivities(true),
        listCalendarSessions(range.from, range.to),
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
    setRecurrence(buildRecurrenceForm(nextForm, Boolean(session.recurring_rule_id)))
    setCancelReason('')
    setCapacityNotice(null)
    setRecurringEditScope(session.recurring_rule_id ? 'series' : 'single')
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
    setCapacityNotice(null)
    setRecurringEditScope('single')
    setError(null)
    setSuccess(null)
  }

  function handleActivityChange(activityId: string) {
    const nextActivity =
      activities.find((activity) => activity.id === activityId) ?? null
    const normalized = normalizeCapacityForActivity(nextActivity, form.capacity)

    setForm({
      ...form,
      activity_id: activityId,
      capacity: normalized.capacity,
    })
    setCapacityNotice(
      normalized.adjusted &&
        nextActivity?.default_capacity &&
        nextActivity.slug !== 'personalizado_1_1'
        ? `Cupo sugerido para ${nextActivity.name}: ${nextActivity.default_capacity}. Podes cambiarlo para esta clase.`
        : null,
    )
    setError(null)
  }

  function updateStartDateTime(dateValue: string, timeValue: string) {
    const nextStartsAt = `${dateValue}T${timeValue}`
    const previousStart = new Date(form.starts_at)
    const previousEnd = new Date(form.ends_at)
    const durationMs = Math.max(
      previousEnd.getTime() - previousStart.getTime(),
      30 * 60 * 1000,
    )
    const nextEnd = new Date(new Date(nextStartsAt).getTime() + durationMs)

    setForm({
      ...form,
      starts_at: nextStartsAt,
      ends_at: formatDateTimeLocal(nextEnd),
    })
    setRecurrence({
      ...recurrence,
      date_from: dateValue,
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

    if (!form.activity_id) {
      setError('Selecciona un tipo de clase para la clase.')
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

      if (
        !Number.isInteger(weekday) ||
        weekday < 0 ||
        weekday > 6 ||
        !recurrence.date_from
      ) {
        setError('Completa un dia y fecha de inicio validos para repetir la clase.')
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
      const selectedActivityName = selectedActivity?.name ?? ''
      const inputWithTitle = {
        ...input,
        title: input.title || selectedActivityName,
      }
      if (selectedSession) {
        const updateInput = {
          ...inputWithTitle,
          session_id: selectedSession.session_id,
          active: form.active,
        } satisfies UpdateClassSessionInput

        if (selectedSession.recurring_rule_id && recurringEditScope === 'series') {
          await updateRecurringClassSession(updateInput)
          setSuccess(
            'Horario recurrente actualizado desde esta fecha. Las clases futuras ya no deberian volver al estado anterior.',
          )
        } else {
          await updateClassSession(updateInput)
          if (recurrence.enabled && !selectedSession.recurring_rule_id) {
            const recurringResult =
              await convertClassSessionToRecurringRule(selectedSession.session_id)
            setSuccess(
              recurringResult.action === 'restored'
                ? 'Clase restaurada correctamente.'
                : 'Clase actualizada y convertida en horario recurrente.',
            )
          } else {
            setSuccess('Clase actualizada.')
          }
        }
        resetForm()
      } else if (recurrence.enabled) {
        const recurringResult = await createClassRecurringRule({
          activity_id: normalizedForm.activity_id,
          title: normalizedForm.title.trim() || selectedActivityName,
          weekday: Number(recurrence.weekday),
          start_time: recurrence.start_time,
          end_time: recurrence.end_time,
          capacity,
          trainer_name: normalizedForm.coach_name,
          notes: normalizedForm.notes,
          valid_from: recurrence.date_from,
        })
        setSuccess(
          recurringResult.action === 'restored'
            ? 'Clase restaurada correctamente.'
            : 'Horario recurrente creado. Se repetira todas las semanas hasta que lo pauses o modifiques.',
        )
      } else {
        await createClassSession(inputWithTitle)
        setSuccess('Clase creada.')
      }
      await loadData()
    } catch (saveError) {
      const formattedError = formatAdminError(saveError)
      setError(
        selectedSession
          ? `No se pudo actualizar la clase. ${formattedError}`
          : formattedError,
      )
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

  async function handleDeleteSession(scope: DeleteClassSessionScope) {
    if (!selectedSession) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await deleteClassSession(selectedSession.session_id, scope)
      if (result.action === 'deleted_series') {
        setSuccess('Horario recurrente eliminado. Podras crear otro igual si lo necesitas.')
      } else if (result.action === 'cancelled') {
        setSuccess('Clase cancelada de forma segura. El historial se conservo.')
      } else {
        setSuccess(
          scope === 'single' && selectedSession.recurring_rule_id
            ? 'Fecha cancelada. El horario recurrente sigue activo en proximas semanas.'
            : scope === 'single'
              ? 'Clase eliminada.'
            : 'Horario recurrente eliminado.',
        )
      }
      setSessionDeleteRequest(null)
      setSessionDeleteConfirmation('')
      resetForm()
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  function requestDeleteSession(request: SessionDeleteRequest) {
    setSessionDeleteRequest(request)
    setSessionDeleteConfirmation('')
    setError(null)
    setSuccess(null)
  }

  async function confirmDeleteSession() {
    if (!sessionDeleteRequest || sessionDeleteConfirmation !== 'ELIMINAR') {
      return
    }

    await handleDeleteSession(sessionDeleteRequest.scope)
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

  function requestDeleteActivity(activity = selectedManagedActivity) {
    if (!activity) {
      return
    }

    setActivityDeleteTarget(activity)
    setActivityDeleteConfirmation('')
    setActivityForm(activityToForm(activity))
    setError(null)
    setSuccess(null)
  }

  async function confirmDeleteActivity() {
    if (!activityDeleteTarget || activityDeleteConfirmation !== 'ELIMINAR') {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await deleteActivity(activityDeleteTarget.id, activityDeleteConfirmation)
      setSuccess('Tipo de clase eliminado definitivamente.')
      setActivityForm(emptyActivityForm)
      setActivityDeleteTarget(null)
      setActivityDeleteConfirmation('')
      setShowActivityEditor(false)
      await loadData()
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden pb-24">
      <div className="min-w-0 max-w-full overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
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

        <div className="mt-5 min-w-0 max-w-full overflow-hidden">
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

      <div className="grid gap-5">
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
                Nueva clase
              </button>
            ) : null}
          </div>

          {selectedIsRecurring ? (
            <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Alcance de la edicion
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Esta clase viene de un horario recurrente. Elegi si queres
                  editar solo esta fecha o reemplazar el horario recurrente
                  desde esta fecha en adelante.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                    recurringEditScope === 'single'
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                      : 'border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-strong)]'
                  }`}
                  onClick={() => setRecurringEditScope('single')}
                  type="button"
                >
                  Editar solo esta clase
                </button>
                <button
                  className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                    recurringEditScope === 'series'
                      ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                      : 'border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-strong)]'
                  }`}
                  onClick={() => setRecurringEditScope('series')}
                  type="button"
                >
                  Editar horario recurrente
                </button>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {recurringEditScope === 'single'
                  ? 'Esta opcion crea una excepcion puntual para esta fecha y deja intacto el horario recurrente de las proximas semanas.'
                  : 'Esta opcion reemplaza el horario recurrente desde esta fecha y evita que la regla vieja vuelva a recrear clases anteriores.'}
              </p>
            </div>
          ) : null}

          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3 text-sm font-semibold text-[var(--ink)]">
            <input
              checked={recurrence.enabled}
              className="mt-1"
              disabled={selectedIsRecurring}
              onChange={(event) =>
                setRecurrence({
                  ...recurrence,
                  enabled: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>
              Clase recurrente
              <span className="block text-xs font-normal text-[var(--muted)]">
                {selectedIsRecurring
                  ? recurringEditScope === 'series'
                    ? 'Estas editando el horario recurrente desde esta fecha. Si queres tocar solo una fecha puntual, cambia el alcance arriba.'
                    : 'Estas editando solo esta fecha. La regla recurrente original seguira activa para las proximas semanas.'
                  : selectedSession
                    ? 'Si lo tildas, esta clase se convierte en un horario recurrente usando la fecha y hora actuales.'
                    : 'Si lo tildas, se repetira todas las semanas sin fecha de fin. Si no lo tildas, se crea solo esta clase.'}
              </span>
            </span>
          </label>

          <div className="mt-5 grid gap-3">
            <select
              aria-label="Actividad"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              disabled={!selectedSession && !hasActiveActivities}
              onChange={(event) => handleActivityChange(event.target.value)}
              value={form.activity_id}
            >
              <option value="">Seleccionar actividad</option>
              {classActivities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                  {activity.active ? '' : ' (inactiva)'}
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
                            ? `Cupo sugerido ${selectedActivity.default_capacity}`
                            : 'Sin cupo por defecto'}
                          {' · '}
                          {cutoffSummaryLabel(
                            selectedActivity.booking_cutoff_hours,
                            'reserva',
                          )}
                          {' · '}
                          {cutoffSummaryLabel(
                            selectedActivity.cancellation_cutoff_hours,
                            'cancelacion alumnos',
                          )}
                          {selectedActivity.flexible_schedule
                            ? ' · horario flexible'
                            : ''}
                          {' · '}
                          {selectedActivity.active ? 'tipo activo' : 'inactivo'}
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
              aria-label="Detalle opcional"
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Detalle opcional: grupo avanzado, reemplazo, observacion interna"
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
            {recurrence.enabled && !selectedSession ? (
              <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--page)] p-3">
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
                    <p className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                      Sin fecha de fin. Pausala cuando deje de estar vigente.
                    </p>
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
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-bold text-[var(--muted)]">
                Cupo
                <input
                  aria-label="Cupo"
                  className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-normal text-[var(--ink)]"
                  disabled={isPersonalizedOneOnOne}
                  max={isPersonalizedOneOnOne ? 1 : undefined}
                  min="1"
                  onChange={(event) => {
                    const nextCapacity = isPersonalizedOneOnOne
                      ? '1'
                      : event.target.value
                    setForm({ ...form, capacity: nextCapacity })
                    setCapacityNotice(null)
                  }}
                  placeholder="Cupo"
                  type="number"
                  value={isPersonalizedOneOnOne ? '1' : form.capacity}
                />
              </label>
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
            {capacityNotice ? (
              <p className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                {capacityNotice}
              </p>
            ) : null}
            {isPersonalizedOneOnOne ? (
              <p className="rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                Personalizado 1:1 permite maximo 1 alumno.
              </p>
            ) : null}
            {selectedSessionHasReservations ? (
              <p className="rounded-2xl border border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-3 text-xs font-semibold text-[var(--brand)]">
                Esta clase tiene reservas. El cambio de horario afectara a los
                alumnos reservados y el cupo no puede quedar por debajo de las
                reservas existentes.
              </p>
            ) : null}
            <textarea
              aria-label="Notas"
              className="min-h-24 rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notas internas"
              value={form.notes}
            />
            {selectedSession &&
            (!selectedIsRecurring || recurringEditScope === 'single') ? (
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
                  ? selectedIsRecurring
                    ? recurringEditScope === 'series'
                      ? 'Guardar horario recurrente'
                      : 'Guardar solo esta clase'
                    : recurrence.enabled && !selectedIsRecurring
                    ? 'Guardar y convertir en recurrente'
                    : 'Guardar clase'
                  : recurrence.enabled
                    ? 'Crear horario recurrente'
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
                {selectedIsRecurring
                  ? 'Elimina el horario recurrente completo o cancela solo esta fecha si queres conservar las proximas semanas.'
                  : 'Elimina esta clase. Si tiene historial, se conserva y se cancela de forma segura.'}
              </p>
              <div className="mt-3 grid gap-2">
                {selectedIsRecurring ? (
                  <>
                    <button
                      className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition disabled:opacity-60"
                      disabled={saving}
                      onClick={() =>
                        requestDeleteSession({
                          scope: 'series',
                          title: 'Eliminar horario recurrente completo',
                          description:
                            'Esta accion elimina este horario de todas las semanas futuras. Despues podras crear otro igual.',
                        })
                      }
                      type="button"
                    >
                      Eliminar horario recurrente completo
                    </button>
                    <p className="text-xs text-[var(--muted)]">
                      Elimina este horario de todas las semanas futuras. Despues
                      podras crear otro igual si lo necesitas.
                    </p>
                    <button
                      className="rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                      disabled={saving}
                      onClick={() =>
                        requestDeleteSession({
                          scope: 'single',
                          title: 'Cancelar solo esta fecha',
                          description:
                            'Esta accion solo cancela esta fecha. El horario recurrente seguira activo en proximas semanas.',
                        })
                      }
                      type="button"
                    >
                      Cancelar solo esta fecha
                    </button>
                    <p className="text-xs text-[var(--muted)]">
                      Solo oculta o cancela esta fecha. El horario recurrente
                      seguira activo en proximas semanas.
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition disabled:opacity-60"
                      disabled={saving}
                      onClick={() =>
                        requestDeleteSession({
                          scope: 'single',
                          title: 'Eliminar clase',
                          description:
                            'Esta accion borra la clase si no tiene historial. Si tiene reservas o asistencia, la cancela sin borrar esos datos.',
                        })
                      }
                      type="button"
                    >
                      Eliminar clase
                    </button>
                    <p className="text-xs text-[var(--muted)]">
                      Borra la clase si no tiene historial. Si tiene reservas o
                      asistencia, la cancela sin borrar esos datos.
                    </p>
                  </>
                )}
              </div>
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

      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
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
                    {activity.active ? 'Activa' : 'Inactiva'} ·{' '}
                    {cutoffSummaryLabel(activity.booking_cutoff_hours, 'Reserva')}
                    {' · '}
                    {cutoffSummaryLabel(
                      activity.cancellation_cutoff_hours,
                      'cancelacion alumnos',
                    )}
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
                  className="rounded-2xl border border-[var(--accent)] px-3 py-2 text-xs font-bold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                  disabled={saving}
                  onClick={() => {
                    requestDeleteActivity(activity)
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
            clases de este tipo. El color elegido se usa en las tarjetas del
            calendario.
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
                Cupo maximo de referencia
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Reservar hasta cuantas horas antes
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="0"
                  max="168"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      booking_cutoff_hours: event.target.value,
                    })
                  }
                  type="number"
                  value={activityForm.booking_cutoff_hours}
                />
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  0 significa hasta el inicio de la clase.
                </span>
              </label>
              <label className="text-sm font-semibold">
                Cancelar hasta cuantas horas antes
                <input
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                  min="0"
                  max="168"
                  onChange={(event) =>
                    setActivityForm({
                      ...activityForm,
                      cancellation_cutoff_hours: event.target.value,
                    })
                  }
                  type="number"
                  value={activityForm.cancellation_cutoff_hours}
                />
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  0 significa hasta el inicio de la clase.
                </span>
              </label>
            </div>
            {activityForm.max_capacity !== '1' ? (
              <p className="rounded-2xl bg-[var(--page)] p-3 text-xs font-semibold text-[var(--muted)]">
                El cupo maximo queda como referencia del tipo. Carolina puede
                cargar una clase puntual con mas cupo si lo necesita.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
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
      {activityDeleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[24px] bg-[var(--surface)] p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              Eliminacion definitiva
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Eliminar definitivamente {activityDeleteTarget.name}
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Esta accion eliminara definitivamente este tipo de clase y todos
              sus datos operativos relacionados: clases, horarios, reservas,
              asistencia y vinculos con planes. Los planes, alumnos y pagos no
              se eliminaran. No se podra deshacer.
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
                onClick={() => void confirmDeleteActivity()}
                type="button"
              >
                {saving ? 'Eliminando...' : 'Eliminar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sessionDeleteRequest ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[24px] bg-[var(--surface)] p-5 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              Confirmacion requerida
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              {sessionDeleteRequest.title}
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {sessionDeleteRequest.description} No se podra deshacer sin
              volver a crear la clase o el horario.
            </p>
            <label className="mt-4 block text-sm font-semibold">
              Escribi ELIMINAR para confirmar
              <input
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
                onChange={(event) =>
                  setSessionDeleteConfirmation(event.target.value)
                }
                value={sessionDeleteConfirmation}
              />
            </label>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold transition hover:bg-[var(--surface-strong)]"
                disabled={saving}
                onClick={() => {
                  setSessionDeleteRequest(null)
                  setSessionDeleteConfirmation('')
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                disabled={saving || sessionDeleteConfirmation !== 'ELIMINAR'}
                onClick={() => void confirmDeleteSession()}
                type="button"
              >
                {saving ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
