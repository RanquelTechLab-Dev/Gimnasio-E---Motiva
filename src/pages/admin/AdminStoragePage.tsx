import { useState } from 'react'
import { formatAdminError, previewDriveCleanup } from '../../admin/api'
import type { DriveCleanupResult } from '../../admin/types'

function formatSize(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Sin limite informado'
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Sin actividad registrada'
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AdminStoragePage() {
  const [result, setResult] = useState<DriveCleanupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePreviewCleanup() {
    setLoading(true)
    setError(null)
    try {
      const nextResult = await previewDriveCleanup()
      setResult(nextResult)
    } catch (previewError) {
      setError(formatAdminError(previewError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="grid gap-5">
      <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Storage
        </p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Limpieza controlada de Drive
            </h3>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              Revisa el espacio disponible y previsualiza que archivos se
              limpiarian segun el alumno con mas tiempo sin pago, membresia o
              actividad real. Esta pantalla no ejecuta borrados.
            </p>
          </div>
          <button
            className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
            disabled={loading}
            onClick={() => void handlePreviewCleanup()}
            type="button"
          >
            {loading ? 'Revisando...' : 'Vista previa'}
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
            {error}
          </p>
        ) : null}
      </article>

      {result ? (
        <>
          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Usado
                </p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {formatSize(result.quota.used_bytes)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Total
                </p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {formatSize(result.quota.total_bytes)}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Disponible
                </p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {result.quota.remaining_ratio === null
                    ? 'Sin limite'
                    : `${Math.round(result.quota.remaining_ratio * 100)}%`}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Alerta
                </p>
                <p className="mt-1 text-lg font-bold text-[var(--ink)]">
                  {result.quota.warning ? 'Activa' : 'Sin alerta'}
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              Candidato
            </p>
            {!result.selected_student ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                No hay archivos elegibles para limpieza.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                <p className="font-bold text-[var(--ink)]">
                  {result.selected_student.first_name}{' '}
                  {result.selected_student.last_name}
                </p>
                <p>{result.selected_student.email}</p>
                <p>
                  Ultima actividad considerada:{' '}
                  {formatDate(result.selected_student.derived_last_activity_at)}
                </p>
                <p>
                  Archivos elegibles:{' '}
                  {result.selected_student.eligible_file_count} ·{' '}
                  {formatSize(result.selected_student.eligible_bytes)}
                </p>
              </div>
            )}
          </article>

          {result.selected_files.length > 0 ? (
            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Archivos seleccionados
              </p>
              <div className="mt-4 grid gap-3">
                {result.selected_files.map((file) => (
                  <div
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4"
                    key={file.id}
                  >
                    <p className="font-bold text-[var(--ink)]">{file.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {file.kind} · {formatSize(file.size_bytes)} · creado{' '}
                      {formatDate(file.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {file.visible_to_student
                        ? 'Visible para alumno'
                        : 'No visible para alumno'}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
