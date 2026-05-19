import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  formatAppError,
  getMyProfileSummary,
  updateMyProfilePreferences,
} from '../../app/api'
import { formatDateTime } from '../../app/format'
import type { StudentProfileDetails } from '../../app/types'
import { useAuth } from '../../auth/useAuth'

export function StudentProfilePage() {
  const { refreshProfile } = useAuth()
  const [profile, setProfile] = useState<StudentProfileDetails | null>(null)
  const [phone, setPhone] = useState('')
  const [receivesEmails, setReceivesEmails] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadProfile() {
      setLoading(true)
      setError(null)
      try {
        const summary = await getMyProfileSummary()
        if (active) {
          setProfile(summary.profile)
          setPhone(summary.profile.phone ?? '')
          setReceivesEmails(summary.profile.receives_emails)
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

    void loadProfile()

    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const nextProfile = await updateMyProfilePreferences({
        phone,
        receives_emails: receivesEmails,
      })
      setProfile((current) =>
        current
          ? {
              ...current,
              phone: nextProfile.phone,
              receives_emails: nextProfile.receives_emails,
            }
          : current,
      )
      await refreshProfile()
      setSuccess('Datos actualizados.')
    } catch (saveError) {
      setError(formatAppError(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Cargando perfil...</p>
  }

  if (!profile) {
    return (
      <p className="rounded-2xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">
        {error ?? 'No se pudo cargar el perfil.'}
      </p>
    )
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <article className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
          Datos personales
        </p>
        <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
          {profile.first_name} {profile.last_name}
        </h3>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="font-semibold text-[var(--muted)]">Email</dt>
            <dd>{profile.email}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Estado</dt>
            <dd>{profile.active ? 'Activo' : 'Inactivo'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Ultimo pago</dt>
            <dd>{formatDateTime(profile.last_payment_at)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--muted)]">Ultima asistencia</dt>
            <dd>{formatDateTime(profile.last_attendance_at)}</dd>
          </div>
        </dl>
      </article>

      <form
        className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
          Datos de contacto
        </p>
        <h3 className="mt-2 text-2xl font-bold text-[var(--ink)]">
          Datos editables
        </h3>
        <label className="mt-5 block text-sm font-semibold text-[var(--ink)]">
          Telefono
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Telefono de contacto"
            type="tel"
            value={phone}
          />
        </label>
        <label className="mt-4 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-sm font-semibold">
          <input
            checked={receivesEmails}
            onChange={(event) => setReceivesEmails(event.target.checked)}
            type="checkbox"
          />
          Recibir novedades por email
        </label>
        <p className="mt-4 text-sm text-[var(--muted)]">
          El email y el estado de la cuenta los actualiza administración.
        </p>
        <button
          className="mt-5 rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          Guardar cambios
        </button>
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
      </form>
    </section>
  )
}
