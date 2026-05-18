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
    days.push(formatLocalDate(cursor))
  }

  return days
}

function getTimeKey(value: string) {
  return formatTime(value)
}

function toneForSession(session: ScheduleSession) {
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
  const days = buildDays(fromDate, toDate)
  const timeSlots = Array.from(
    new Set(sessions.map((session) => getTimeKey(session.starts_at))),
  ).sort()

  if (timeSlots.length === 0) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
        No hay clases cargadas para este rango.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid min-w-[920px] gap-2"
        style={{
          gridTemplateColumns: `90px repeat(${days.length}, minmax(170px, 1fr))`,
        }}
      >
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-3 text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
          Horario
        </div>
        {days.map((day) => (
          <div
            className="rounded-2xl border border-[var(--line)] bg-[var(--brand)] px-3 py-3 text-center font-display text-sm font-bold capitalize text-white"
            key={day}
          >
            {formatDayTitle(day)}
          </div>
        ))}

        {timeSlots.map((timeSlot) => (
          <div className="contents" key={timeSlot}>
            <div className="flex min-h-[118px] items-start rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-4 text-sm font-bold text-[var(--ink)]">
              {timeSlot}
            </div>
            {days.map((day) => {
              const daySessions = sessions.filter(
                (session) =>
                  getDayKey(session.starts_at) === day &&
                  getTimeKey(session.starts_at) === timeSlot,
              )

              return (
                <div
                  className="min-h-[118px] rounded-2xl border border-[var(--line)] bg-white/70 p-2"
                  key={`${day}-${timeSlot}`}
                >
                  {daySessions.length === 0 ? (
                    <div className="h-full rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)]" />
                  ) : (
                    <div className="grid gap-2">
                      {daySessions.map((session) => {
                        const status = getStatus(session, mode)
                        const selected = selectedSessionId === session.session_id
                        const busy = savingSessionId === session.session_id
                        const cancelBlockReason = getCancelBlockReason(session)
                        return (
                          <article
                            className={`rounded-2xl border p-3 text-left shadow-sm transition ${toneForSession(session)} ${
                              selected
                                ? 'ring-2 ring-[var(--brand)]'
                                : 'ring-0'
                            }`}
                            key={session.session_id}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink)]/70">
                                  {formatTime(session.starts_at)} -{' '}
                                  {formatTime(session.ends_at)}
                                </p>
                                <h4 className="mt-1 text-sm font-bold leading-tight text-[var(--ink)]">
                                  {session.title}
                                </h4>
                                <p className="mt-1 text-xs font-semibold text-[var(--ink)]/75">
                                  {session.activity_name}
                                </p>
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${status.className}`}
                              >
                                {status.label}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold text-[var(--ink)]">
                              <span className="rounded-full bg-white/80 px-2.5 py-1">
                                {session.spots_left}/{session.capacity} cupos
                              </span>
                              <span className="rounded-full bg-white/80 px-2.5 py-1">
                                {session.requires_24h_cancel ? '24h' : '12h'}
                              </span>
                              {session.trainer_name ? (
                                <span className="rounded-full bg-white/80 px-2.5 py-1">
                                  {session.trainer_name}
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
                                className="mt-3 w-full rounded-xl bg-white/90 px-3 py-2 text-xs font-bold text-[var(--ink)] transition hover:bg-white"
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
