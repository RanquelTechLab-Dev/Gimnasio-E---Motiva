import { useEffect, useState } from 'react'
import { formatAppError, listMyFiles } from '../../app/api'
import { formatDateTime } from '../../app/format'
import type { StudentFile } from '../../app/types'

const kindLabels: Record<StudentFile['kind'], string> = {
  attachment: 'Adjunto',
  observation: 'Observacion',
  training_plan: 'Plan de entrenamiento',
}

function formatSize(value: number | null) {
  if (value === null) {
    return 'Sin tamano'
  }

  if (value < 1024) {
    return `${value} B`
  }

  return `${(value / 1024).toFixed(1)} KB`
}

export function StudentFilesPage() {
  const [files, setFiles] = useState<StudentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadFiles() {
      setLoading(true)
      setError(null)
      try {
        const nextFiles = await listMyFiles()
        if (active) {
          setFiles(nextFiles)
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

    void loadFiles()

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
        Archivos
      </p>
      <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
        Mis documentos
      </h3>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Los archivos reales con Google Drive quedan para un bloque posterior.
      </p>
      {loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Cargando archivos...</p>
      ) : error ? (
        <p className="mt-5 rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
          {error}
        </p>
      ) : files.length === 0 ? (
        <div className="mt-5 rounded-[20px] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
          Todavia no hay archivos cargados para tu perfil.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {files.map((file) => (
            <article
              className="rounded-[18px] border border-[var(--line)] bg-[var(--surface-strong)] p-4"
              key={file.file_id}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-bold text-[var(--ink)]">{file.title}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {kindLabels[file.kind]} · {formatDateTime(file.created_at)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {file.mime_type ?? 'Sin tipo'} · {formatSize(file.size_bytes)}
                  </p>
                </div>
                {file.drive_url ? (
                  <a
                    className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--brand-soft)]"
                    href={file.drive_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Abrir
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
