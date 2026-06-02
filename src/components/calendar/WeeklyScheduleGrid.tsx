import { useEffect, useMemo, useRef } from 'react'

export type ScheduleSession = {
  session_id: string
  recurring_rule_id?: string | null
  activity_id: string
  activity_name: string
  activity_slug: string
  activity_color_hex?: string | null
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

function normalizeHexColor(value: string | null | undefined) {
  const color = value?.trim()
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = normalizeHexColor(hex)
  if (!normalized) {
    return undefined
  }

  const value = normalized.slice(1)
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function colorStyleForSession(session: ScheduleSession) {
  const color = normalizeHexColor(session.activity_color_hex)
  if (!color) {
    return undefined
  }

  return {
    borderColor: color,
    backgroundColor: hexToRgba(color, 0.16),
  }
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
  const cancelLimit = new Date(session.starts_at).getTime() - 3 * 60 * 60 * 1000

  if (Date.now() > cancelLimit) {
    return 'Ya no podés cancelar esta reserva desde la app porque faltan menos de 3 horas para la clase. Si reservaste por error, escribile a Carolina para que la cancele manualmente.'
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
    return `${session.package_classes_remaining} clases disponibles`
  }

  return null
}

function getCapacityLabel(
  session: ScheduleSession,
  mode: 'admin' | 'student',
) {
  if (mode === 'admin') {
    return `${session.reserved_count}/${session.capacity} reservados`
  }

  return session.spots_left === 1
    ? '1 lugar disponible'
    : `${session.spots_left} lugares disponibles`
}

function getSessionDetail(session: ScheduleSession) {
  const title = session.title.trim()
  return title && title !== session.activity_name ? title : null
}

function hasDuplicateActivity(sessions: ScheduleSession[]) {
  const activityCounts = new Map<string, number>()
  sessions.forEach((session) => {
    activityCounts.set(
      session.activity_id,
      (activityCounts.get(session.activity_id) ?? 0) + 1,
    )
  })

  return Array.from(activityCounts.values()).some((count) => count > 1)
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
  const visibleDays = useMemo(() => new Set(days), [days])
  const renderSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          visibleDays.has(getDayKey(session.starts_at)) &&
          (mode === 'admin' || (session.active && !session.cancelled_at)),
      ),
    [mode, sessions, visibleDays],
  )
  const slotSessions = useMemo(
    () =>
      renderSessions.filter(
        (session) =>
          mode === 'admin' || (session.active && !session.cancelled_at),
      ),
    [mode, renderSessions],
  )
  const todayKey = formatLocalDate(new Date())
  const rangeStartKey = fromDate
  const timeSlots = useMemo(() => {
    const slotMap = new Map(canonicalTimeSlots.map((slot) => [slot.key, slot]))

    slotSessions.forEach((session) => {
      const timeKey = getTimeKey(session.starts_at)
      if (!slotMap.has(timeKey)) {
        slotMap.set(timeKey, { key: timeKey, label: timeKey })
      }
    })

    return Array.from(slotMap.values()).sort(
      (a, b) => minutesFromTimeKey(a.key) - minutesFromTimeKey(b.key),
    )
  }, [slotSessions])
  const sessionsByCell = useMemo(() => {
    const map = new Map<string, TSession[]>()

    renderSessions.forEach((session) => {
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
  }, [renderSessions])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: 0, top: 0 })
    }
  }, [fromDate, toDate])

  if (days.length === 0 || renderSessions.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
        No hay clases cargadas para este rango.
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--surface)] shadow-inner">
      <div
        className="w-full max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain p-1 pb-2 md:max-h-[760px] md:overflow-auto md:overscroll-contain"
        ref={scrollRef}
      >
      <div
        className="grid w-max min-w-[760px] gap-2 md:min-w-[920px]"
        style={{
          gridTemplateColumns: `72px repeat(${days.length}, minmax(128px, 1fr))`,
        }}
      >
        <div className="z-10 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] shadow-sm md:sticky md:left-0 md:top-0 md:z-40 md:shadow-md md:px-3 md:py-3 md:text-xs md:tracking-[0.18em]">
          Horario
        </div>
        {days.map((day) => {
          const isToday = day === todayKey
          const isRangeStart = day === rangeStartKey
          const headerTone = isToday
            ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
            : isRangeStart
              ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
              : 'border-[var(--line)] bg-[var(--brand)] text-white'

          return (
            <div
              className={`z-10 rounded-2xl border px-2 py-2 text-center font-display text-xs font-bold capitalize shadow-sm md:sticky md:top-0 md:z-30 md:shadow-md md:px-3 md:py-3 md:text-sm ${headerTone}`}
              key={day}
            >
              {formatDayTitle(day)}
              {isToday ? (
                <span className="mt-1 block text-[10px] uppercase tracking-[0.14em]">
                  Hoy
                </span>
              ) : null}
            </div>
          )
        })}
        <div className="z-10 rounded-xl border border-[var(--line)] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] shadow-sm md:sticky md:left-0 md:top-[48px] md:z-30">
          Desplazá
        </div>
        <div
          className="z-10 rounded-xl border border-[var(--line)] bg-white px-3 py-1 text-center text-[11px] font-semibold text-[var(--muted)] shadow-sm md:sticky md:top-[48px] md:z-20 md:text-xs"
          style={{ gridColumn: `span ${days.length}` }}
        >
          Deslizá horizontalmente para ver todos los días
        </div>

        {timeSlots.map((timeSlot) => (
          <div className="contents" key={timeSlot.key}>
            <div className="z-10 flex min-h-[56px] items-start rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-3 text-xs font-bold text-[var(--ink)] shadow-sm md:sticky md:left-0 md:z-20 md:min-h-[64px] md:px-3 md:py-4 md:text-sm md:shadow-md">
              {timeSlot.label}
            </div>
            {days.map((day) => {
              const daySessions =
                sessionsByCell.get(`${day}|${timeSlot.key}`) ?? []
              const isToday = day === todayKey
              const isRangeStart = day === rangeStartKey
              const cellTone = isToday
                ? 'border-[var(--brand)] bg-[var(--brand-soft)]/70'
                : isRangeStart
                  ? 'border-[var(--brand)]/50 bg-[var(--surface-strong)]'
                  : 'border-[var(--line)] bg-white/70'

              return (
                <div
                  className={`min-w-0 overflow-hidden rounded-2xl border p-2 ${
                    daySessions.length > 0
                      ? 'min-h-[84px] md:min-h-[92px]'
                      : 'min-h-[56px] md:min-h-[64px]'
                  } ${cellTone}`}
                  key={`${day}-${timeSlot.key}`}
                >
                  {daySessions.length === 0 ? (
                    <div className="min-h-10 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)]" />
                  ) : (
                    <div className="grid gap-2">
                      {hasDuplicateActivity(daySessions) ? (
                        <p className="rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[10px] font-bold text-[var(--accent)]">
                          Hay otra clase igual en este horario
                        </p>
                      ) : null}
                      {daySessions.map((session) => {
                        const status = getStatus(session, mode)
                        const selected = selectedSessionId === session.session_id
                        const busy = savingSessionId === session.session_id
                        const cancelBlockReason = getCancelBlockReason(session)
                        const sessionDetail = getSessionDetail(session)
                        const sessionColorStyle = colorStyleForSession(session)
                        const planUsageLabel =
                          mode === 'student' ? getPlanUsageLabel(session) : null
                        return (
                          <article
                            className={`min-w-0 overflow-hidden rounded-2xl border p-2 text-left shadow-sm transition md:p-3 ${
                              sessionColorStyle ? '' : toneForSession(session)
                            } ${
                              selected
                                ? 'ring-2 ring-[var(--brand)]'
                                : 'ring-0'
                            }`}
                            key={session.session_id}
                            style={sessionColorStyle}
                          >
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--ink)]/70 sm:text-[11px] sm:tracking-[0.12em]">
                                  {formatTime(session.starts_at)} -{' '}
                                  {formatTime(session.ends_at)}
                                </p>
                                <h4 className="mt-1 break-words text-xs font-bold leading-tight text-[var(--ink)] sm:text-sm">
                                  {session.activity_name}
                                </h4>
                                {sessionDetail ? (
                                  <p className="mt-1 break-words text-[11px] font-semibold text-[var(--ink)]/75 sm:text-xs">
                                    {sessionDetail}
                                  </p>
                                ) : null}
                              </div>
                              <span
                                className={`w-fit max-w-full shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold sm:px-2.5 sm:py-1 sm:text-[11px] ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-bold text-[var(--ink)] sm:mt-3 sm:gap-1.5 sm:text-[11px]">
                              <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                {getCapacityLabel(session, mode)}
                              </span>
                              <span className="rounded-full bg-white/80 px-2 py-0.5 sm:px-2.5 sm:py-1">
                                Cancela hasta 3h antes
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
                                className="mt-3 w-full rounded-xl bg-white/90 px-3 py-2 text-center text-xs font-bold text-[var(--ink)] transition hover:bg-white"
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
                                      className="w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-center text-xs font-bold text-white disabled:opacity-60"
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
                                    className="w-full rounded-xl bg-[var(--brand)] px-3 py-2 text-center text-xs font-bold text-white disabled:opacity-60"
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
    </div>
  )
}
