/**
 * YeahDoodle Worker -- main entry point
 * Runs as a long-lived process on Railway.
 */

import 'dotenv/config'
import cron from 'node-cron'
import { createDb } from './lib/db'
import { syncTicketmaster, DEFAULT_CITIES } from './sources/ticketmaster'
import { syncGoogleEvents } from './sources/google-events'
import { syncMeetup } from './sources/meetup'

const CITIES = process.env.CITIES
  ? process.env.CITIES.split(',').map(c => c.trim())
  : DEFAULT_CITIES

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

async function bootSync() {
  const db = createDb()
  await runSync('Ticketmaster', () => syncTicketmaster(db, CITIES))
  await runSync('Google Events', () => syncGoogleEvents(db, CITIES))
  await runSync('Meetup',        () => syncMeetup(db, CITIES))
}

function startScheduler() {
  cron.schedule('0 0,6,12,18 * * *', async () => {
    const db = createDb()
    await runSync('Ticketmaster', () => syncTicketmaster(db, CITIES))
  })

  cron.schedule('0 3,15 * * *', async () => {
    const db = createDb()
    await runSync('Google Events', () => syncGoogleEvents(db, CITIES))
  })

  cron.schedule('0 4,16 * * *', async () => {
    const db = createDb()
    await runSync('Meetup', () => syncMeetup(db, CITIES))
  })

  console.log('Scheduler running. Syncing cities:', CITIES.join(', '))
}

;(async () => {
  console.log('YeahDoodle Worker starting...')
  console.log(`Supabase: ${process.env.SUPABASE_URL ?? '(not set)'}`)
  console.log(`Ticketmaster API key: ${process.env.TICKETMASTER_API_KEY ? 'set' : 'NOT SET'}`)
  await bootSync()
  startScheduler()
})()
