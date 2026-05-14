import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'

type ProtectedRouteProps = {
  requireAdmin?: boolean
}

export function ProtectedRoute({ requireAdmin = false }: ProtectedRouteProps) {
  const { loading, session, profile, isAdmin, configError, error } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
        Validando sesion...
      </div>
    )
  }

  if (!session) {
    return <Navigate replace state={{ from: location }} to="/login" />
  }

  if (configError || error || !profile) {
    return (
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--accent-soft)] p-5 text-sm text-[var(--ink)]">
        <p className="font-semibold">No se pudo cargar el perfil.</p>
        <p className="mt-2">{configError ?? error}</p>
      </div>
    )
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate replace to="/app" />
  }

  return <Outlet />
}
