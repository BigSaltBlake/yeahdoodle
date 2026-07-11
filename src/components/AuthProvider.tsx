'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

interface AuthCtx {
  user: User | null
  loading: boolean
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  user: null, loading: true,
  signInWithEmail: async () => ({ error: null }),
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const sb = getSupabaseBrowser()
    sb.auth.getUser().then(({ data }) => { setUser(data.user ?? null); setLoading(false) })
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null); setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])
  async function signInWithEmail(email: string): Promise<{ error: Error | null }> {
    const sb = getSupabaseBrowser()
    const redirectTo = window.location.origin + '/auth/callback'
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
    return { error: error as Error | null }
  }
  async function signOut() {
    await getSupabaseBrowser().auth.signOut()
    setUser(null)
  }
  return <AuthContext.Provider value={{ user, loading, signInWithEmail, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() { return useContext(AuthContext) }
