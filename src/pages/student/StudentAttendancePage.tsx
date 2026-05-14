import { useEffect, useState } from 'react'
import { formatAppError, listMyAttendance } from '../../app/api'
import { formatDateTime } from '../../app/format'
import type { StudentAttendance } from '../../app/types'

const statusLabels: Record<StudentAttendance['status'], string> = {
  absent: 'Ausente',
  justified: 'Justificado',
  present: 'Asistio',
}

export function StudentAttendancePage() {
  const [attendance, setAttendance] = useState<StudentAttendance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadAttendance() {
      setLoading(true)
      setError(null)
      try {
        const nextAttendance = await listMyAttendance()
        if (active) {
          setAttendance(nextAttendance)
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

    void loadAttendance()

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
        Mi asistencia
      </p>
      <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
        Historial de clases
      </h3>
      {loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Cargando asistencia...</p>
      ) : error ? (
        <p className="mt-5 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
          {error}
        </p>
      ) : attendance.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          Todavia no hay asistencia registrada.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {attendance.map((item) => (
            <article
              className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              key={item.attendance_id}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-bold text-[var(--ink)]">{item.title}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {item.activity_name} · {formatDateTime(item.recorded_at)}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-bold text-[var(--brand)]">
                  {statusLabels[item.status]}
                </span>
              </div>
              {item.notes ? (
                <p className="mt-3 text-sm text-[var(--muted)]">{item.notes}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
