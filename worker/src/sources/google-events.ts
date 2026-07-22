/**
 * SerpAPI Google Events â Supabase sync
 *
 * Uses Google's Events SERP feature via SerpAPI to surface ANY event
 * indexed by Google â including hyper-local events from small business
 * websites, community pages, and venues that don't list on major platforms.
 *
 * This is the key unlock for micro-local discovery.
 * Sign up at: https://serpapi.com (free tier: 100 searches/month)
 * Set env var: SERPAPI_KEY
 */

import crypto from 'crypto'
import type { Db } from '../lib/db'

const SERPAPI_KEY = process.env.SERPAPI_KEY ?? ''
const BASE_URL = 'https://serpapi.com/search.json'

interface SerpEventDate {
  start_date?: string
  when?: string
}

interface SerpEventVenue {
  name?: string
  rating?: number
  reviews?: number
  link?: string
}

interface SerpTicketInfo {
  source?: string
  link?: string
  link_type?: string
}

interface SerpEvent {
  title: string
  date: SerpEventDate
  address: string[]
  link: string
  description?: string
  thumbnail?: string
  ticket_info?: SerpTicketInfo[]
  venue?: SerpEventVenue
  event_location_map?: unknown
}

interface SerpResponse {
  events_results?: SerpEvent[]
  error?: string
}

function inferCategory(title: string, description?: string): string {
  const text = `${title} ${description ?? ''}`.toLowerCase()
  if (/concert|music|band|live music|dj|festival|perform|song/.test(text)) return 'Music'
  if (/comedy|stand.?up|improv|laugh/.test(text)) return 'Comedy'
  if (/art|gallery|exhibit|museum|paint|sculpt/.test(text)) return 'Arts'
  if (/food|drink|wine|beer|tasting|restaurant|brunchdinner|chef|cocktail/.test(text)) return 'Food & Drink'
  if (/sport|run|race|marathon|yoga|fitness|hike|climb|bike|swim/.test(text)) return 'Sports'
  if (/market|fair|vendor|craft|flea|bazaar/.test(text)) return 'Markets'
  if (/networking|conference|startup|tech|professional/.test(text)) return 'Business'
  if (/family|kid|child|parent|baby|toddler/.test(text)) return 'Family'
  if (/class|workshop|learn|seminar|course|lecture|education/.test(text)) return 'Education'
  if (/grand opening|opening|launch|promo|sale|special event/.test(text)) return 'Local'
  if (/film|moviescreening|cinema/.test(text)) return 'Film'
  return 'Other'
}
function parseEventDate(event: SerpEvent): string {
  const when = event.date?.when ?? event.date?.start_date ?? ''
  if (!when) return new Date().toISOString()
  try { const d = new Date(when); if (!isNaN(d.getTime())) return d.toISOString() } catch {}
  try { const y = new Date().getFullYear(); const d = new Date(`${when} ${y}`); if (!isNaN(d.getTime())) return d.toISOString() } catch {}
  try { const m = when.match(/([A-Za-z]+ \d{1,2})/); if (m) { const d = new Date(`${m[1]} ${new Date().getFullYear()}`); if (!isNaN(d.getTime())) return d.toISOString() } } catch {}
  return new Date().toISOString()
}

import crypto from 'crypto'
function mapToRow(event: SerpEvent, city: string) {
  const title = event.title ?? 'Untitled Event'
  const venueName = event.venue?.name ?? event.address?.[0] ?? null
  const dateStr = parseEventDate(event)
  const description = event.description ?? null
  const dedupeKey = crypto.createHash('sha1').update(`google_events|${title.toLowerCase().trim()}|${(venueName ?? '').toLowerCase().trim()}|${dateStr.slice(0,10)}`).digest('hex')
  const ticketUrl = event.ticket_info?.find(t => t.link_type === 'buy')?.link ?? event.ticket_info?.[0]?.link ?? event.link ?? null
  return { title, date_start: dateStr, venue_name: venueName, city, category: inferCategory(title, description ?? ''), description, ai_description: null as string | null, image_url: event.thumbnail ?? null, ticket_url: ticketUrl, source: 'google_events', dedupe_key: dedupeKey, is_duplicate: false }
}

async function fetchEventsForCity(ctiy: string): Promise<SerpEvent[]> {
  if (!SERPAPI_KEY) { console.warn('[google-events] SERPAPI_KEY not set â skipping'); return [] }
  const params = new URLSearchParams({ engine: 'google_events', q: `events in ${ctiy}`, location: ctiy, hl: 'en', gl: 'us', api_key: SERPAPI_KEY, htichips: 'date:week' })
  try {
    const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) { console.error(`[google-events] HTTP ${res.status} for ${ctiy}`); return [] }
    const data: SerpResponse = await res.json()
    if (data.error) { console.error(`[google-events] API error: ${data.error}`); return [] }
    return data.events_results ?? []
  } catch (err) { console.error(`[google-events] Failed for ${ctiy}:`, err); return [] }
}

export async function syncGoogleEvents(db: Db, cities: string[]): Promise<void> {
  let total = 0
  for (const city of cities) {
    try {
      const events = await fetchEventsForCity(city)
      if (events.length === 0) continue
      const rows = events.map(e => mapToRow(e, city))
      const { error } = await db.from('events').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      if (error) { console.error(`[google-events] Upsert error for ${city}:`, error.message) }
      else { console.log(`[google-events] ${city}: +${rows.length} events`); total += rows.length }
    } catch (err) { console.error(`[google-events] Failed for ${city}:`, err) }
  }
  console.log(`[google-events] Done â ${total} total events upserted`)
}
