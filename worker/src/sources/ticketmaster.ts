/**
 * Ticketmaster Discovery API → Supabase sync
 *
 * Fetches upcoming events for a list of cities and upserts them into
 * the Supabase `events` table. Runs on a schedule from index.ts.
 *
 * API is free. Rate limit: 5 req/sec, 5000 req/day.
 * We fetch 5 pages × 200 events per city = up to 1000 events per city.
 */

import axios from 'axios'
import type { Db } from '../lib/db'

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2'

// Default cities to sync. Covers all major US event markets.
export const DEFAULT_CITIES = [
  // Tier 1 — largest markets
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
  'San Diego', 'Dallas', 'San Jose', 'Philadelphia', 'San Antonio',
  // Tier 2 — major event cities
  'Austin', 'Nashville', 'Denver', 'Seattle', 'Miami',
  'Atlanta', 'Boston', 'Las Vegas', 'Portland', 'Minneapolis',
  'San Francisco', 'New Orleans', 'Detroit', 'Baltimore', 'Louisville',
  // Tier 3 — growing markets
  'Salt Lake City', 'Raleigh', 'Tampa', 'Orlando', 'Cincinnati',
  'Pittsburgh', 'Kansas City', 'Columbus', 'Indianapolis', 'Charlotte',
  'Sacramento', 'Oklahoma City', 'Memphis', 'Richmond', 'Tucson',
]

// ---------------------------------------------------------------------------
// Type definitions for Ticketmaster API response
// ---------------------------------------------------------------------------
interface TMVenue {
  name: string
  address?: { line1: string }
  city?: { name: string }
  state?: { stateCode: string }
  location?: { longitude: string; latitude: string }
}

interface TMEvent {
  id: string
  name: string
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string }
  }
  classifications?: Array<{
    segment?: { name: string }
    genre?: { name: string }
    subGenre?: { name: string }
  }>
  images?: Array<{ url: string; width: number; height: number; ratio?: string }>
  url?: string
  priceRanges?: Array<{ min: number; max: number }>
  _embedded?: { venues?: TMVenue[] }
  info?: string
  pleaseNote?: string
  description?: string
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------
const SEGMENT_TO_CATEGORY: Record<string, string> = {
  'Music':          'Music',
  'Sports':         'Sports',
  'Arts & Theatre': 'Arts & Culture',
  'Film':           'Arts & Culture',
  'Miscellaneous':  'Community',
  'Family':         'Community',
}

function inferCategory(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('concert') || n.includes('music') || n.includes('band') || n.includes('festival')) return 'Music'
  if (n.includes('food') || n.includes('drink') || n.includes('wine') || n.includes('beer')) return 'Food & Drink'
  if (n.includes('art') || n.includes('museum') || n.includes('gallery') || n.includes('comedy')) return 'Arts & Culture'
  if (n.includes('sport') || n.includes('game') || n.includes('match') || n.includes('run')) return 'Sports'
  if (n.includes('club') || n.includes('night') || n.includes('dj') || n.includes('bar')) return 'Nightlife'
  if (n.includes('hike') || n.includes('outdoor') || n.includes('park') || n.includes('trail')) return 'Outdoors'
  return 'Other'
}

function inferGroupSuitability(event: TMEvent): string[] {
  const name    = (event.name ?? '').toLowerCase()
  const segment = event.classifications?.[0]?.segment?.name ?? ''
  const genre   = event.classifications?.[0]?.genre?.name ?? ''
  const groups  = ['singles', 'couples', 'friend-groups']
  if (segment === 'Family' || genre === 'Family' || name.includes('family') || name.includes('kid')) {
    groups.push('families', 'child-friendly')
  }
  return groups
}

function inferAgeGroups(event: TMEvent): string[] {
  const segment = event.classifications?.[0]?.segment?.name ?? ''
  const genre   = event.classifications?.[0]?.genre?.name ?? ''
  const name    = (event.name ?? '').toLowerCase()
  if (segment === 'Family' || genre === 'Family') return ['all-ages', 'young-kids', 'tweens', 'teens']
  if (name.includes('21+') || name.includes('21 plus')) return ['21-plus']
  if (name.includes('18+') || name.includes('18 plus')) return ['18-plus']
  return ['all-ages']
}

function bestImage(images: TMEvent['images']): string | null {
  if (!images?.length) return null
  return (
    images.find(i => i.ratio === '16_9' && i.width >= 1024)?.url ??
    images.find(i => i.ratio === '16_9' && i.width >= 640)?.url ??
    images.find(i => i.width >= 400)?.url ??
    images[0]?.url ??
    null
  )
}

// ---------------------------------------------------------------------------
// Map a raw TM event to our Supabase events table row
// ---------------------------------------------------------------------------
function mapToRow(raw: TMEvent) {
  const venue    = raw._embedded?.venues?.[0]
  const segment  = raw.classifications?.[0]?.segment?.name ?? ''
  const category = SEGMENT_TO_CATEGORY[segment] ?? inferCategory(raw.name)
  const priceMin = raw.priceRanges?.[0]?.min ?? null
  const priceMax = raw.priceRanges?.[0]?.max ?? null

  // Build ISO date string from localDate + localTime
  let dateStart: string | null = null
  if (raw.dates?.start?.dateTime) {
    dateStart = raw.dates.start.dateTime
  } else if (raw.dates?.start?.localDate) {
    const t = raw.dates.start.localTime ?? '00:00:00'
    dateStart = `${raw.dates.start.localDate}T${t}`
  }

  return {
    external_id:       raw.id,
    source:            'ticketmaster',
    title:             raw.name,
    description:       raw.info ?? raw.pleaseNote ?? raw.description ?? null,
    ai_description:    null,           // enriched separately by Claude Haiku step
    category,
    date_start:        dateStart,
    date_end:          null,
    venue_name:        venue?.name ?? null,
    venue_address:     venue?.address?.line1 ?? null,
    city:              venue?.city?.name ?? null,
    state:             venue?.state?.stateCode ?? null,
    lat:               venue?.location?.latitude  ? parseFloat(venue.location.latitude)  : null,
    lng:               venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
    image_url:         bestImage(raw.images),
    ticket_url:        raw.url ?? null,
    price_min:         priceMin,
    price_max:         priceMax,
    is_free:           priceMin === 0 || priceMin === null,
    group_suitability: inferGroupSuitability(raw),
    age_groups:        inferAgeGroups(raw),
    updated_at:        new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Fetch one page of events from Ticketmaster for a city
// ---------------------------------------------------------------------------
async function fetchPage(city: string, page: number, apiKey: string): Promise<{ events: TMEvent[]; total: number }> {
  const params = new URLSearchParams({
    apikey:      apiKey,
    city,
    size:        '200',
    page:        String(page),
    sort:        'date,asc',
    countryCode: 'US',
    // Look 30 days ahead
    startDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endDateTime:   (() => {
      const d = new Date(); d.setDate(d.getDate() + 30)
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
    })(),
  })

  const res = await axios.get(`${TM_BASE}/events.json?${params}`)
  const data = res.data
  return {
    events: data._embedded?.events ?? [],
    total:  data.page?.totalElements ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Sleep helper for rate limiting
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Main sync function — call this from the scheduler
// ---------------------------------------------------------------------------
export async function syncTicketmaster(db: Db, cities = DEFAULT_CITIES): Promise<void> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey) {
    throw new Error('TICKETMASTER_API_KEY env var not set')
  }

  let totalUpserted = 0
  let totalErrors   = 0

  for (const city of cities) {
    console.log(`[TM] Syncing ${city}...`)
    try {
      // Fetch up to 3 pages (600 events) per city — stays well within daily limits
      const MAX_PAGES = 3
      for (let page = 0; page < MAX_PAGES; page++) {
        const { events, total } = await fetchPage(city, page, apiKey)
        if (!events.length) break

        const rows = events.map(mapToRow)

        // Upsert: if external_id + source already exists, update it
        const { error } = await db
          .from('events')
          .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })

        if (error) {
          console.error(`[TM] Upsert error for ${city} page ${page}:`, error.message)
          totalErrors++
        } else {
          totalUpserted += rows.length
          console.log(`[TM]   page ${page}: +${rows.length} (${totalUpserted} total so far, ${total} available)`)
        }

        // Stop if we've fetched all available pages
        const totalPages = Math.ceil(total / 200)
        if (page + 1 >= totalPages || page + 1 >= MAX_PAGES) break

        // Rate limit: 5 req/sec — wait 250ms between page requests
        await sleep(250)
      }
    } catch (err) {
      console.error(`[TM] Error syncing ${city}:`, (err as Error).message)
      totalErrors++
    }

    // Polite pause between cities
    await sleep(500)
  }

  console.log(`[TM] Sync complete. ${totalUpserted} events upserted, ${totalErrors} errors.`)
}
