import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { formatAdminError, sendMassEmail } from '../../admin/api'
import type { MassEmailResult } from '../../admin/types'

type EmailFormState = {
  subject: string
  body: string
}

const initialForm: EmailFormState = {
  subject: '',
  body: '',
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'Sin fecha'
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AdminEmailsPage() {
  const [form, setForm] = useState<EmailFormState>(initialForm)
  const [preview, setPreview] = useState<MassEmailResult | null>(null)
  const [result, setResult] = useState<MassEmailResult | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSend = useMemo(
    () =>
      Boolean(
        preview &&
          preview.eligible_count > 0 &&
          form.subject.trim() &&
          form.body.trim(),
      ),
    [form.body, form.subject, preview],
  )

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!form.subject.trim() || !form.body.trim()) {
      setError('Completa asunto y mensaje antes de buscar destinatarios.')
      return
    }

    setLoadingPreview(true)
    setError(null)
    setSuccess(null)
    setResult(null)

    try {
      const nextPreview = await sendMassEmail({
        subject: form.subject.trim(),
        body: form.body.trim(),
        audience: 'recent_payers_6_months',
        dryRun: true,
      })
      setPreview(nextPreview)
      setSuccess(
        nextPreview.eligible_count === 0
          ? 'No hay destinatarios elegibles para esta audiencia.'
          : `Vista previa lista: ${nextPreview.eligible_count} destinatarios elegibles.`,
      )
    } catch (previewError) {
      setError(formatAdminError(previewError))
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleSend() {
    if (!canSend) {
      setError('Primero genera una vista previa con destinatarios elegibles.')
      return
    }

    const confirmed = window.confirm(
      `Vas a enviar este email a ${preview?.eligible_count ?? 0} destinatarios. Esta accion usa Mailjet y queda registrada. Continuar?`,
    )

    if (!confirmed) {
      return
    }

    setSending(true)
    setError(null)
    setSuccess(null)

    try {
      const nextResult = await sendMassEmail({
        subject: form.subject.trim(),
        body: form.body.trim(),
        audience: 'recent_payers_6_months',
        dryRun: false,
      })
      setResult(nextResult)
      setSuccess(
        `Envio finalizado: ${nextResult.sent_count} enviados, ${nextResult.failed_count} fallidos.`,
      )
    } catch (sendError) {
      setError(formatAdminError(sendError))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
            Emails
          </p>
          <h3 className="font-display text-2xl font-bold text-[var(--ink)]">
            Envio informativo
          </h3>
          <p className="max-w-2xl text-sm text-[var(--muted)]">
            La audiencia incluye alumnos activos con recepcion de emails
            habilitada y al menos un pago aprobado en los ultimos 6 meses.
          </p>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={handlePreview}>
          <div>
            <label className="text-sm font-semibold" htmlFor="email-subject">
              Asunto
            </label>
            <input
              className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="email-subject"
              maxLength={180}
              onChange={(event) =>
                setForm({ ...form, subject: event.target.value })
              }
              placeholder="Ej: Novedades de la semana"
              value={form.subject}
            />
          </div>

          <div>
            <label className="text-sm font-semibold" htmlFor="email-body">
              Mensaje
            </label>
            <textarea
              className="mt-2 min-h-56 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
              id="email-body"
              maxLength={5000}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              placeholder="Escribi el mensaje informativo para los alumnos."
              value={form.body}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              {form.body.length}/5000 caracteres
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={loadingPreview || sending}
              type="submit"
            >
              {loadingPreview ? 'Buscando...' : 'Previsualizar audiencia'}
            </button>
            <button
              className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={!canSend || sending || loadingPreview}
              onClick={() => void handleSend()}
              type="button"
            >
              {sending ? 'Enviando...' : 'Enviar con Mailjet'}
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-5 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--ink)]">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-4 text-sm font-semibold text-[var(--ink)]">
            {success}
          </div>
        ) : null}

        {result ? (
          <div className="mt-5 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
            <p className="font-semibold text-[var(--ink)]">Resultado</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Enviados: {result.sent_count} - Fallidos: {result.failed_count}
            </p>
            {result.recipients.some((recipient) => recipient.status === 'failed') ? (
              <div className="mt-3 grid gap-2">
                {result.recipients
                  .filter((recipient) => recipient.status === 'failed')
                  .map((recipient) => (
                    <p
                      className="rounded-2xl border border-[var(--line)] bg-white px-4 py-2 text-xs text-[var(--muted)]"
                      key={`${recipient.student_id}-${recipient.email}`}
                    >
                      {recipient.email}: {recipient.error ?? 'Fallo no especificado'}
                    </p>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Audiencia
        </p>
        <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
          Pagos recientes
        </h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          La vista previa no envia emails. Sirve para revisar destinatarios antes
          de confirmar el envio real.
        </p>

        {preview ? (
          <div className="mt-5">
            <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4">
              <p className="text-sm font-semibold text-[var(--ink)]">
                {preview.eligible_count} destinatarios elegibles
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Opt-out excluido automaticamente.
              </p>
            </div>

            <div className="mt-4 grid max-h-[520px] gap-2 overflow-auto pr-1">
              {preview.recipients.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
                  No hay destinatarios para mostrar.
                </p>
              ) : (
                preview.recipients.map((recipient) => (
                  <article
                    className="rounded-2xl border border-[var(--line)] bg-white p-3"
                    key={`${recipient.student_id}-${recipient.email}`}
                  >
                    <p className="text-sm font-semibold text-[var(--ink)]">
                      {recipient.first_name} {recipient.last_name}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {recipient.email}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Ultimo pago: {formatDateTime(recipient.last_paid_at)}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            Genera una vista previa para ver alumnos incluidos.
          </div>
        )}
      </aside>
    </section>
  )
}
