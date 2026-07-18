/**
 * YeahDoodle Worker — main entry point
 *
 * Runs as a long-lived process on Railway ($5/month hobby tier).
 * Uses node-cron to schedule sync jobs on a rotating basis.
 *
 * Deploy:
 *   1. Create a new Railway project from this folder
 *   2. Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TICKETMASTER_API_KEY
 *   3. Railway auto-detects the Procfile and runs `npm start`
 */

import 'dotenv/config'
import cron from 'node-cron'
import { createDb } from './lib/db'
import { syncTicketmaster, DEFAULT_CITIES } from './sources/ticketmaster'
import { syncGoogleEvents } from './sources/google-events'
import { syncMeetup } from './sources/meetup'
import { syncSeatGeek } from './sources/seatgeek'
import { enrichDescriptions } from './enrich'
import { deleteExpiredEvents } from './cleanup'
import { runDedup } from './dedup'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CITIES = process.env.CITIES
  ? process.env.CITIES.split(',').map(c => c.trim())
  : DEFAULT_CITIES

// ---------------------------------------------------------------------------
// Run a sync job with consistent error handling and timing
// ---------------------------------------------------------------------------
async function runSync(name: string, fn: () => Promise<void>) {
  const start = Date.now()
  console.log(`\n=== [${name}] Starting sync at ${new Date().toISOString()} ===`)
  try {
    await fn()
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`=== [${name}] Done in ${elapsed}s ===\n`)
  } catch (err) {
    console.error(`=== [${name}] FAILED:`, (err as Error).message, '===\n')
  }
}

// ---------------------------------------------------------------------------
// Startup: run all sources immediately on boot so the DB is populated fast
// ---------------------------------------------------------------------------
async function bootSync() {
  const db = createDb()
  await runSync('Cleanup',       () => deleteExpiredEvents(db))
  await runSync('Ticketmaster',  () => syncTicketmaster(db, CITIES))
  await runSync('SeatGeek',      () => syncSeatGeek(db, CITIES))
  await runSync('Dedup',         () => runDedup(db))
  await runSync('Google Events', () => syncGoogleEvents(db, CITIES))
  await runSync('Meetup',        () => syncMeetup(db, CITIES))
  await runSync('AI Enrich',     () => enrichDescriptions(db))
}

// ---------------------------------------------------------------------------
// Schedules (all times UTC)
//
// Ticketmaster — every 6 hours (4x/day × ~20 cities = 80 requests → well under 5000/day limit)
// Google Events — every 12 hours (placeholder, no-op until implemented)
// Meetup — every 12 hours (placeholder, no-op until implemented)
// ---------------------------------------------------------------------------
function startScheduler() {
  // Ticketmaster: 00:00, 06:00, 12:00, 18:00 UTC — run dedup after each sync
  cron.schedule('0 0,6,12,18 * * *', async () => {
    const db = createDb()
    await runSync('Ticketmaster', () => syncTicketmaster(db, CITIES))
    await runSync('Dedup',        () => runDedup(db))
  })

  // SeatGeek: 01:00 and 13:00 UTC — run dedup after each sync
  cron.schedule('0 1,13 * * *', async () => {
    const db = createDb()
    await runSync('SeatGeek', () => syncSeatGeek(db, CITIES))
    await runSync('Dedup',    () => runDedup(db))
  })

  // AI enrichment: 02:00 UTC daily (after overnight syncs settle)
  cron.schedule('0 2 * * *', async () => {
    const db = createDb()
    await runSync('AI Enrich', () => enrichDescriptions(db))
  })

  // Google Events: 03:00 and 15:00 UTC
  cron.schedule('0 3,15 * * *', async () => {
    const db = createDb()
    await runSync('Google Events', () => syncGoogleEvents(db, CITIES))
  })

  // Meetup: 04:00 and 16:00 UTC
  cron.schedule('0 4,16 * * *', async () => {
    const db = createDb()
    await runSync('Meetup', () => syncMeetup(db, CITIES))
  })

  // Cleanup: 05:00 UTC daily — delete events older than yesterday
  cron.schedule('0 5 * * *', async () => {
    const db = createDb()
    await runSync('Cleanup', () => deleteExpiredEvents(db))
  })

  console.log('Scheduler running. Syncing cities:', CITIES.join(', '))
  console.log('Schedule: Ticketmaster every 6h | SeatGeek every 12h | Google Events every 12h | Meetup every 12h | Cleanup daily 05:00')
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
;(async () => {
  console.log('YeahDoodle Worker starting...')
  console.log(`Supabase: ${process.env.SUPABASE_URL ?? '(not set)'}`)
  console.log(`Ticketmaster API key: ${process.env.TICKETMASTER_API_KEY ? '✓ set' : '✗ NOT SET'}`)
  console.log(`SeatGeek client ID:   ${process.env.SEATGEEK_CLIENT_ID   ? '✓ set' : '✗ NOT SET'}`)
  console.log(`Anthropic API key:    ${process.env.ANTHROPIC_API_KEY    ? '✓ set' : '✗ NOT SET (enrichment disabled)'}`)


  // Run immediately on start so we don't wait 6 hours for first data
  await bootSync()

  // Then kick off the recurring schedule
  startScheduler()
})()
