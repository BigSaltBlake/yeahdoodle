/**
 * Bandsintown API v4 -> Supabase sync
 *
 * Music-focused: touring artists, venue shows, concerts.
 * Fills gaps in Ticketmaster/SeatGeek for smaller artists and club shows.
 *
 * Auth: app_id query param — use your app name or API key.
 * Set env var: BANDSINTOWN_APP_ID
 *
 * Docs: https://app.swaggerhub.com/apis/Bandsintown/PublicAPI/3.0.0
 */

import axios from 'axios'
import type { Db } from '../lib/db'

const BIT_BASE = 'https://rest.bandsintown.com/v4'

// ---------------------------------------------------------------------------
// Type definitions for Bandsintown API response
// ---------------------------------------------------------------------------
interface BITVenue {
  name:      string
  city:      string
  region:    string
  country:   string
  latitude:  string
  longitude: string
}

interface BITOffer {
  type:   string
  url:    string
  status: string
}

interface BITArtist {
  name:               string
  image_url?:         string
  facebook_page_url?: string
  mbid?:              string
}

interface BITEvent {
  id:               string
  artist_id:        string
  url:              string
  on_sale_datetime: string | null
  datetime:         string
  description:      string | null
  venue:            BITVenue
  offers:           BITOffer[]
  lineup:           string[]
  title:            string | null
  artist:           BITArtist
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getTicketUrl(event: BITEvent): string | null {
  return (
    event.offers?.find(o => o.type === 'Tickets')?.url ??
    event.offers?.[0]?.url ??
    event.url ??
    null
  )
}

function inferAgeGroups(event: BITEvent): string[] {
  const s = ((event.title ?? '') + ' ' + (event.artist?.name ?? '')).toLowerCase()
  if (s.includes('21+') || s.includes('21 plus')) return ['21-plus']
  if (s.includes('18+') || s.includes('18 plus')) return ['18-plus']
  return ['all-ages']
}

// ---------------------------------------------------------------------------
// Map a raw Bandsintown event to our Supabase events table row
// ---------------------------------------------------------------------------
function mapToRow(raw: BITEvent): Record<string, unknown> {
  const venue = raw.venue
  const title = raw.title || `${raw.artist?.name ?? 'Live Show'} in ${venue?.city ?? ''}`

  return {
    external_id:       `bit_${raw.id}`,
    source:            'bandsintown',
    title,
    description:       raw.description ?? null,
    ai_description:    null,
    category:          'Music',
    date_start:        raw.datetime ?? null,
    date_end:          null,
    venue_name:        venue?.name ?? null,
    venue_address:     null,
    city:              venue?.city ?? null,
    state:             venue?.region ?? null,
    lat:               venue?.latitude  ? parseFloat(venue.latitude)  : null,
    lng:               venue?.longitude ? parseFloat(venue.longitude) : null,
    image_url:         raw.artist?.image_url ?? null,
    ticket_url:        getTicketUrl(raw),
    price_min:         null,
    price_max:         null,
    is_free:           false,
    group_suitability: ['singles', 'couples', 'friend-groups'],
    age_groups:        inferAgeGroups(raw),
    dedupe_key:        venue?.name && raw.datetime && venue?.city
                         ? `${venue.name.toLowerCase().trim()}|${raw.datetime.slice(0, 10)}|${venue.city.toLowerCase().trim()}`
                         : null,
    updated_at:        new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Sleep helper for rate limiting
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Fetch events by city
// ---------------------------------------------------------------------------
async function fetchCityEvents(city: string, appId: string): Promise<BITEvent[]> {
  const now    = new Date()
  const future = new Date(now)
  future.setDate(future.getDate() + 30)

  const dateFrom = now.toISOString().slice(0, 10)
  const dateTo   = future.toISOString().slice(0, 10)

  const res = await axios.get(`${BIT_BASE}/events`, {
    params: {
      app_id:   appId,
      location: city,
      radius:   '30',
      unit:     'mile',
      date:     `${dateFrom},${dateTo}`,
      per_page: 100,
    },
  })

  return Array.isArray(res.data) ? res.data : []
}

// ---------------------------------------------------------------------------
// Main sync function — call this from the scheduler
// ---------------------------------------------------------------------------
export async function syncBandsintown(db: Db, cities: string[]): Promise<void> {
  const appId = process.env.BANDSINTOWN_APP_ID

  if (!appId) {
    console.log('[BIT] BANDSINTOWN_APP_ID not set — skipping Bandsintown sync')
    return
  }

  let totalUpserted = 0
  let totalErrors   = 0

  for (const city of cities) {
    console.log(`[BIT] Syncing ${city}...`)
    try {
      const events = await fetchCityEvents(city, appId)

      if (!events.length) {
        console.log(`[BIT]   no events for ${city}`)
        await sleep(300)
        continue
      }

      const rows = events.map(mapToRow)

      const { error } = await db
        .from('events')
        .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })

      if (error) {
        console.error(`[BIT] Upsert error for ${city}:`, error.message)
        totalErrors++
      } else {
        totalUpserted += rows.length
        console.log(`[BIT]   +${rows.length} (${totalUpserted} total)`)
      }
    } catch (err) {
      console.error(`[BIT] Error syncing ${city}:`, (err as Error).message)
      totalErrors++
    }
    await sleep(500)
  }

  console.log(`[BIT] Sync complete. ${totalUpserted} events upserted, ${totalErrors} errors.`)
}
