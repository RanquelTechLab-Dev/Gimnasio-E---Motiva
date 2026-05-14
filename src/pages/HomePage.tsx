import { Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth'

export function HomePage() {
  const { loading, profile, session } = useAuth()

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

  return <Navigate replace to={profile?.role === 'admin' ? '/admin' : '/app'} />
}
