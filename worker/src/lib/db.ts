import { createClient } from '@supabase/supabase-js'

/**
 * Supabase admin client for the worker.
 * Uses the SERVICE ROLE key -- bypasses RLS so the worker can write events.
 */
export function createDb() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. ' +
      'Copy worker/.env.example to worker/.env and fill in your values.'
    )
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type Db = ReturnType<typeof createDb>
