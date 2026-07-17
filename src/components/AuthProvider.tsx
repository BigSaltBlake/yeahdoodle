'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { getSavedEventIds } from '@/lib/history'
interface AuthCtx {
  user: User | null; loading: boolean
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}
const AuthContext = createContext<AuthCtx>({
  user: null, loading: true,
  signInWithEmail: async () => ({ error: null }),
  signInWithGoogle: async () => {},
  signOut: async () => {},
})
async function syncLocalSavesToCloud(userId: string) {
  const localIds = getSavedEventIds()
  if (!localIds.length) return
  const sb = getSupabaseBrowser()
  const rows = localIds.map(id => ({ user_id: userId, event_id: id }))
  await sb.from('saved_events').upsert(rows, { onConflict: 'user_id,event_id', ignoreDuplicates: true })
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const sb = getSupabaseBrowser()
    sb.auth.getUser().then(({ data }) => { setUser(data.user ?? null); setLoading(false) })
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u); setLoading(false)
      if (event === 'SIGNED_IN' && u) syncLocalSavesToCloud(u.id).catch(console.error)
    })
    return () => subscription.unsubscribe()
  }, [])
  async function signInWithEmail(email: string): Promise<{ error: Error | null }> {
    const sb = getSupabaseBrowser()
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + '/auth/callback' } })
    return { error: error as Error | null }
  }
  async function signInWithGoogle(): Promise<void> {
    const sb = getSupabaseBrowser()
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/auth/callback' } })
  }
  async function signOut() { const sb = getSupabaseBrowser(); await sb.auth.signOut(); setUser(null) }
  return <AuthContext.Provider value={{ user, loading, signInWithEmail, signInWithGoogle, signOut }}>{children}</AuthContext.Provider>
}
export function useAuth() { return useContext(AuthContext) }