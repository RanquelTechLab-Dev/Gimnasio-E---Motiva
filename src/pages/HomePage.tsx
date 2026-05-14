import { Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth'

export function HomePage() {
  const { configError, error, loading, profile, session } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-sm text-[var(--muted)]">
        Preparando acceso...
      </div>
    )
  }

  if (!session) {
    return <Navigate replace to="/login" />
  }

  if (configError || error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-[24px] border border-[var(--line)] bg-[var(--accent-soft)] p-5 text-sm text-[var(--ink)]">
          <p className="font-semibold">No se pudo preparar el acceso.</p>
          <p className="mt-2">{configError ?? error}</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-sm text-[var(--muted)]">
        Cargando perfil...
      </div>
    )
  }

  return <Navigate replace to={profile.role === 'admin' ? '/admin' : '/app'} />
}
