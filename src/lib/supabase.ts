import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
// Prefer Supabase's new publishable key; the legacy anon key is the fallback
const anon = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? ''

// Client-side Supabase client (uses anon key)
export const supabase = createClient(url, anon)

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon)
}
