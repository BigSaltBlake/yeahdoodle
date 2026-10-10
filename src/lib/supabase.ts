import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
// Supabase publishable key (the legacy anon key was disabled Oct 2026)
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''

// Client-side Supabase client (uses anon key)
export const supabase = createClient(url, anon)

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon)
}
