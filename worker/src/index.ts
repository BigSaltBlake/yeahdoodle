import 'dotenv/config'
import cron from 'node-cron'
import { createDb } from './lib/db'
import { syncTicketmaster, DEFAULT_CITIES } from './sources/ticketmaster'
import { syncGoogleEvents } from './sources/google-events'
import { syncMeetup } from './sources/meetup'
import { syncSeatGeek } from './sources/seatgeek'
import { enrichDescriptions } from './enrich'

const CITIES = process.env.CITIES
  ? process.env.CITIES.split(',').map(c => c.trim())
  : DEFAULT_CITIES

async function runSync(name: string, fn: () => Promise<void>) {
  const start = Date.now()
  console.log(`\n=== [${name}] Starting sync at ${new Date().toISOString()} ===`)
  try {
    await fn()
    console.log(`=== [${name}] Done in ${((Date.now() - start) / 1000).toFixed(1)}s ===\n`)
  } catch (err) {
    console.error(`=== [${name}] FAILED:`, (err as Error).message, '===\n')
  }
}

async function bootSync() {
  const db = createDb()
  await runSync('Ticketmaster', () => syncTicketmaster(db, CITIES))
  await runSync('SeatGeek',     () => syncSeatGeek(db, CITIES))
  await runSync('Google Events', () => syncGoogleEvents(db, CITIES))
  await runSync('Meetup',        () => syncMeetup(db, CITIES))
  await runSync('AI Enrich',     () => enrichDescriptions(db))
}

function startScheduler() {
  cron.schedule('0 0,6,12,18 * * *', async () => { const db = createDb(); await runSync('Ticketmaster', () => syncTicketmaster(db, CITIES)) })
  cron.schedule('0 1,13 * * *',      async () => { const db = createDb(); await runSync('SeatGeek',     () => syncSeatGeek(db, CITIES)) })
  cron.schedule('0 2 * * *',         async () => { const db = createDb(); await runSync('AI Enrich',    () => enrichDescriptions(db)) })
  cron.schedule('0 3,15 * * *',      async () => { const db = createDb(); await runSync('Google Events', () => syncGoogleEvents(db, CITIES)) })
  cron.schedule('0 4,16 * * *',      async () => { const db = createDb(); await runSync('Meetup',       () => syncMeetup(db, CITIES)) })
  console.log('Scheduler running. Cities:', CITIES.join(', '))
}

;(async () => {
  console.log('YeahDoodle Worker starting...')
  console.log(`Supabase: ${process.env.SUPABASE_URL ?? '(not set)'}`)
  console.log(`Ticketmaster: ${process.env.TICKETMASTER_API_KEY ? '✓' : '✗ NOT SET'}`)
  console.log(`SeatGeek:     ${process.env.SEATGEEK_CLIENT_ID   ? '✓' : '✗ NOT SET'}`)
  console.log(`Anthropic:    ${process.env.ANTHROPIC_API_KEY    ? '✓' : '✗ NOT SET (enrichment disabled)'}`)
  await bootSync()
  startScheduler()
})()
