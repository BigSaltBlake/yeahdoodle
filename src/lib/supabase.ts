import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Client-side Supabase client (uses anon key)
export const supabase = createClient(url, anon)

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon)
}
