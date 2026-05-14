import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from '../lib/supabase'
import { AuthContext } from './auth-context'
import type { AuthContextValue, Profile, SignInResult } from './types'

type AuthProviderProps = {
  children: ReactNode
}

function getAuthErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'No se pudo completar la operacion de autenticacion.'
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(supabaseConfigError)

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) {
      setProfile(null)
      setError(supabaseConfigError)
      return null
    }

    const { data, error: profileError } = await supabase
      .from('profiles')
      .select(
        'id, role, first_name, last_name, email, phone, active, receives_emails',
      )
      .eq('id', userId)
      .single()

    if (profileError) {
      setProfile(null)
      setError('Sesion iniciada, pero el perfil no esta disponible.')
      return null
    }

    if (!data.active) {
      setProfile(null)
      setError('La cuenta esta inactiva. Contacta a administracion.')
      return null
    }

    const nextProfile = data as Profile
    setProfile(nextProfile)
    setError(null)
    return nextProfile
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!session?.user.id) {
      setProfile(null)
      return null
    }

    return loadProfile(session.user.id)
  }, [loadProfile, session])

  useEffect(() => {
    let isMounted = true

    async function loadInitialSession() {
      if (!supabase) {
        if (isMounted) {
          setLoading(false)
        }
        return
      }

      const { data, error: sessionError } = await supabase.auth.getSession()

      if (!isMounted) {
        return
      }

      if (sessionError) {
        setError(sessionError.message)
        setLoading(false)
        return
      }

      setSession(data.session)

      if (data.session?.user.id) {
        await loadProfile(data.session.user.id)
      } else {
        setProfile(null)
      }

      if (isMounted) {
        setLoading(false)
      }
    }

    void loadInitialSession()

    if (!supabase) {
      return () => {
        isMounted = false
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return
      }

      setSession(nextSession)

      if (nextSession?.user.id) {
        void loadProfile(nextSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      if (!supabase) {
        throw new Error(supabaseConfigError ?? 'Supabase no esta configurado.')
      }

      setError(null)
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        })

      if (signInError) {
        setError(signInError.message)
        throw signInError
      }

      if (!data.session?.user.id) {
        const missingSessionError = new Error('No se recibio una sesion valida.')
        setError(missingSessionError.message)
        throw missingSessionError
      }

      setSession(data.session)
      const nextProfile = await loadProfile(data.session.user.id)

      if (!nextProfile) {
        throw new Error('No se encontro un perfil activo para esta cuenta.')
      }

      return { role: nextProfile.role }
    },
    [loadProfile],
  )

  const signOut = useCallback(async () => {
    if (!supabase) {
      setSession(null)
      setProfile(null)
      return
    }

    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      const message = getAuthErrorMessage(signOutError)
      setError(message)
      throw signOutError
    }

    setSession(null)
    setProfile(null)
    setError(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      isAdmin: profile?.role === 'admin',
      error,
      configError: supabaseConfigError,
      signIn,
      signOut,
      refreshProfile,
    }),
    [error, loading, profile, refreshProfile, session, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
