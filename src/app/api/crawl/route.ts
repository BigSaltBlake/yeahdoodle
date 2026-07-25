import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import crypto from 'crypto'

// Geohash encoder — precision 5 ≈ 4.9km × 4.9km cells
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
function encodeGeohash(lat: number, lng: number, precision = 5): string {
  let idx = 0, bit = 0, evenBit = true
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180
  let geohash = ''
  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2
      if (lng >= mid) { idx = idx * 2 + 1; lngMin = mid } else { idx = idx * 2; lngMax = mid }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid } else { idx = idx * 2; latMax = mid }
    }
    evenBit = !evenBit
    if (++bit === 5) { geohash += BASE32[idx]; bit = 0; idx = 0 }
  }
  return geohash
}

const SERPAPI_KEY = process.env.SERPAPI_KEY ?? ''

interface SerpEventDate { when?: string; start_date?: string }
interface SerpEventVenue { name?: string }
interface SerpTicketInfo { source?: string; link?: string; link_type?: string }
interface SerpEvent {
  title: string; date: SerpEventDate; address: string[]; link: string
  description?: string; thumbnail?: string; ticket_info?: SerpTicketInfo[]; venue?: SerpEventVenue
}
interface SerpResponse { events_results?: SerpEvent[]; error?: string }

function inferCategory(title: string, description?: string): string {
  const text = `${title} ${description ?? ''}`.toLowerCase()
  if (/concert|music|band|live music|dj|festival|perform/.test(text)) return 'Music'
  if (/comedy|stand.?up|improv/.test(text)) return 'Comedy'
  if (/art|gallery|exhibit|museum|paint/.test(text)) return 'Arts'
  if (/food|drink|wine|beer|tasting|restaurant|brunch|dinner/.test(text)) return 'Food & Drink'
  if (/sport|run|race|marathon|yoga|fitness|hike|climb/.test(text)) return 'Sports'
  if (/market|fair|vendor|craft|flea/.test(text)) return 'Markets'
  if (/networking|conference|startup|tech/.test(text)) return 'Business'
  if (/family|kid|child|parent|baby/.test(text)) return 'Family'
  if (/class|workshop|learn|seminar|course/.test(text)) return 'Education'
  if (/grand opening|opening|launch|promo/.test(text)) return 'Local'
  if (/film|movie|screening|cinema/.test(text)) return 'Film'
  return 'Other'
}

function parseEventDate(event: SerpEvent): string {
  const when = event.date?.when ?? event.date?.start_date ?? ''
  if (!when) return new Date().toISOString()
  try { const d = new Date(when); if (!isNaN(d.getTime())) return d.toISOString() } catch {}
  try { const d = new Date(`${when} ${new Date().getFullYear()}`); if (!isNaN(d.getTime())) return d.toISOString() } catch {}
  try {
    const match = when.match(/([A-Za-z]+ \d{1,2})/)
    if (match) { const d = new Date(`${match[1]} ${new Date().getFullYear()}`); if (!isNaN(d.getTime())) return d.toISOString() }
  } catch {}
  return new Date().toISOString()
}

async function fetchSerpEventsByCoords(lat: number, lng: number): Promise<SerpEvent[]> {
  if (!SERPAPI_KEY) return []
  const params = new URLSearchParams({
    engine: 'google_events', q: 'events near me',
    location: `${lat},${lng}`, hl: 'en', gl: 'us',
    api_key: SERPAPI_KEY, htichips: 'date:week',
  })
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return []
    const data: SerpResponse = await res.json()
    if (data.error) { console.error('[crawl] SerpAPI error:', data.error); return [] }
    return data.events_results ?? []
  } catch (err) { console.error('[crawl] SerpAPI fetch failed:', err); return [] }
}

// POST /api/crawl
// Body: { lat, lng, city? }
// Checks geohash_cache. If cold/stale (>6h), crawls SerpAPI by coords and upserts events.
export async function POST(req: NextRequest) {
  if (!SERPAPI_KEY) return NextResponse.json({ status: 'skipped', reason: 'SERPAPI_KEY not set' })
  if (!isSupabaseConfigured()) return NextResponse.json({ status: 'skipped', reason: 'Supabase not configured' })

  let body: { lat?: number; lng?: number; city?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { lat, lng, city } = body
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }

  const geohash = encodeGeohash(lat, lng, 5)
  const STALE_HOURS = 6

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cacheRow } = await (supabase as any)
    .from('geohash_cache').select('last_crawled_at, crawl_status, event_count')
    .eq('geohash', geohash).single()

  if (cacheRow?.last_crawled_at) {
    const ageHours = (Date.now() - new Date(cacheRow.last_crawled_at).getTime()) / 3_600_000
    if (ageHours < STALE_HOURS && cacheRow.crawl_status === 'done') {
      return NextResponse.json({ status: 'cached', geohash, event_count: cacheRow.event_count, age_hours: Math.round(ageHours) })
    }
  }

  // Mark as crawling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('geohash_cache').upsert(
    { geohash, lat_center: lat, lng_center: lng, crawl_status: 'crawling', updated_at: new Date().toISOString() },
    { onConflict: 'geohash' }
  )

  const serpEvents = await fetchSerpEventsByCoords(lat, lng)

  if (serpEvents.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('geohash_cache').upsert(
      { geohash, lat_center: lat, lng_center: lng, crawl_status: 'done', event_count: 0, last_crawled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'geohash' }
    )
    return NextResponse.json({ status: 'crawled', geohash, event_count: 0 })
  }

  const cityLabel = city ?? `${lat.toFixed(4)},${lng.toFixed(4)}`
  const rows = serpEvents.map(event => {
    const title = event.title ?? 'Untitled Event'
    const venueName = event.venue?.name ?? event.address?.[0] ?? null
    const dateStr = parseEventDate(event)
    const dedupeKey = crypto.createHash('sha1')
      .update(`google_events|${title.toLowerCase().trim()}|${(venueName ?? '').toLowerCase().trim()}|${dateStr.slice(0, 10)}`)
      .digest('hex')
    const ticketUrl = event.ticket_info?.find(t => t.link_type === 'buy')?.link ?? event.ticket_info?.[0]?.link ?? event.link ?? null
    return {
      title, date_start: dateStr, venue_name: venueName, city: cityLabel,
      lat: null as number | null, lng: null as number | null,
      category: inferCategory(title, event.description ?? ''),
      description: event.description ?? null, ai_description: null as string | null,
      image_url: event.thumbnail ?? null, ticket_url: ticketUrl,
      source: 'google_events', dedupe_key: dedupeKey, is_duplicate: false,
    }
  })

  const { error: upsertErr } = await supabase.from('events').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  const eventCount = upsertErr ? 0 : rows.length

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('geohash_cache').upsert(
    { geohash, lat_center: lat, lng_center: lng, crawl_status: upsertErr ? 'failed' : 'done', event_count: eventCount, last_crawled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'geohash' }
  )

  if (upsertErr) { console.error('[crawl] Upsert error:', upsertErr.message); return NextResponse.json({ status: 'error', error: upsertErr.message }, { status: 500 }) }
  console.log(`[crawl] ${geohash} (${lat.toFixed(4)},${lng.toFixed(4)}): +${eventCount} events`)
  return NextResponse.json({ status: 'crawled', geohash, event_count: eventCount })
}
