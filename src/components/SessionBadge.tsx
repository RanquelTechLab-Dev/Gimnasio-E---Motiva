import { useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'

export function SessionBadge() {
  const { profile, user, role, signOut } = useAuth()
  const navigate = useNavigate()

  const displayName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim()
    : user?.email

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-[var(--ink)]">{displayName}</p>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          {role === 'admin' ? 'Admin' : 'Alumno'}
        </p>
      </div>
      <button
        className="rounded-2xl border border-[var(--line)] px-4 py-2 font-semibold text-[var(--ink)] transition hover:bg-[var(--brand-soft)]"
        onClick={handleSignOut}
        type="button"
      >
        Salir
      </button>
    </div>
  )
}
