import { useEffect, useState } from 'react'
import { deleteStudentDefinitive, formatAdminError } from './api'
import type {
  DeleteStudentDefinitiveResult,
  StudentProfile,
} from './types'

type StudentDeleteTarget = Pick<
  StudentProfile,
  'id' | 'first_name' | 'last_name' | 'email'
>

type StudentDeleteModalProps = {
  student: StudentDeleteTarget
  onCancel: () => void
  onDeleted: (
    result: DeleteStudentDefinitiveResult,
  ) => void | Promise<void>
  onError: (message: string) => void
  onSavingChange: (saving: boolean) => void
}

function studentDisplayName(student: StudentDeleteTarget) {
  return [student.first_name, student.last_name].filter(Boolean).join(' ')
}

function isValidPreviewForStudent(
  result: DeleteStudentDefinitiveResult | null,
  studentId: string,
  studentEmail: string,
) {
  return (
    result !== null &&
    result.dryRun === true &&
    result.deleted === false &&
    result.preview.student_id === studentId &&
    result.preview.student_email === studentEmail
  )
}

export function StudentDeleteModal({
  student,
  onCancel,
  onDeleted,
  onError,
  onSavingChange,
}: StudentDeleteModalProps) {
  const [studentDeleteConfirmation, setStudentDeleteConfirmation] = useState('')
  const [studentDeletePreview, setStudentDeletePreview] =
    useState<DeleteStudentDefinitiveResult | null>(null)
  const [saving, setSaving] = useState(true)
  const hasValidPreview = isValidPreviewForStudent(
    studentDeletePreview,
    student.id,
    student.email,
  )

  useEffect(() => {
    let active = true
    onSavingChange(true)

    void deleteStudentDefinitive({
      studentId: student.id,
      targetEmail: student.email,
      dryRun: true,
    })
      .then((result) => {
        if (!active) {
          return
        }

        if (!isValidPreviewForStudent(result, student.id, student.email)) {
          onError('El preview no corresponde al alumno seleccionado.')
          return
        }

        setStudentDeletePreview(result)
      })
      .catch((deleteError) => {
        if (active) {
          onError(formatAdminError(deleteError))
        }
      })
      .finally(() => {
        if (active) {
          setSaving(false)
          onSavingChange(false)
        }
      })

    return () => {
      active = false
      onSavingChange(false)
    }
  }, [onError, onSavingChange, student.email, student.id])

  async function handleDeleteStudentDefinitive() {
    if (!hasValidPreview) {
      onError('Es necesario completar el preview antes de borrar.')
      return
    }

    if (studentDeleteConfirmation !== 'ELIMINAR') {
      onError('Para borrar definitivamente escribi ELIMINAR.')
      return
    }

    setSaving(true)
    onSavingChange(true)
    try {
      const result = await deleteStudentDefinitive({
        studentId: student.id,
        targetEmail: student.email,
        confirmText: 'ELIMINAR',
        dryRun: false,
      })
      await onDeleted(result)
    } catch (deleteError) {
      onError(formatAdminError(deleteError))
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  function handleCancel() {
    setStudentDeleteConfirmation('')
    setStudentDeletePreview(null)
    onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <div
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow)]"
        role="dialog"
      >
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
          Eliminacion definitiva de alumno
        </p>
        <h3 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
          {studentDisplayName(student)}
        </h3>
        <p className="mt-1 text-sm font-semibold text-[var(--muted)]">
          {student.email}
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Este flujo borra fisicamente el alumno, su usuario Auth, archivos Drive
          y datos asociados de gestion. No borra planes, actividades, clases,
          pagos de otros alumnos ni configuracion del gimnasio.
        </p>

        {studentDeletePreview ? (
          <div className="mt-4 grid gap-3 rounded-2xl bg-[var(--page)] p-4 text-sm">
            <p className="font-bold text-[var(--ink)]">Preview de impacto</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(studentDeletePreview.preview.counts).map(
                ([key, value]) => (
                  <p
                    className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]"
                    key={key}
                  >
                    {key}: <span className="text-[var(--ink)]">{value}</span>
                  </p>
                ),
              )}
            </div>
            <p className="text-xs font-semibold text-[var(--muted)]">
              Archivos Drive detectados:{' '}
              {studentDeletePreview.preview.drive_files.length}
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-[var(--page)] p-3 text-sm font-semibold text-[var(--muted)]">
            Preparando preview seguro...
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
            Confirmacion escrita
            <input
              className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold normal-case tracking-normal text-[var(--ink)]"
              onChange={(event) =>
                setStudentDeleteConfirmation(event.target.value)
              }
              placeholder="Escribi ELIMINAR"
              value={studentDeleteConfirmation}
            />
          </label>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-3 text-sm font-bold transition hover:bg-[var(--surface-strong)] disabled:opacity-60"
            disabled={saving}
            onClick={handleCancel}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
            disabled={
              saving ||
              !hasValidPreview ||
              studentDeleteConfirmation !== 'ELIMINAR'
            }
            onClick={() => void handleDeleteStudentDefinitive()}
            type="button"
          >
            {saving ? 'Eliminando...' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  )
}
