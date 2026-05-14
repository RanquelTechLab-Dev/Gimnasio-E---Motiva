import type { Session, User } from '@supabase/supabase-js'

export type UserRole = 'admin' | 'student'

export type Profile = {
  id: string
  role: UserRole
  first_name: string
  last_name: string
  email: string
  phone: string | null
  active: boolean
  receives_emails: boolean
}

export type SignInResult = {
  role: UserRole
}

export type AuthContextValue = {
  loading: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  role: UserRole | null
  isAdmin: boolean
  error: string | null
  configError: string | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<Profile | null>
}
