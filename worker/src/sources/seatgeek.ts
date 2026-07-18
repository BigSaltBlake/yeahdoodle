/**
 * SeatGeek Platform API → Supabase sync
 *
 * Fetches upcoming events for a list of cities and upserts them into
 * the Supabase `events` table. Runs on a schedule from index.ts.
 *
 * API docs: https://platform.seatgeek.com/
 * Auth: pass client_id (and optionally client_secret) as query params.
 * Rate limit: varies by tier; default free tier is ~1000 req/day.
 */

import axios from 'axios'
import type { Db } from '../lib/db'

const SG_BASE = 'https://api.seatgeek.com/2'

// ---------------------------------------------------------------------------
// Type definitions for SeatGeek API response
// ---------------------------------------------------------------------------
interface SGVenue {
  name: string
  address: string | null
  city: string | null
  state: string | null
  location: { lat: number; lon: number } | null
}

interface SGPerformer {
  name: string
  type: string
  genres?: Array<{ name: string }>
}

interface SGEvent {
  id: number
  title: string
  datetime_local: string | null
  datetime_utc: string | null
  venue: SGVenue
  performers: SGPerformer[]
  taxonomies: Array<{ name: string; parent_type?: string }>
  url: string
  stats: {
    lowest_price: number | null
    highest_price: number | null
    average_price: number | null
  }
  score: number
  announce_date: string | null
  visible_until_utc: string | null
  short_title: string | null
  description: string | null
  type: string
}

// ---------------------------------------------------------------------------
// Category mapping from SeatGeek taxonomy
// ---------------------------------------------------------------------------
const TAXONOMY_TO_CATEGORY: Record<string, string> = {
  concert:       'Music',
  music_festival: 'Music',
  sports:        'Sports',
  theater:       'Arts & Culture',
  comedy:        'Arts & Culture',
  classical:     'Arts & Culture',
  dance_performance: 'Arts & Culture',
  opera:         'Arts & Culture',
  family:        'Community',
  cirque_du_soleil: 'Arts & Culture',
  magic:         'Arts & Culture',
}

function inferCategory(event: SGEvent): string {
  for (const tax of event.taxonomies ?? []) {
    const key = tax.name?.toLowerCase().replace(/\s+/g, '_')
    if (key && TAXONOMY_TO_CATEGORY[key]) return TAXONOMY_TO_CATEGORY[key]
  }
  const title = (event.title ?? '').toLowerCase()
  if (title.includes('food') || title.includes('wine') || title.includes('beer') || title.includes('tast')) return 'Food & Drink'
  if (title.includes('hike') || title.includes('outdoor') || title.includes('trail') || title.includes('park')) return 'Outdoors'
  if (title.includes('club') || title.includes('night') || title.includes('dj') || title.includes('rave')) return 'Nightlife'
  return 'Other'
}

function inferGroupSuitability(event: SGEvent): string[] {
  const title = (event.title ?? '').toLowerCase()
  const groups = ['singles', 'couples', 'friend-groups']
  if (title.includes('family') || title.includes('kid') || event.type === 'family') {
    groups.push('families', 'child-friendly')
  }
  return groups
}

function inferAgeGroups(event: SGEvent): string[] {
  const title = (event.title ?? '').toLowerCase()
  if (title.includes('21+') || title.includes('21 plus')) return ['21-plus']
  if (title.includes('18+') || title.includes('18 plus')) return ['18-plus']
  if (title.includes('family') || title.includes('kid') || event.type === 'family') {
    return ['all-ages', 'young-kids', 'tweens', 'teens']
  }
  return ['all-ages']
}

// ---------------------------------------------------------------------------
// Map a raw SeatGeek event to our Supabase events table row
// ---------------------------------------------------------------------------
function mapToRow(raw: SGEvent) {
  const priceMin = raw.stats?.lowest_price ?? null
  const priceMax = raw.stats?.highest_price ?? null

  return {
    external_id:       String(raw.id),
    source:            'seatgeek',
    title:             raw.title,
    description:       raw.description ?? null,
    ai_description:    null,
    category:          inferCategory(raw),
    date_start:        raw.datetime_local ?? raw.datetime_utc ?? null,
    date_end:          null,
    venue_name:        raw.venue?.name ?? null,
    venue_address:     raw.venue?.address ?? null,
    city:              raw.venue?.city ?? null,
    state:             raw.venue?.state ?? null,
    lat:               raw.venue?.location?.lat ?? null,
    lng:               raw.venue?.location?.lon ?? null,
    image_url:         null, // SeatGeek doesn't return images in list endpoint
    ticket_url:        raw.url ?? null,
    price_min:         priceMin,
    price_max:         priceMax,
    is_free:           priceMin === 0 || priceMin === null,
    group_suitability: inferGroupSuitability(raw),
    age_groups:        inferAgeGroups(raw),
    dedupe_key:        raw.venue?.name && raw.venue?.city && (raw.datetime_local ?? raw.datetime_utc)
                         ? `${raw.venue.name.toLowerCase().trim()}|${(raw.datetime_local ?? raw.datetime_utc ?? '').slice(0, 10)}|${raw.venue.city.toLowerCase().trim()}`
                         : null,
    updated_at:        new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Sleep helper for rate limiting
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Fetch one page of events for a city
// ---------------------------------------------------------------------------
async function fetchPage(
  city: string,
  page: number,
  clientId: string,
  clientSecret?: string,
): Promise<{ events: SGEvent[]; total: number }> {
  const now = new Date()
  const future = new Date(now)
  future.setDate(future.getDate() + 30)

  const params: Record<string, string> = {
    client_id:            clientId,
    'venue.city':         city,
    'venue.country':      'US',
    per_page:             '500',
    page:                 String(page),
    sort:                 'datetime_local.asc',
    'datetime_local.gte': now.toISOString().slice(0, 10),
    'datetime_local.lte': future.toISOString().slice(0, 10),
  }
  if (clientSecret) params.client_secret = clientSecret

  const res = await axios.get(`${SG_BASE}/events`, { params })
  return {
    events: res.data.events ?? [],
    total:  res.data.meta?.total ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Main sync function — call this from the scheduler
// ---------------------------------------------------------------------------
export async function syncSeatGeek(db: Db, cities: string[]): Promise<void> {
  const clientId = process.env.SEATGEEK_CLIENT_ID
  const clientSecret = process.env.SEATGEEK_CLIENT_SECRET // optional

  if (!clientId) {
    throw new Error('SEATGEEK_CLIENT_ID env var not set')
  }

  let totalUpserted = 0
  let totalErrors   = 0

  for (const city of cities) {
    console.log(`[SG] Syncing ${city}...`)
    try {
      const MAX_PAGES = 2
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { events, total } = await fetchPage(city, page, clientId, clientSecret)
        if (!events.length) break

        const rows = events.map(mapToRow)

        const { error } = await db
          .from('events')
          .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })

        if (error) {
          console.error(`[SG] Upsert error for ${city} page ${page}:`, error.message)
          totalErrors++
        } else {
          totalUpserted += rows.length
          console.log(`[SG]   page ${page}: +${rows.length} (${totalUpserted} total, ${total} available)`)
        }

        const totalPages = Math.ceil(total / 500)
        if (page >= totalPages || page >= MAX_PAGES) break

        await sleep(300)
      }
    } catch (err) {
      console.error(`[SG] Error syncing ${city}:`, (err as Error).message)
      totalErrors++
    }

    await sleep(500)
  }

  console.log(`[SG] Sync complete. ${totalUpserted} events upserted, ${totalErrors} errors.`)
}
