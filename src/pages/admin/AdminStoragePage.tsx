import { useCallback, useEffect, useState } from 'react'
import {
  deleteStudentDriveFile,
  formatAdminError,
  listDriveStorageFiles,
  previewDriveCleanup,
  runDriveCleanup,
} from '../../admin/api'
import type {
  AdminStorageFile,
  DriveCleanupFile,
  DriveCleanupResult,
} from '../../admin/types'

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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'Sin actividad registrada'
  }

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getFileStatus(file: DriveCleanupFile) {
  return file.archived_at ? 'Archivado' : 'Activo'
}

export function AdminStoragePage() {
  const [result, setResult] = useState<DriveCleanupResult | null>(null)
  const [lastAction, setLastAction] = useState<DriveCleanupResult | null>(null)
  const [storageFiles, setStorageFiles] = useState<AdminStorageFile[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadStorageFiles = useCallback(async () => {
    setLoadingFiles(true)
    try {
      const files = await listDriveStorageFiles()
      setStorageFiles(files)
    } catch (filesError) {
      setError(formatAdminError(filesError))
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStorageFiles()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadStorageFiles])

  async function handlePreviewCleanup() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const nextResult = await previewDriveCleanup()
      setResult(nextResult)
      setLastAction(null)
    } catch (previewError) {
      setError(formatAdminError(previewError))
    } finally {
      setLoading(false)
    }
  }

  async function handleRunCleanup() {
    if (!result || result.selected_files.length === 0) {
      return
    }

    const fileIds = result.selected_files.map((file) => file.id)
    if (fileIds.length === 0) {
      return
    }

    const confirmed = window.confirm(
      `Se eliminaran exactamente ${fileIds.length} archivos mostrados en la vista previa. Eliminar definitivo borra los archivos reales de Drive y no se puede deshacer. Pagos, membresias, reservas y asistencia no se eliminan desde limpieza. ¿Continuar?`,
    )

    if (!confirmed) {
      return
    }

    setExecuting(true)
    setError(null)
    setSuccess(null)
    try {
      const nextResult = await runDriveCleanup(fileIds)
      const nextPreview = await previewDriveCleanup()
      await loadStorageFiles()
      setLastAction(nextResult)
      setResult(nextPreview)
      setSuccess(nextResult.message)
    } catch (cleanupError) {
      setError(formatAdminError(cleanupError))
    } finally {
      setExecuting(false)
    }
  }

  async function handleDeleteFile(file: DriveCleanupFile) {
    const confirmed = window.confirm(
      `Eliminar definitivamente "${file.title}" borra el archivo real de Drive y no se puede deshacer. El historial operativo se conserva. ¿Continuar?`,
    )

    if (!confirmed) {
      return
    }

    setDeletingFileId(file.id)
    setError(null)
    setSuccess(null)
    try {
      const nextResult = await deleteStudentDriveFile(file.id)
      const nextPreview = await previewDriveCleanup()
      await loadStorageFiles()
      setResult(nextPreview)
      setLastAction(nextResult)
      setSuccess(nextResult.message)
    } catch (deleteError) {
      setError(formatAdminError(deleteError))
    } finally {
      setDeletingFileId(null)
    }
  }

  const selectedCount = result?.selected_files.length ?? 0

  return (
    <section className="grid gap-5">
      <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Archivos
        </p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Limpieza de archivos
            </h3>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              Revisá el espacio de documentos, previsualizá archivos elegibles y
              eliminá documentos reales solo con confirmación. Archivar oculta
              el documento, pero conserva historial.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
              disabled={loading || executing}
              onClick={() => void handlePreviewCleanup()}
              type="button"
            >
              {loading ? 'Revisando...' : 'Vista previa de limpieza'}
            </button>
            <button
              className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              disabled={executing || loading || selectedCount === 0}
              onClick={() => void handleRunCleanup()}
              type="button"
            >
              {executing ? 'Ejecutando...' : 'Ejecutar limpieza'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-[var(--muted)]">
          <p>
            Eliminar definitivo borra el archivo real de Drive y no se puede
            deshacer.
          </p>
          <p>
            Pagos, membresias, reservas y asistencia no se eliminan desde
            limpieza.
          </p>
        </div>

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
              Vista previa
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
                  Archivos elegibles: {result.selected_file_count ?? selectedCount} ·{' '}
                  {formatSize(result.reclaimable_bytes)}
                </p>
              </div>
            )}
          </article>

          {result.selected_files.length > 0 ? (
            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Archivos seleccionados para limpieza
              </p>
              <div className="mt-4 grid gap-3">
                {result.selected_files.map((file) => (
                  <div
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4"
                    key={file.id}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="font-bold text-[var(--ink)]">{file.title}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {file.kind} · {formatSize(file.size_bytes)} · creado{' '}
                          {formatDate(file.created_at)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {file.visible_to_student
                            ? 'Visible para alumno'
                            : 'No visible para alumno'}{' '}
                          · {getFileStatus(file)}
                        </p>
                        {file.drive_url ? (
                          <a
                            className="mt-2 inline-flex text-sm font-bold text-[var(--brand)] hover:underline"
                            href={file.drive_url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir en Drive
                          </a>
                        ) : null}
                      </div>
                      <button
                        className="rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] disabled:opacity-50"
                        disabled={deletingFileId === file.id || executing || loading}
                        onClick={() => void handleDeleteFile(file)}
                        type="button"
                      >
                        {deletingFileId === file.id
                          ? 'Eliminando...'
                          : 'Eliminar archivo definitivo'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                  Archivos cargados
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Ultimos 100 documentos registrados, activos o archivados.
                </p>
              </div>
              <button
                className="rounded-2xl border border-[var(--line)] px-4 py-2 text-sm font-bold text-[var(--ink)] disabled:opacity-50"
                disabled={loadingFiles}
                onClick={() => void loadStorageFiles()}
                type="button"
              >
                {loadingFiles ? 'Actualizando...' : 'Actualizar'}
              </button>
            </div>

            {storageFiles.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No hay documentos registrados para mostrar.
              </p>
            ) : (
              <div className="mt-4 grid gap-3">
                {storageFiles.map((file) => (
                  <div
                    className="rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4"
                    key={file.id}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="font-bold text-[var(--ink)]">{file.title}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {file.student_name ?? 'Alumno sin nombre'} ·{' '}
                          {file.student_email ?? 'sin email'}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {file.kind} · {formatSize(file.size_bytes)} · creado{' '}
                          {formatDate(file.created_at)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {file.visible_to_student
                            ? 'Visible para alumno'
                            : 'No visible para alumno'}{' '}
                          · {getFileStatus(file)}
                        </p>
                        {file.drive_url ? (
                          <a
                            className="mt-2 inline-flex text-sm font-bold text-[var(--brand)] hover:underline"
                            href={file.drive_url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir en Drive
                          </a>
                        ) : null}
                      </div>
                      {!file.archived_at && file.drive_file_id ? (
                        <button
                          className="rounded-2xl border border-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent)] disabled:opacity-50"
                          disabled={deletingFileId === file.id || executing || loading}
                          onClick={() => void handleDeleteFile(file)}
                          type="button"
                        >
                          {deletingFileId === file.id
                            ? 'Eliminando...'
                            : 'Eliminar archivo definitivo'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          {lastAction ? (
            <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
                Resultado
              </p>
              <div className="mt-3 grid gap-3 text-sm text-[var(--muted)] md:grid-cols-4">
                <p>Eliminados: {lastAction.deleted_files.length}</p>
                <p>Archivados: {lastAction.archived_file_ids.length}</p>
                <p>Fallidos: {lastAction.failed_files.length}</p>
                <p>Liberacion estimada: {formatSize(lastAction.reclaimable_bytes)}</p>
              </div>
            </article>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
