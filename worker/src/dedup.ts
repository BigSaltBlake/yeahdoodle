/**
 * Event deduplication job
 *
 * Marks SeatGeek rows as `is_duplicate = true` whenever a Ticketmaster row
 * exists with the same `dedupe_key` (venue_name|date|city). Ticketmaster is
 * preferred because it returns event images; SeatGeek list endpoints don't.
 *
 * Runs via an RPC call to the `run_dedup` PostgreSQL function, which executes
 * a cross-table UPDATE in a single query — much faster than JS-level diffing.
 *
 * Schedule: after every TM and SG sync, and daily at 06:30 UTC as a safety net.
 */

import type { Db } from './lib/db'

export async function runDedup(db: Db): Promise<void> {
  console.log('[Dedup] Running deduplication...')

  const { data, error } = await db.rpc('run_dedup')

  if (error) {
    throw new Error(`[Dedup] RPC failed: ${error.message}`)
  }

  const marked = (data as number) ?? 0
  console.log(`[Dedup] Marked ${marked} SeatGeek events as duplicates.`)
}
