'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { getSavedEventIds } from '@/lib/history'

// ---------------------------------------------------------------------------
// Google Identity Services types
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void
          prompt: () => void
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
          cancel: () => void
        }
      }
    }
  }
}

export const GOOGLE_CLIENT_ID =
  '86604654735-7liuttci8rg3dcn9k46tdn8bdoon44kr.apps.googleusercontent.com'

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
interface AuthCtx {
  user: User | null
  loading: boolean
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  loading: true,
  signInWithEmail: async () => ({ error: null }),
  signOut: async () => {},
})

// ---------------------------------------------------------------------------
// Sync any locally-saved event IDs to Supabase when the user signs in
// ---------------------------------------------------------------------------
async function syncLocalSavesToCloud(userId: string) {
  const localIds = getSavedEventIds()
  if (!localIds.length) return
  const sb = getSupabaseBrowser()
  const rows = localIds.map(id => ({ user_id: userId, event_id: id }))
  await sb.from('saved_events').upsert(rows, { onConflict: 'user_id,event_id', ignoreDuplicates: true })
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Initialize Google GSI once the script has loaded
  const initGoogleAuth = useCallback(() => {
    if (typeof window === 'undefined' || !window.google?.accounts?.id) return
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response: { credential: string }) => {
        const sb = getSupabaseBrowser()
        const { error } = await sb.auth.signInWithIdToken({
          provider: 'google',
          token: response.credential,
        })
        if (error) console.error('[Auth] Google signInWithIdToken error:', error)
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    })
  }, [])

  useEffect(() => {
    // Initialize GSI immediately if already loaded, otherwise wait for script load event
    initGoogleAuth()
    const gsiScript = document.querySelector('script[src*="gsi/client"]')
    gsiScript?.addEventListener('load', initGoogleAuth)

    const sb = getSupabaseBrowser()

    // Get initial session
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null)
      setLoading(false)
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (event === 'SIGNED_IN' && u) {
        syncLocalSavesToCloud(u.id).catch(console.error)
      }
    })

    return () => {
      subscription.unsubscribe()
      gsiScript?.removeEventListener('load', initGoogleAuth)
    }
  }, [initGoogleAuth])

  async function signInWithEmail(email: string): Promise<{ error: Error | null }> {
    const sb = getSupabaseBrowser()
    const redirectTo = `${window.location.origin}/auth/callback`
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    return { error: error as Error | null }
  }

  async function signOut() {
    const sb = getSupabaseBrowser()
    await sb.auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAuth() {
  return useContext(AuthContext)
}
