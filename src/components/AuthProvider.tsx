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
// Sync any locally-saved events to Supabase when the user signs in.
// Reads from the yd_saved key (written by MoodSurvey) which holds the full
// event objects — not just the IDs in yd_profile.savedEventIds.
// ---------------------------------------------------------------------------
async function syncLocalSavesToCloud(userId: string) {
  // Read full saved event data from the key MoodSurvey writes to
  let localSaved: Array<{
    event_id: string
    event_title?: string
    event_data?: Record<string, unknown>
    intent?: string
    city?: string
  }> = []
  try {
    const raw = localStorage.getItem('yd_saved')
    if (raw) localSaved = JSON.parse(raw)
  } catch {}

  // Fallback: also check the older profile.savedEventIds (IDs only)
  const legacyIds = getSavedEventIds().filter(
    id => !localSaved.some(item => item.event_id === id),
  )
  if (legacyIds.length) {
    localSaved = [...localSaved, ...legacyIds.map(id => ({ event_id: id }))]
  }

  if (!localSaved.length) return

  const sb = getSupabaseBrowser()

  // Fetch already-saved event_ids for this user to avoid duplicates
  const { data: existing } = await sb
    .from('saved_events')
    .select('event_id')
    .eq('user_id', userId)

  const existingIds = new Set((existing ?? []).map((r: { event_id: string }) => r.event_id))
  const newRows = localSaved
    .filter(item => !existingIds.has(item.event_id))
    .map(item => ({
      user_id:     userId,
      event_id:    item.event_id,
      event_title: item.event_title ?? null,
      event_data:  item.event_data ?? null,
      intent:      item.intent ?? 'save_for_later',
      city:        item.city ?? null,
    }))

  if (!newRows.length) return
  await sb.from('saved_events').insert(newRows)
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
