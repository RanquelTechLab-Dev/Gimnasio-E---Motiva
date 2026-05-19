import { useEffect, useState } from 'react'
import { formatAppError, listMyPayments } from '../../app/api'
import { formatCurrency, formatDateTime } from '../../app/format'
import type { StudentPayment } from '../../app/types'

const statusLabels: Record<StudentPayment['status'], string> = {
  approved: 'Aprobado',
  pending: 'Pendiente',
  rejected: 'Rechazado',
  voided: 'Anulado',
}

const methodLabels: Record<StudentPayment['method'], string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
}

export function StudentPaymentsPage() {
  const [payments, setPayments] = useState<StudentPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadPayments() {
      setLoading(true)
      setError(null)
      try {
        const nextPayments = await listMyPayments()
        if (active) {
          setPayments(nextPayments)
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

    void loadPayments()

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
        Mis pagos
      </p>
      <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
        Pagos registrados
      </h3>
      {loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Cargando pagos...</p>
      ) : error ? (
        <p className="mt-5 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
          {error}
        </p>
      ) : payments.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          No hay pagos registrados.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {payments.map((payment) => (
            <article
              className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              key={payment.payment_id}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xl font-bold text-[var(--ink)]">
                    {formatCurrency(Number(payment.amount))}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {methodLabels[payment.method]} · {formatDateTime(payment.paid_at)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {payment.plan_name ?? 'Sin plan asociado'}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-bold text-[var(--brand)]">
                  {statusLabels[payment.status]}
                </span>
              </div>
              {payment.notes ? (
                <p className="mt-3 text-sm text-[var(--muted)]">{payment.notes}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
