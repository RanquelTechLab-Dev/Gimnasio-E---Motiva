import { useEffect, useState } from 'react'
import { cancelBooking, formatAppError, listMyBookings } from './api'
import type { MyBooking } from './types'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

const statusLabels: Record<MyBooking['booking_status'], string> = {
  booked: 'Reservada',
  cancelled: 'Cancelada',
  attended: 'Asistida',
  no_show: 'Ausente',
}

export function MyBookingsPage() {
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const nextBookings = await listMyBookings()
      setBookings(nextBookings)
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
  }, [])

  async function handleCancel(booking: MyBooking) {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await cancelBooking(booking.booking_id, cancelReason[booking.booking_id] ?? '')
      setSuccess('Reserva cancelada.')
      await loadData()
    } catch (cancelError) {
      setError(formatAppError(cancelError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Reservas
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
            Mis reservas
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Cada actividad define hasta cuando podes cancelar. Si ya paso el
            limite, escribile a Carolina para que la cancele manualmente.
          </p>
        </div>
        <button
          className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
          onClick={() => void loadData()}
          type="button"
        >
          Actualizar
        </button>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Cargando reservas...</p>
      ) : bookings.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          Todavia no tenes reservas.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {bookings.map((booking) => (
            <article
              className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              key={booking.booking_id}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold text-[var(--ink)]">
                    {booking.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {booking.activity_name} · {formatDateTime(booking.starts_at)}
                  </p>
                  {booking.credits_charged > 0 ||
                  booking.credit_returned_at ||
                  booking.charged_as_attended ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {booking.credits_charged > 0
                        ? `Clases descontadas: ${booking.credits_charged}`
                        : 'Reserva semanal'}
                      {booking.credit_returned_at ? ' · clase devuelta' : ''}
                      {booking.charged_as_attended
                        ? ' · cobrada como asistida'
                        : ''}
                    </p>
                  ) : null}
                </div>
                <p className="text-sm font-semibold text-[var(--ink)]">
                  {statusLabels[booking.booking_status]}
                </p>
              </div>

              {booking.booking_status === 'booked' ? (
                <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto]">
                  <input
                    className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-sm"
                    onChange={(event) =>
                      setCancelReason({
                        ...cancelReason,
                        [booking.booking_id]: event.target.value,
                      })
                    }
                    placeholder="Motivo opcional"
                    value={cancelReason[booking.booking_id] ?? ''}
                  />
                  <button
                    className="rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                    disabled={saving || !booking.can_cancel}
                    onClick={() => void handleCancel(booking)}
                    type="button"
                  >
                    Cancelar
                  </button>
                  {!booking.can_cancel && booking.cancel_block_reason ? (
                    <p className="text-sm text-[var(--muted)] lg:col-span-2">
                      {booking.cancel_block_reason}
                    </p>
                  ) : null}
                </div>
              ) : null}
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
