import { useContext } from 'react'
import { AuthContext } from './auth-context'

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.')
  }

  return value
}
