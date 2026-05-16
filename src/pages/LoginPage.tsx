import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'

export function LoginPage() {
  const { configError, error, loading, profile, session, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && session && profile) {
      navigate(profile.role === 'admin' ? '/admin' : '/app', { replace: true })
    }
  }, [loading, navigate, profile, session])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)

    try {
      const result = await signIn(email, password)
      navigate(result.role === 'admin' ? '/admin' : '/app', { replace: true })
    } catch (signInError) {
      setFormError(
        signInError instanceof Error
          ? signInError.message
          : 'No se pudo iniciar sesion.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-center">
      <div className="hidden lg:block">
        <div className="inline-flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 shadow-[var(--shadow)]">
          <img
            alt="E-Motiva"
            className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-sm"
            src="/brand/2.png"
          />
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-[0.24em] text-[var(--brand)]">
              E-Motiva
            </p>
            <p className="text-sm text-[var(--muted)]">
              Gestion del gimnasio y autogestion de alumnos.
            </p>
          </div>
        </div>
        <h1 className="mt-8 max-w-2xl font-display text-5xl font-bold leading-tight text-[var(--ink)]">
          Acceso ordenado para entrenar, reservar y administrar.
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--muted)]">
          Tu panel queda separado por rol: administracion para el equipo y
          espacio alumno para reservas, pagos, asistencia y archivos.
        </p>
      </div>
      <form
        className="w-full rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[var(--shadow)] sm:p-8"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-3">
          <img
            alt="E-Motiva"
            className="h-14 w-14 rounded-2xl bg-white object-contain p-1 shadow-sm sm:h-16 sm:w-16"
            src="/brand/2.png"
          />
          <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand)]">
            E-Motiva
          </p>
        </div>
        <h1 className="mt-4 font-display text-4xl font-bold text-[var(--ink)]">
          Acceso E-Motiva
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Acceso para cuentas creadas por administracion. No hay registro
          publico.
        </p>

        {location.state ? (
          <p className="mt-5 rounded-2xl bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            Inicia sesion para continuar.
          </p>
        ) : null}

        <label className="mt-6 block">
          <span className="text-sm font-medium text-[var(--muted)]">Email</span>
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-[var(--muted)]">
            Contrasena
          </span>
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>

        <button
          className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-[var(--brand)] px-5 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting || Boolean(configError)}
          type="submit"
        >
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>

        {configError || formError || error ? (
          <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
            {configError ?? formError ?? error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
