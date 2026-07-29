/**
 * Google Events via SerpAPI → Supabase sync
 *
 * Fetches upcoming events for each city using SerpAPI's Google Events engine,
 * which captures hyper-local events that don't appear on Ticketmaster —
 * farmers markets, open mic nights, gallery openings, community meetups, etc.
 *
 * SerpAPI free tier: 100 searches/month. Paid: $50/mo for 5000 searches.
 * We run 2 searches per city (tonight + this weekend) every 12 hours.
 */

import axios from 'axios'
import type { Db } from '../lib/db'

const SERP_BASE = 'https://serpapi.com/search.json'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SerpEvent {
  title?: string
  description?: string
  date?: { start_date?: string; when?: string }
  venue?: { name?: string; link?: string }
  address?: string[]
  link?: string
  thumbnail?: string
  ticket_info?: Array<{ source?: string; link?: string; price?: string }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function inferCategory(text: string): string {
  const t = text.toLowerCase()
  if (/music|concert|band|jazz|rock|hip.?hop|festival|dj|live show/.test(t)) return 'Music'
  if (/comedy|standup|stand-up|open.?mic|improv/.test(t)) return 'Comedy'
  if (/art|gallery|exhibit|museum|theater|theatre|dance|ballet|opera/.test(t)) return 'Arts & Culture'
  if (/food|drink|wine|beer|tasting|dinner|brunch|restaurant|cocktail|bar|market|farm/.test(t)) return 'Food & Drink'
  if (/sport|game|race|fitness|yoga|run|hike|outdoor|climb|5k|triathlon/.test(t)) return 'Sports & Outdoors'
  if (/night|club|lounge|dj|party|rave/.test(t)) return 'Nightlife'
  return 'Community'
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  try {
    const cleaned = dateStr.replace(/\s*[\u2013\-]\s*\d+:\d+\s*(AM|PM).*/i, '').trim()
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) return d.toISOString()
    const d2 = new Date(`${cleaned} ${new Date().getFullYear()}`)
    if (!isNaN(d2.getTime())) return d2.toISOString()
  } catch { /* ignore */ }
  return null
}

function parsePrice(ticketInfo: SerpEvent['ticket_info']): { min: number | null; isFree: boolean } {
  if (!ticketInfo?.length) return { min: null, isFree: false }
  for (const t of ticketInfo) {
    if (!t.price) continue
    if (t.price.toLowerCase().includes('free')) return { min: 0, isFree: true }
    const m = t.price.match(/\$(\d+(?:\.\d+)?)/)
    if (m) return { min: parseFloat(m[1]), isFree: false }
  }
  return { min: null, isFree: false }
}

function makeDedupeKey(title: string, city: string, dateStart: string | null): string {
  const titleSlug = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)
  const dateSlug  = dateStart ? dateStart.slice(0, 10) : 'nodate'
  const citySlug  = city.toLowerCase().replace(/[^a-z]/g, '').slice(0, 20)
  return `serpapi|${citySlug}|${dateSlug}|${titleSlug}`
}

function mapToRow(e: SerpEvent, city: string, index: number) {
  const title     = e.title ?? 'Local Event'
  const dateStart = parseDate(e.date?.start_date ?? e.date?.when)
  const { min: priceMin, isFree } = parsePrice(e.ticket_info)
  const venueName = e.venue?.name ?? e.address?.[0] ?? null
  const address   = e.address ? e.address.join(', ') : null
  const desc      = e.description ?? null
  const category  = inferCategory(title + ' ' + (desc ?? ''))

  return {
    external_id:    `serpapi_${city.toLowerCase().replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}_${index}`,
    source:         'serpapi',
    title,
    description:    desc,
    ai_description: null,
    category,
    date_start:     dateStart,
    date_end:       null,
    venue_name:     venueName,
    venue_address:  address,
    city,
    state:          null,
    lat:            null,
    lng:            null,
    image_url:      e.thumbnail ?? null,
    ticket_url:     e.ticket_info?.[0]?.link ?? e.link ?? null,
    price_min:      isFree ? 0 : priceMin,
    price_max:      null,
    is_free:        isFree || priceMin === 0,
    group_suitability: [],
    age_groups:        [],
    dedupe_key:     makeDedupeKey(title, city, dateStart),
    updated_at:     new Date().toISOString(),
  }
}

async function fetchSerpEvents(query: string, serpKey: string): Promise<SerpEvent[]> {
  try {
    const res = await axios.get(SERP_BASE, {
      params: { engine: 'google_events', q: query, hl: 'en', gl: 'us', api_key: serpKey },
      timeout: 15_000,
    })
    return (res.data?.events_results ?? []) as SerpEvent[]
  } catch (err) {
    console.warn(`[Google Events] SerpAPI error for "${query}":`, (err as Error).message)
    return []
  }
}

export async function syncGoogleEvents(db: Db, cities: string[]): Promise<void> {
  const serpKey = process.env.SERPAPI_KEY
  if (!serpKey) {
    console.log('[Google Events] SERPAPI_KEY not set — skipping.')
    return
  }

  let totalUpserted = 0
  let totalErrors   = 0

  for (const city of cities) {
    console.log(`[Google Events] Syncing ${city}...`)

    const queries = [
      `events tonight in ${city}`,
      `things to do this weekend in ${city}`,
    ]

    const seen = new Set<string>()
    const rows: ReturnType<typeof mapToRow>[] = []

    for (const q of queries) {
      const events = await fetchSerpEvents(q, serpKey)
      for (let i = 0; i < events.length; i++) {
        const e = events[i]
        const key = (e.title ?? '').toLowerCase().slice(0, 40)
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(mapToRow(e, city, rows.length))
      }
      await new Promise(r => setTimeout(r, 500))
    }

    if (!rows.length) {
      console.log(`[Google Events]   No events found for ${city}`)
      continue
    }

    const { error } = await db
      .from('events')
      .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })

    if (error) {
      console.error(`[Google Events] Upsert error for ${city}:`, error.message)
      totalErrors++
    } else {
      totalUpserted += rows.length
      console.log(`[Google Events]   +${rows.length} events for ${city} (${totalUpserted} total)`)
    }

    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`[Google Events] Done. Upserted: ${totalUpserted}, Errors: ${totalErrors}`)
}