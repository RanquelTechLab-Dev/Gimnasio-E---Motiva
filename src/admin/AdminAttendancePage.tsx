import { useEffect, useMemo, useState } from 'react'
import {
  autoFinalizeAttendance,
  formatAdminError,
  listAttendanceSessions,
  markAttendance,
} from './api'
import type { AttendanceSessionRow, AttendanceStatus } from './types'

type AttendanceGroup = {
  session: AttendanceSessionRow
  rows: AttendanceSessionRow[]
}

const attendanceLabels: Record<AttendanceStatus, string> = {
  present: 'Asistio',
  absent: 'Ausente',
  justified: 'Justificado',
}

const bookingLabels: Record<AttendanceSessionRow['booking_status'], string> = {
  booked: 'Reservada',
  cancelled: 'Cancelada',
  attended: 'Asistida',
  no_show: 'Ausente',
}

const correctionLabels: Record<AttendanceStatus, string> = {
  present: 'Corregir a asistio',
  absent: 'Corregir a ausente',
  justified: 'Corregir a justificado',
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validateDateRange(fromDate: string, toDate: string) {
  if (toDate < fromDate) {
    throw new Error('La fecha hasta no puede ser anterior a la fecha desde.')
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function studentName(row: AttendanceSessionRow) {
  return `${row.student_first_name} ${row.student_last_name}`.trim()
}

function groupRows(rows: AttendanceSessionRow[]) {
  const groups = new Map<string, AttendanceGroup>()

  for (const row of rows) {
    const existing = groups.get(row.session_id)
    if (existing) {
      existing.rows.push(row)
    } else {
      groups.set(row.session_id, { session: row, rows: [row] })
    }
  }

  return Array.from(groups.values())
}

export function AdminAttendancePage() {
  const today = useMemo(() => formatLocalDate(new Date()), [])
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [rows, setRows] = useState<AttendanceSessionRow[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingBookingId, setSavingBookingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const groups = useMemo(() => groupRows(rows), [rows])

  async function loadData() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      validateDateRange(fromDate, toDate)
      const finalizeResult = await autoFinalizeAttendance(fromDate, toDate)
      const nextRows = await listAttendanceSessions(fromDate, toDate)
      setRows(nextRows)
      setNotes((current) => {
        const nextNotes = { ...current }
        for (const row of nextRows) {
          if (nextNotes[row.booking_id] === undefined) {
            nextNotes[row.booking_id] = row.attendance_notes ?? ''
          }
        }
        return nextNotes
      })
      if (finalizeResult.finalized_count > 0) {
        setSuccess(
          `Asistencias automaticas generadas: ${finalizeResult.finalized_count}.`,
        )
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

  async function handleMark(row: AttendanceSessionRow, status: AttendanceStatus) {
    setSavingBookingId(row.booking_id)
    setError(null)
    setSuccess(null)
    try {
      await markAttendance(row.booking_id, status, notes[row.booking_id] ?? '')
      setSuccess(`Asistencia registrada: ${attendanceLabels[status]}.`)
      await loadData()
    } catch (markError) {
      setError(formatAdminError(markError))
    } finally {
      setSavingBookingId(null)
    }
  }

  return (
    <section className="grid gap-5">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Asistencia
            </p>
            <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Clases y alumnos reservados
            </h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              La asistencia se genera automaticamente para reservas no
              canceladas cuando la clase finaliza. Este panel solo revisa y
              corrige casos puntuales; las clases disponibles no se ajustan
              desde aca.
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
          <p className="mt-5 text-sm text-[var(--muted)]">Cargando asistencia...</p>
        ) : groups.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            No hay reservas para el rango seleccionado.
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {groups.map(({ session, rows: sessionRows }) => (
              <article
                className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
                key={session.session_id}
              >
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">
                      {session.title}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {session.activity_name} · {formatDateTime(session.starts_at)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Cupo {sessionRows.length}/{session.capacity}
                      {session.requires_24h_cancel ? ' · regla 24h' : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {session.session_cancelled_at
                      ? 'Clase cancelada'
                      : session.session_active
                        ? 'Activa'
                        : 'Inactiva'}
                  </p>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-sm">
                    <thead className="text-xs uppercase text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Alumno</th>
                        <th className="px-3 py-2">Reserva</th>
                        <th className="px-3 py-2">Asistencia</th>
                        <th className="px-3 py-2">Notas</th>
                        <th className="px-3 py-2">Correccion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionRows.map((row) => (
                        <tr className="bg-white" key={row.booking_id}>
                          <td className="rounded-l-2xl px-3 py-3">
                            <p className="font-semibold text-[var(--ink)]">
                              {studentName(row)}
                            </p>
                            <p className="text-xs text-[var(--muted)]">
                              {row.student_email}
                              {row.student_phone ? ` · ${row.student_phone}` : ''}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            {bookingLabels[row.booking_status]}
                            {row.booking_charged_as_attended ? (
                              <p className="text-xs text-[var(--accent)]">
                                Cobrada como asistida
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            {row.attendance_status ? (
                              <>
                                <p className="font-semibold text-[var(--ink)]">
                                  {attendanceLabels[row.attendance_status]}
                                </p>
                                <p className="text-xs text-[var(--muted)]">
                                  {row.attendance_recorded_at
                                    ? formatDateTime(row.attendance_recorded_at)
                                    : ''}
                                </p>
                              </>
                            ) : (
                              <span className="text-[var(--muted)]">
                                Sin marcar
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <input
                              aria-label={`Notas de ${studentName(row)}`}
                              className="w-full rounded-2xl border border-[var(--line)] px-3 py-2 text-sm"
                              onChange={(event) =>
                                setNotes({
                                  ...notes,
                                  [row.booking_id]: event.target.value,
                                })
                              }
                              placeholder="Nota opcional"
                              value={notes[row.booking_id] ?? ''}
                            />
                          </td>
                          <td className="rounded-r-2xl px-3 py-3">
                            {row.attendance_status ? (
                              <div className="flex flex-wrap gap-2">
                                {(['present', 'absent', 'justified'] as const).map(
                                  (status) => (
                                    <button
                                      className="rounded-2xl border border-[var(--line)] px-3 py-2 text-xs font-bold transition hover:bg-[var(--brand-soft)] disabled:opacity-60"
                                      disabled={savingBookingId === row.booking_id}
                                      key={status}
                                      onClick={() => void handleMark(row, status)}
                                      type="button"
                                    >
                                      {correctionLabels[status]}
                                    </button>
                                  ),
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">
                                Se autogenera al finalizar la clase si no cancela.
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
      </div>
    </section>
  )
}
