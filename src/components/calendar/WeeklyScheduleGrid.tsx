import { useEffect, useMemo, useRef } from 'react'

export type ScheduleSession = {
  session_id: string
  activity_id: string
  activity_name: string
  activity_slug: string
  title: string
  starts_at: string
  ends_at: string
  capacity: number
  trainer_name: string | null
  notes: string | null
  active: boolean
  cancelled_at: string | null
  reserved_count: number
  spots_left: number
  own_booking_id: string | null
  own_booking_status: 'booked' | 'cancelled' | 'attended' | 'no_show' | null
  can_book: boolean
  block_reason: string | null
  requires_24h_cancel: boolean
  plan_type: 'weekly' | 'package' | 'manual' | null
  weekly_class_limit: number | null
  weekly_classes_used: number | null
  weekly_classes_remaining: number | null
  package_classes_remaining: number | null
}

type WeeklyScheduleGridProps<TSession extends ScheduleSession> = {
  sessions: TSession[]
  fromDate: string
  toDate: string
  mode: 'admin' | 'student'
  selectedSessionId?: string | null
  savingSessionId?: string | null
  onSelectSession?: (session: TSession) => void
  onBookSession?: (session: TSession) => void
  onCancelBooking?: (session: TSession) => void
}

const activityTones = [
  'border-cyan-300 bg-cyan-50',
  'border-emerald-300 bg-emerald-50',
  'border-fuchsia-300 bg-fuchsia-50',
  'border-amber-300 bg-amber-50',
  'border-sky-300 bg-sky-50',
  'border-rose-300 bg-rose-50',
]

const activityToneBySlug: Record<string, string> = {
  cognitivo: 'border-red-300 bg-red-50',
  funcional: 'border-yellow-300 bg-yellow-50',
  neurofuncional: 'border-lime-300 bg-lime-50',
  ninos: 'border-violet-300 bg-violet-50',
  personalizado_1_1: 'border-fuchsia-300 bg-fuchsia-50',
  plan_personalizado_semipersonalizado: 'border-cyan-300 bg-cyan-50',
  plan_semipersonalizado: 'border-emerald-300 bg-emerald-50',
  plan_entrenamiento: 'border-slate-300 bg-slate-50',
  semi_personalizado: 'border-sky-300 bg-sky-50',
}

const canonicalTimeSlots = [
  { key: '07:00', label: '07:00' },
  { key: '08:00', label: '08:00' },
  { key: '09:00', label: '09:00' },
  { key: '10:00', label: '10:00' },
  { key: '14:00', label: '14:00' },
  { key: '15:00', label: '15:00' },
  { key: '16:00', label: '16:00' },
  { key: '17:00', label: '17:00' },
  { key: '18:00', label: '18:00' },
  { key: '19:00', label: '19:00' },
]

function minutesFromTimeKey(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDayKey(value: string) {
  return formatLocalDate(new Date(value))
}

function formatDayTitle(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(`${value}T00:00:00`))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function buildDays(fromDate: string, toDate: string) {
  const start = new Date(`${fromDate}T00:00:00`)
  const end = new Date(`${toDate}T00:00:00`)
  const days: string[] = []

  for (
    let cursor = start;
    cursor <= end && days.length < 21;
    cursor = addDays(cursor, 1)
  ) {
    const weekday = cursor.getDay()
    if (weekday >= 1 && weekday <= 5) {
      days.push(formatLocalDate(cursor))
    }
  }

  return days
}

function getTimeKey(value: string) {
  const date = new Date(value)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function toneForSession(session: ScheduleSession) {
  const knownTone = activityToneBySlug[session.activity_slug]
  if (knownTone) {
    return knownTone
  }

  const seed = session.activity_slug
    .split('')
    .reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
  return activityTones[seed % activityTones.length]
}

function getStatus(session: ScheduleSession, mode: 'admin' | 'student') {
  if (!session.active || session.cancelled_at) {
    return {
      label: 'Cancelada',
      className: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    }
  }

  if (mode === 'student' && session.own_booking_id) {
    return {
      label: 'Reservada',
      className: 'bg-[var(--brand)] text-white',
    }
  }

  if (session.spots_left <= 0) {
    return {
      label: 'Completa',
      className: 'bg-[var(--ink)] text-white',
    }
  }

  return {
    label: mode === 'admin' ? 'Activa' : 'Disponible',
    className: 'bg-[var(--brand-soft)] text-[var(--brand)]',
  }
}

function getCancelBlockReason(session: ScheduleSession) {
  const windowHours = session.requires_24h_cancel ? 24 : 12
  const cancelLimit =
    new Date(session.starts_at).getTime() - windowHours * 60 * 60 * 1000

  if (Date.now() > cancelLimit) {
    return session.requires_24h_cancel
      ? 'La cancelacion debe realizarse al menos 24h antes.'
      : 'La cancelacion debe realizarse al menos 12h antes.'
  }

  return null
}

function getPlanUsageLabel(session: ScheduleSession) {
  if (session.plan_type === 'weekly' && session.weekly_class_limit !== null) {
    const used = session.weekly_classes_used ?? 0
    const remaining =
      session.weekly_classes_remaining ??
      Math.max(session.weekly_class_limit - used, 0)

    return `${remaining}/${session.weekly_class_limit} esta semana`
  }

  if (
    session.plan_type === 'package' &&
    session.package_classes_remaining !== null
  ) {
    return `${session.package_classes_remaining} clases del paquete`
  }

  return null
}

export function WeeklyScheduleGrid<TSession extends ScheduleSession>({
  sessions,
  fromDate,
  toDate,
  mode,
  selectedSessionId,
  savingSessionId,
  onSelectSession,
  onBookSession,
  onCancelBooking,
}: WeeklyScheduleGridProps<TSession>) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const days = buildDays(fromDate, toDate)
  const timeSlots = useMemo(() => {
    const slotMap = new Map(canonicalTimeSlots.map((slot) => [slot.key, slot]))

    sessions.forEach((session) => {
      const timeKey = getTimeKey(session.starts_at)
      if (!slotMap.has(timeKey)) {
        slotMap.set(timeKey, { key: timeKey, label: timeKey })
      }
    })

    return Array.from(slotMap.values()).sort(
      (a, b) => minutesFromTimeKey(a.key) - minutesFromTimeKey(b.key),
    )
  }, [sessions])
  const sessionsByCell = useMemo(() => {
    const map = new Map<string, TSession[]>()

    sessions.forEach((session) => {
      const dayKey = getDayKey(session.starts_at)
      const timeKey = getTimeKey(session.starts_at)
      const cellKey = `${dayKey}|${timeKey}`
      const nextSessions = map.get(cellKey) ?? []
      nextSessions.push(session)
      nextSessions.sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      )
      map.set(cellKey, nextSessions)
    })

    return map
  }, [sessions])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: 0, top: 0 })
    }
  }, [fromDate, toDate])

  if (days.length === 0 || sessions.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
        No hay clases cargadas para este rango.
      </div>
    )
  }

  return (
    <div
      className="max-h-[72vh] overflow-auto overscroll-contain rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-1 pb-2 shadow-inner sm:max-h-[760px]"
      ref={scrollRef}
    >
      <div
        className="grid min-w-[720px] gap-1.5 sm:min-w-[920px] sm:gap-2"
        style={{
          gridTemplateColumns: `76px repeat(${days.length}, minmax(132px, 1fr))`,
        }}
      >
        <div className="sticky left-0 top-0 z-40 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] shadow-md sm:px-3 sm:py-3 sm:text-xs sm:tracking-[0.18em]">
          Horario
        </div>
        {days.map((day) => (
          <div
            className="sticky top-0 z-30 rounded-2xl border border-[var(--line)] bg-[var(--brand)] px-2 py-2 text-center font-display text-xs font-bold capitalize text-white shadow-md sm:px-3 sm:py-3 sm:text-sm"
            key={day}
          >
            {formatDayTitle(day)}
          </div>
        ))}
        <div className="sticky left-0 top-[38px] z-30 rounded-xl border border-[var(--line)] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] shadow-sm sm:top-[48px]">
          Desplazá
        </div>
        <div
          className="sticky top-[38px] z-20 col-span-5 rounded-xl border border-[var(--line)] bg-white px-3 py-1 text-center text-[11px] font-semibold text-[var(--muted)] shadow-sm sm:top-[48px] sm:text-xs"
          style={{ gridColumn: `span ${days.length}` }}
        >
          Deslizá horizontalmente para ver todos los días
        </div>

        {timeSlots.map((timeSlot) => (
          <div className="contents" key={timeSlot.key}>
            <div className="sticky left-0 z-20 flex min-h-[96px] items-start rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-3 text-xs font-bold text-[var(--ink)] shadow-md sm:min-h-[118px] sm:px-3 sm:py-4 sm:text-sm">
              {timeSlot.label}
            </div>
            {days.map((day) => {
              const daySessions =
                sessionsByCell.get(`${day}|${timeSlot.key}`) ?? []

              return (
                <div
                  className="min-h-[96px] overflow-hidden rounded-2xl border border-[var(--line)] bg-white/70 p-1.5 sm:min-h-[118px] sm:p-2"
                  key={`${day}-${timeSlot.key}`}
                >
                  {daySessions.length === 0 ? (
                    <div className="h-full rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)]" />
                  ) : (
                    <div className="grid gap-2">
                      {daySessions.length > 1 ? (
                        <p className="rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-bold text-[var(--accent)]">
                          Revisar duplicado
                        </p>
                      ) : null}
                      {daySessions.map((session) => {
                        const status = getStatus(session, mode)
                        const selected = selectedSessionId === session.session_id
                        const busy = savingSessionId === session.session_id
                        const cancelBlockReason = getCancelBlockReason(session)
                        const planUsageLabel =
                          mode === 'student' ? getPlanUsageLabel(session) : null
                        return (
                          <article
                            className={`rounded-2xl border p-2 text-left shadow-sm transition sm:p-3 ${toneForSession(session)} ${
                              selected
                                ? 'ring-2 ring-[var(--brand)]'
                                : 'ring-0'
                            }`}
                            key={session.session_id}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--ink)]/70 sm:text-[11px] sm:tracking-[0.12em]">
                                  {formatTime(session.starts_at)} -{' '}
                                  {formatTime(session.ends_at)}
                                </p>
                                <h4 className="mt-1 break-words text-xs font-bold leading-tight text-[var(--ink)] sm:text-sm">
                                  {session.title}
                                </h4>
                                <p className="mt-1 break-words text-[11px] font-semibold text-[var(--ink)]/75 sm:text-xs">
                                  {session.activity_name}
                                </p>
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold sm:px-2.5 sm:py-1 sm:text-[11px] ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-bold text-[var(--ink)] sm:mt-3 sm:gap-1.5 sm:text-[11px]">
                              <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {session.spots_left}/{session.capacity} cupos
                              </span>
                              <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {session.requires_24h_cancel ? '24h' : '12h'}
                              </span>
                              {session.trainer_name ? (
                                <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                  {session.trainer_name}
                                </span>
                              ) : null}
                              {planUsageLabel ? (
                                <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                  {planUsageLabel}
                                </span>
                              ) : null}
                            </div>

                            {session.block_reason && mode === 'student' ? (
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                {session.block_reason}
                              </p>
                            ) : null}

                            {mode === 'admin' ? (
                              <button
                                className="mt-2 w-full rounded-xl bg-white/90 px-3 py-2 text-xs font-bold text-[var(--ink)] transition hover:bg-white sm:mt-3"
                                onClick={() => onSelectSession?.(session)}
                                type="button"
                              >
                                Editar
                              </button>
                            ) : (
                              <div className="mt-3 grid gap-2">
                                {session.own_booking_id ? (
                                  <>
                                    <button
                                      className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                                      disabled={busy || Boolean(cancelBlockReason)}
                                      onClick={() => onCancelBooking?.(session)}
                                      type="button"
                                    >
                                      {busy ? 'Cancelando...' : 'Cancelar reserva'}
                                    </button>
                                    {cancelBlockReason ? (
                                      <p className="text-xs text-[var(--muted)]">
                                        {cancelBlockReason}
                                      </p>
                                    ) : null}
                                  </>
                                ) : (
                                  <button
                                    className="rounded-xl bg-[var(--brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                                    disabled={busy || !session.can_book}
                                    onClick={() => onBookSession?.(session)}
                                    type="button"
                                  >
                                    {busy ? 'Reservando...' : 'Reservar'}
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
