import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { dateNightSearch, yelpToResult } from '@/lib/yelp'
import { getPlaceProfile, buildProfileQueries } from '@/lib/place-profile'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventRow {
  id: string
  title: string
  venue_name: string | null
  date_start: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
  category: string
  ticket_url: string | null
  image_url: string | null
  description: string | null
  ai_description: string | null
  distanceLabel?: string
  source?: string
}

interface CityQuery {
  name: string
  distanceLabel: string
  isLocal: boolean
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'Anytime'
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPrice(priceMin: number | null, priceMax: number | null, isFree: boolean): string {
  if (priceMin === 0 || isFree && priceMin !== null) return 'Free'
  if (priceMin === null) return ''
  if (priceMax && priceMax > priceMin) return `$${Math.round(priceMin)}–$${Math.round(priceMax)}`
  return `$${Math.round(priceMin)}`
}

// ---------------------------------------------------------------------------
// Geocoding utilities
// ---------------------------------------------------------------------------
interface GeoCity {
  city: string
  state: string
  displayName: string
  resultLat: number
  resultLng: number
  placeType: string
}

async function reverseGeocode(lat: number, lng: number, zoom: number): Promise<GeoCity | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}` +
      `&zoom=${zoom}&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) return null
    const data = await res.json()
    const addr = data.address ?? {}

    let placeType = 'region'
    let city = ''
    if (addr.city)       { city = addr.city;       placeType = 'city'    }
    else if (addr.town)  { city = addr.town;        placeType = 'town'    }
    else if (addr.village) { city = addr.village;   placeType = 'village' }
    else if (addr.hamlet)  { city = addr.hamlet;    placeType = 'hamlet'  }
    else if (addr.county)  { city = addr.county;    placeType = 'county'  }
    else if (addr.state)   { city = addr.state;     placeType = 'region'  }

    const state = addr.state || addr['ISO3166-2-lvl4']?.split('-')[1] || ''
    const displayName = [city, state].filter(Boolean).join(', ')
    const resultLat = parseFloat(data.lat ?? String(lat))
    const resultLng = parseFloat(data.lon ?? String(lng))
    return { city, state, displayName, resultLat, resultLng, placeType }
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

async function geocodeZipCode(zip: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json` +
      `&postalcode=${encodeURIComponent(zip)}&countrycodes=us&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

async function geocodeCity(query: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json` +
      `&q=${encodeURIComponent(query)}&countrycodes=us&limit=1&addressdetails=0`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

// Haversine distance in miles
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function driveTimeLabel(miles: number): string {
  if (miles < 2)  return 'Right here'
  if (miles < 5)  return `~${Math.round(miles)} mi away`
  const mins = Math.round(miles / 0.75)
  if (mins < 60) return `~${mins} min away`
  const hrs = Math.floor(mins / 60)
  const rem = Math.round((mins % 60) / 5) * 5
  return rem > 0 ? `~${hrs}h ${rem}m away` : `~${hrs}h away`
}

// ---------------------------------------------------------------------------
// Survey answer helpers
// ---------------------------------------------------------------------------
function budgetMax(answers: string[]): number | null {
  // Budget is always the last answer; also try fixed index as fallback
  const b = (answers[answers.length - 1] ?? '').trim()
  if (b === 'Free' || b.toLowerCase() === 'free') return 0
  if (b === '$25 or so' || b.includes('25')) return 25
  if (b === 'Around $50' || b.includes('50')) return 50
  // Legacy labels
  if (b.includes('75')) return 75
  if (b.toLowerCase().includes("sky") || b.toLowerCase().includes('limit')) return null
  return null
}

function categoryHints(answers: string[]): string[] | null {
  // Feeling target is at index 0 in the 2-question schema
  const feeling = (answers[0] ?? '').toLowerCase()
  if (feeling.includes('pumped') || feeling.includes('electric')) return ['Music', 'Nightlife', 'Sports & Outdoors']
  if (feeling.includes('relaxed') || feeling.includes('happy'))   return ['Food & Drink', 'Community', 'Nightlife']
  if (feeling.includes('curious') || feeling.includes('wow'))     return ['Arts & Culture', 'Community', 'Outdoors']
  if (feeling.includes('laughing') || feeling.includes('social')) return ['Comedy', 'Community', 'Arts & Culture']
  return null
}

function getExpType(answers: string[]): string {
  // Feeling target is at index 0 in the 2-question schema
  return answers[0] ?? ''
}

function getDateRange(timeframe: string): { start: Date; end: Date } {
  const now   = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  // 'Now' and legacy 'Tonight' — 18-hour rolling window
  if (timeframe === 'Now' || timeframe === 'Tonight') {
    const end = new Date(now.getTime() + 18 * 60 * 60 * 1000)
    return { start: now, end }
  }
  // Legacy 'Tomorrow'
  if (timeframe === 'Tomorrow') {
    const start = new Date(now.getTime() + 18 * 60 * 60 * 1000)
    const end   = new Date(now.getTime() + 42 * 60 * 60 * 1000)
    return { start, end }
  }
  // 'Soon' and legacy 'This weekend' — next Friday–Sunday
  if (timeframe === 'Soon' || timeframe === 'This weekend') {
    const dow = now.getDay()
    const daysUntilFri = dow === 0 ? 6 : (5 - dow + 7) % 7 || 7
    const friday = new Date(today)
    friday.setDate(friday.getDate() + daysUntilFri)
    const sunday = new Date(friday)
    sunday.setDate(sunday.getDate() + 2)
    // End late Sunday in the US (Monday 06:00 UTC covers midnight everywhere)
    sunday.setHours(30, 0, 0, 0)
    const start = (dow === 0 || dow === 6) ? now : friday
    return { start, end: sunday }
  }
  // 'Next Week' — 3–14 days out
  if (timeframe === 'Next Week') {
    const start = new Date(today)
    start.setDate(start.getDate() + 3)
    const end = new Date(today)
    end.setDate(end.getDate() + 14)
    return { start, end }
  }
  // 'Planning Ahead' — 1–8 weeks out
  if (timeframe === 'Planning Ahead') {
    const start = new Date(today)
    start.setDate(start.getDate() + 7)
    const end = new Date(today)
    end.setDate(end.getDate() + 60)
    return { start, end }
  }
  // 'Planning a Trip' — 2 weeks to 3 months out
  if (timeframe === 'Planning a Trip') {
    const start = new Date(today)
    start.setDate(start.getDate() + 14)
    const end = new Date(today)
    end.setDate(end.getDate() + 90)
    return { start, end }
  }
  // 'Default' — now through next 3 days (no timeframe filter set)
  if (timeframe === 'Default') {
    const end = new Date(today)
    end.setDate(end.getDate() + 3)
    return { start: now, end }
  }
  // Legacy 'Coming weeks' — 4-week lookahead
  const end = new Date(today)
  end.setDate(end.getDate() + 28)
  return { start: now, end }
}

function getSerpQueriesForCity(timeframe: string, city: string, _isLocal: boolean, expType = ''): string[] {
  const when =
    timeframe === 'Now'              ? 'tonight' :
    timeframe === 'Tonight'          ? 'tonight' :
    timeframe === 'Tomorrow'         ? 'tomorrow' :
    timeframe === 'Soon'             ? 'this weekend' :
    timeframe === 'This weekend'     ? 'this weekend' :
    timeframe === 'Next Week'        ? 'next week' :
    timeframe === 'Planning Ahead'   ? 'upcoming' :
    timeframe === 'Planning a Trip'  ? 'upcoming' :
    timeframe === 'Default'          ? 'this weekend' :
    'upcoming'

  const exp = expType.toLowerCase()

  // Category-specific queries — mapped from feeling target (psychology-first survey)
  if (exp.includes('pumped') || exp.includes('electric')) {
    return [
      `live music concerts ${when} in ${city}`,
      `nightlife events parties clubs ${when} near ${city}`,
      `best live music venues bars ${city}`,
    ]
  }
  if (exp.includes('relaxed') || exp.includes('happy')) {
    return [
      `restaurants dinner ${when} in ${city}`,
      `food drink events wine tasting dining ${when} near ${city}`,
      `best date night restaurants bars open ${city}`,
    ]
  }
  if (exp.includes('curious') || exp.includes('wow')) {
    return [
      `art events galleries museums ${when} in ${city}`,
      `unique experiences theater cultural ${when} near ${city}`,
      `best arts culture unique things to do ${city}`,
    ]
  }
  if (exp.includes('laughing') || exp.includes('social')) {
    return [
      `comedy shows stand-up ${when} in ${city}`,
      `comedy clubs social events activities ${when} near ${city}`,
      `best comedy social hangout spots ${city}`,
    ]
  }

  // Default: generic event queries
  return [
    `events ${when} in ${city}`,
    `date night ideas things to do ${when} near ${city}`,
    `best activities bars restaurants open near ${city}`,
  ]
}

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------
function inferCategory(text: string): string {
  const t = text.toLowerCase()
  if (/music|concert|band|jazz|rock|hip.?hop|festival|dj|live show/.test(t))          return 'Music'
  if (/comedy|standup|stand-up|open.?mic|improv/.test(t))                              return 'Comedy'
  if (/art|gallery|exhibit|museum|theater|theatre|dance|ballet|opera/.test(t))         return 'Arts & Culture'
  if (/food|drink|wine|beer|tasting|dinner|brunch|restaurant|cocktail|bar/.test(t))    return 'Food & Drink'
  if (/hike|hiking|trail|kayak|paddle|climb|fish|camp|nature|park|outdoor|river|lake/.test(t)) return 'Outdoors'
  if (/sport|game|race|fitness|yoga|run/.test(t))                                      return 'Sports & Outdoors'
  if (/night|club|lounge|dj|party/.test(t))                                            return 'Nightlife'
  return 'Community'
}

const CATEGORY_FALLBACK: Record<string, string> = {
  'Music':         'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=400&h=240&fit=crop',
  'Arts & Culture':'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=240&fit=crop',
  'Food & Drink':  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=240&fit=crop',
  'Outdoors':      'https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?w=400&h=240&fit=crop',
  'Sports & Outdoors': 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&h=240&fit=crop',
  'Nightlife':     'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?w=400&h=240&fit=crop',
  'Community':     'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=400&h=240&fit=crop',
  'Comedy':        'https://images.unsplash.com/photo-1527224538127-2104bb71c51b?w=400&h=240&fit=crop',
}

function fallbackImg(category: string): string {
  return CATEGORY_FALLBACK[category] ?? CATEGORY_FALLBACK['Community']!
}

// ---------------------------------------------------------------------------
// Free image enrichment — no paid API credits required
// ---------------------------------------------------------------------------

/** Pull og:image from a ticket/event page (Ticketmaster, Eventbrite, venue sites, etc.) */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; YeahDoodle/1.0; +https://yeahdoodle.com)',
        Accept: 'text/html',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    // og:image is always in <head> — only parse the first chunk
    const html = (await res.text()).slice(0, 25000)
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    const img = m?.[1]?.trim()
    // Skip placeholder/icon images
    return img && !/placeholder|logo|icon|blank/i.test(img) ? img : null
  } catch {
    return null
  }
}

/** Unsplash free-tier keyword search (requires UNSPLASH_ACCESS_KEY env var) */
async function fetchUnsplashImage(query: string, accessKey: string): Promise<string | null> {
  try {
    const url =
      `https://api.unsplash.com/photos/random` +
      `?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { urls?: { regular?: string } }
    return data.urls?.regular ?? null
  } catch {
    return null
  }
}

/**
 * Enrich the 3 final picks with better images — free, no Serper credits.
 * Chain: og:image from ticketUrl → Unsplash keyword search → keep existing fallback
 */
async function enrichPickImages(
  picks: Array<{ title: string; venue?: string; imageUrl: string; ticketUrl?: string | null }>,
): Promise<void> {
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY

  await Promise.all(
    picks.map(async (pick) => {
      // Already has a real (non-fallback) image — nothing to do
      if (!pick.imageUrl.includes('unsplash.com')) return

      // 1. OG image from the event's ticket/listing page — event-specific, free
      if (pick.ticketUrl) {
        const og = await fetchOgImage(pick.ticketUrl)
        if (og) { pick.imageUrl = og; return }
      }

      // 2. Unsplash keyword search — beautiful stock photo, free tier
      if (unsplashKey) {
        const keywords = `${pick.title} ${pick.venue ?? ''}`.replace(/[^\w\s]/g, ' ').trim()
        const img = await fetchUnsplashImage(keywords, unsplashKey)
        if (img) { pick.imageUrl = img; return }
      }

      // 3. Keep existing static category fallback — nothing to change
    }),
  )
}

// ---------------------------------------------------------------------------
// Ticketmaster Discovery API — free live event source (5000 calls/day)
// ---------------------------------------------------------------------------
function tmBestImage(images: Array<{ url: string; width: number; height: number; ratio?: string }> | undefined): string | null {
  if (!images?.length) return null
  // Prefer 16_9 ratio at ~800px wide; otherwise just widest image
  const pref = images.find(i => i.ratio === '16_9' && i.width >= 640)
  return (pref ?? images.reduce((best, i) => i.width > best.width ? i : best, images[0])).url
}

function tmCategory(segmentName: string | undefined): string {
  const s = (segmentName ?? '').toLowerCase()
  if (s === 'music')                    return 'Music'
  if (s === 'sports')                   return 'Sports & Outdoors'
  if (s === 'arts & theatre')           return 'Arts & Culture'
  if (s === 'film' || s === 'film/tv')  return 'Arts & Culture'
  if (s === 'family')                   return 'Community'
  return 'Community'
}

async function fetchTicketmasterLive(
  cities: CityQuery[],
  dateStart: Date,
  dateEnd: Date,
): Promise<EventRow[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey || cities.length === 0) return []

  const results: EventRow[] = []
  const seen = new Set<string>()

  await Promise.all(
    cities.map(async ({ name: cityName, distanceLabel }) => {
      try {
        // Geocode city → latlong so TM can find areas like "Jackson Hole"
        // (TM's city DB uses "Jackson, WY" not "Jackson Hole, WY")
        const geo = await geocodeCity(cityName)
        const paramObj: Record<string, string> = {
          apikey:        apiKey,
          countryCode:   'US',
          size:          '20',
          sort:          'date,asc',
          startDateTime: dateStart.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          endDateTime:   dateEnd.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        }
        if (geo) {
          paramObj.latlong = `${geo.lat},${geo.lng}`
          paramObj.radius  = '50'
          paramObj.unit    = 'miles'
        } else {
          // fallback: parse "City Name, ST" string
          const commaIdx = cityName.lastIndexOf(',')
          paramObj.city  = commaIdx >= 0 ? cityName.slice(0, commaIdx).trim() : cityName.trim()
          const tmState  = commaIdx >= 0 ? cityName.slice(commaIdx + 1).trim() : ''
          if (tmState) paramObj.stateCode = tmState
        }
        const params = new URLSearchParams(paramObj)
        const res = await fetch(
          `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = await res.json()
        const events: unknown[] = data._embedded?.events ?? []

        for (let i = 0; i < events.length; i++) {
          const e = events[i] as Record<string, unknown>
          const title = (e.name as string) ?? 'Event'
          const key   = title.toLowerCase().slice(0, 40)
          if (seen.has(key)) continue
          seen.add(key)

          const classification = ((e.classifications as unknown[] | undefined)?.[0] ?? {}) as Record<string, unknown>
          const segment = ((classification.segment ?? {}) as Record<string, unknown>).name as string | undefined
          const category = tmCategory(segment)

          const dates = (e.dates as Record<string, unknown> | undefined)
          const startObj = (dates?.start as Record<string, unknown> | undefined)
          const dateIso = (startObj?.dateTime as string | null) ??
            (startObj?.localDate ? `${startObj.localDate}T${startObj?.localTime ?? '00:00:00'}` : null)

          const priceRanges = e.priceRanges as Array<{ min: number; max: number }> | undefined
          const priceMin = priceRanges?.[0]?.min ?? null
          const priceMax = priceRanges?.[0]?.max ?? null
          const isFree   = priceMin === 0

          const venues   = (e._embedded as Record<string, unknown> | undefined)?.venues as Array<Record<string, unknown>> | undefined
          const venue    = venues?.[0]
          const venueName = (venue?.name as string | undefined) ?? null

          const images   = e.images as Array<{ url: string; width: number; height: number; ratio?: string }> | undefined
          const imgUrl   = tmBestImage(images) ?? fallbackImg(category)

          results.push({
            id:           `tm_${(e.id as string) ?? `${cityName}_${i}`}`,
            title,
            venue_name:   venueName,
            date_start:   dateIso,
            is_free:      isFree,
            price_min:    isFree ? 0 : priceMin,
            price_max:    priceMax,
            category,
            ticket_url:   (e.url as string | null) ?? null,
            image_url:    imgUrl,
            description:  (e.info as string | null) ?? (e.description as string | null) ?? null,
            ai_description: null,
            distanceLabel,
            source:       'live',
          })
        }
      } catch (err) {
        console.error('[recommend] Ticketmaster fetch error:', err)
      }
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// SerpAPI date parsing helpers
// ---------------------------------------------------------------------------
function parseGoogleEventDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  try {
    const cleaned = dateStr.replace(/\s*[–-]\s*\d+:\d+\s*(AM|PM).*/i, '').trim()
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) return d.toISOString()
    const withYear = `${cleaned} ${new Date().getFullYear()}`
    const d2 = new Date(withYear)
    if (!isNaN(d2.getTime())) return d2.toISOString()
  } catch { /* */ }
  return null
}

function parseSerpPrice(
  ticketInfo: Array<{ source?: string; link?: string; price?: string }> | undefined,
): number | null {
  if (!ticketInfo?.length) return null
  for (const t of ticketInfo) {
    if (!t.price) continue
    if (t.price.toLowerCase().includes('free')) return 0
    const m = t.price.match(/\$(\d+)/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

// ---------------------------------------------------------------------------
// Live SerpAPI crawl
// ---------------------------------------------------------------------------
async function fetchLiveSerpEvents(cities: CityQuery[], timeframe = 'Tonight', expType = ''): Promise<EventRow[]> {
  // Prefer SerpAPI Google Events engine (structured data); fall back to Serper.dev /search
  const serpApiKey  = process.env.SERPAPI_KEY
  const serperKey   = process.env.SERPER_API_KEY
  const hasSerp     = !!serpApiKey
  const hasSerper   = !!serperKey
  if ((!hasSerp && !hasSerper) || cities.length === 0) return []

  const results: EventRow[] = []
  const seen = new Set<string>()

  await Promise.all(
    cities.flatMap(({ name: cityName, distanceLabel, isLocal }) => {
      const queries = getSerpQueriesForCity(timeframe, cityName, isLocal, expType)

      return queries.map(async (q, qi) => {
        try {
          let events: unknown[] = []

          if (hasSerp) {
            // SerpAPI Google Events — returns structured events_results[]
            const url = `https://serpapi.com/search?engine=google_events&q=${encodeURIComponent(q)}&hl=en&gl=us&api_key=${serpApiKey}`
            const res = await fetch(url, { cache: 'no-store' })
            if (res.ok) {
              const data = await res.json()
              events = (data.events_results ?? []) as unknown[]
            }
          }

          if (events.length === 0 && hasSerper) {
            // Fallback: Serper.dev /search — returns data.events[] when Google events panel triggers
            const res = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: { 'X-API-KEY': serperKey!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ q, gl: 'us', hl: 'en', num: 10 }),
              cache: 'no-store',
            })
            if (res.ok) {
              const data = await res.json()
              events = (data.events ?? []) as unknown[]
            }
          }

          for (let i = 0; i < events.length; i++) {
            const e = events[i] as Record<string, unknown>
            const title = (e.title as string) ?? 'Local Event'
            const key = title.toLowerCase().slice(0, 40)
            if (seen.has(key)) continue
            seen.add(key)

            const ticketInfo = e.ticket_info as Array<{ source?: string; link?: string; price?: string }> | undefined
            const date = e.date as Record<string, string> | undefined
            const venue = e.venue as Record<string, string> | undefined
            const address = e.address as string[] | undefined

            const price = parseSerpPrice(ticketInfo)
            const isFree = price === 0 || (e.description as string ?? '').toLowerCase().includes('free')
            const dateStart = parseGoogleEventDate(date?.start_date ?? date?.when)

            // Activity queries (qi >= 1) typically have no date — mark as timeless activity
            const isActivity = !dateStart && qi >= 1

            const thumbnail = (e.thumbnail ?? null) as string | null
            const imgUrl = thumbnail ?? fallbackImg(inferCategory(title + ' ' + ((e.description as string) ?? '')))

            results.push({
              id: `live_${cityName.slice(0, 6).replace(/\s/g, '')}_${qi}_${i}`,
              title,
              venue_name: venue?.name ?? address?.[0] ?? null,
              date_start: dateStart,
              is_free: isFree,
              price_min: isFree ? 0 : price,
              price_max: null,
              category: inferCategory(title + ' ' + ((e.description as string) ?? '')),
              ticket_url: (ticketInfo?.[0]?.link ?? e.link ?? null) as string | null,
              image_url: imgUrl,
              description: (e.description ?? null) as string | null,
              ai_description: null,
              distanceLabel,
              source: isActivity ? 'activity' : 'live',
            })
          }
        } catch (err) {
          console.error('[recommend] SerpAPI fetch error:', err)
        }
      })
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// POST /api/recommend
// Body: { city: string, answers: string[], lat?: number, lng?: number }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      city?: string
      answers: string[]
      lat?: number
      lng?: number
      filters?: { budget?: string; crew?: string; when?: string }
    }

    const { answers } = body
    let city     = body.city ?? ''
    let lat      = body.lat
    let lng      = body.lng
    let hasGps   = typeof lat === 'number' && typeof lng === 'number'

    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: 'answers required' }, { status: 400 })
    }

    // ── Zip code → GPS ──────────────────────────────────────────────────────
    if (!hasGps && /^\d{5}$/.test(city.trim())) {
      const zipGeo = await geocodeZipCode(city.trim())
      if (zipGeo) { lat = zipGeo.lat; lng = zipGeo.lng; hasGps = true; city = '' }
    }

    // ── City string → GPS (forward geocode) ─────────────────────────────────
    if (!hasGps && city.trim()) {
      const cityGeo = await geocodeCity(city.trim())
      if (cityGeo) { lat = cityGeo.lat; lng = cityGeo.lng; hasGps = true }
    }

    const filters   = body.filters ?? {}
    const timeframe = filters.when || 'Default'
    const { start: dateStart, end: dateEnd } = getDateRange(timeframe)
    const maxBudget = budgetMax(filters.budget ? [filters.budget] : [])
    const catHints  = categoryHints(answers)
    const expType   = getExpType(answers)

    // ── 1. Resolve location ──────────────────────────────────────────────────
    let resolvedCity = city.trim()
    let geoDisplayName = city.trim()
    let cities: CityQuery[] = []

    if (hasGps && typeof lat === 'number' && typeof lng === 'number') {
      const [localGeo, regionalGeo] = await Promise.all([
        reverseGeocode(lat, lng, 14),
        reverseGeocode(lat, lng, 8),
      ])

      const localCity    = localGeo?.city    || ''
      const regionalCity = regionalGeo?.city || ''

      const regionalDist = regionalGeo
        ? haversine(lat, lng, regionalGeo.resultLat, regionalGeo.resultLng)
        : null

      geoDisplayName = localGeo?.displayName || regionalGeo?.displayName || 'your area'
      resolvedCity = resolvedCity || regionalCity || localCity

      if (localCity) {
        cities.push({ name: localCity, distanceLabel: 'Right here', isLocal: true })
      }
      if (regionalCity && regionalCity !== localCity) {
        cities.push({
          name:          regionalCity,
          distanceLabel: regionalDist ? driveTimeLabel(regionalDist) : 'Nearby',
          isLocal:       false,
        })
      }
      // If geocoding returned nothing useful, fall back to provided city string
      if (cities.length === 0 && resolvedCity) {
        cities.push({ name: resolvedCity, distanceLabel: 'Nearby', isLocal: true })
      }
    } else if (resolvedCity) {
      cities = [{ name: resolvedCity, distanceLabel: '', isLocal: false }]
    }

    // ── 2. Parallel fetches ──────────────────────────────────────────────────
    const liveEventsPromise = cities.length > 0
      ? Promise.all([
          fetchLiveSerpEvents(cities, timeframe, expType),
          fetchTicketmasterLive(cities, dateStart, dateEnd),
        ]).then(([serp, tm]) => {
          // Merge: dedupe by title, Ticketmaster results first (richer data)
          const combined: EventRow[] = []
          const titleSet = new Set<string>()
          for (const e of [...tm, ...serp]) {
            const k = e.title.toLowerCase().slice(0, 40)
            if (!titleSet.has(k)) { titleSet.add(k); combined.push(e) }
          }
          return combined
        })
      : Promise.resolve([] as EventRow[])

    // Place profile — fetch in parallel, used to enrich Serper queries below
    const profilePromise = hasGps && typeof lat === 'number' && typeof lng === 'number'
      ? getPlaceProfile(lat, lng, resolvedCity, '').catch(() => null)
      : Promise.resolve(null)

    // Yelp: open-now activities always available when we have GPS
    const yelpPromise = hasGps && typeof lat === 'number' && typeof lng === 'number'
      ? dateNightSearch({ lat, lng, maxResults: 6 }).then(bizs =>
          bizs.map(b => {
            const r = yelpToResult(b, lat!, lng!)
            return {
              id:             r.id,
              title:          r.title,
              venue_name:     r.venue,
              date_start:     null,
              is_free:        false,
              price_min:      null,
              price_max:      null,
              category:       r.category,
              ticket_url:     r.ticket_url,
              image_url:      r.image_url,
              description:    r.description,
              ai_description: null,
              distanceLabel:  r.drive_label,
              source:         'activity',
            } satisfies EventRow
          })
        )
      : Promise.resolve([] as EventRow[])

    let dbRowsPromise: Promise<EventRow[]> = Promise.resolve([])
    if (isSupabaseConfigured() && resolvedCity) {
      let q = supabase
        .from('events')
        .select('*')
        .ilike('city', `%${resolvedCity}%`)
        .eq('is_duplicate', false)
        .gte('date_start', dateStart.toISOString())
        .lte('date_start', dateEnd.toISOString())
        .order('date_start', { ascending: true })
        .limit(40)

      if (catHints)           q = q.in('category', catHints)
      if (maxBudget !== null) q = q.or(`is_free.eq.true,price_min.lte.${maxBudget}`)

      dbRowsPromise = Promise.resolve(q).then(({ data }) => (data ?? []) as EventRow[])
    }

    const [liveEvents, dbRows, yelpRows, placeProfile] = await Promise.all([
      liveEventsPromise, dbRowsPromise, yelpPromise, profilePromise,
    ])

    // If we have a profile, fire one additional profile-specific Serper search
    const profileActivityRows: EventRow[] = []
    if (placeProfile && (process.env.SERPER_API_KEY || process.env.SERPAPI_KEY)) {
      const profileQs = buildProfileQueries(placeProfile, 'anytime')
      if (profileQs.length > 0) {
        try {
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': process.env.SERPER_API_KEY ?? '', 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: profileQs[0], num: 5 }),
            signal: AbortSignal.timeout(6000),
          })
          if (res.ok) {
            const data = await res.json()
            const organic = (data.organic ?? []) as Record<string, string>[]
            organic.slice(0, 3).forEach((r, i) => {
              profileActivityRows.push({
                id:             `profile-${i}`,
                title:          r.title ?? 'Local Activity',
                venue_name:     null,
                date_start:     null,
                is_free:        false,
                price_min:      null,
                price_max:      null,
                category:       'Activities',
                ticket_url:     r.link ?? null,
                image_url:      null,
                description:    r.snippet ?? null,
                ai_description: null,
                distanceLabel:  '',
                source:         'activity',
              })
            })
          }
        } catch { /* non-fatal */ }
      }
    }

    // ── 3. Merge — live first (fresher), then DB ─────────────────────────────
    const nowMs    = Date.now()
    const dbTitles = new Set(dbRows.map(r => r.title.toLowerCase().slice(0, 40)))
    const seenLive = new Set<string>()

    const uniqueLive = liveEvents.filter(e => {
      const key = e.title.toLowerCase().slice(0, 40)
      if (dbTitles.has(key) || seenLive.has(key)) return false
      // Only drop events that are clearly in the past (more than 1 hour ago)
      // Do NOT filter future events — SerpAPI queries are already scoped by timeframe keyword
      // and local-time vs UTC mismatches would kill valid results
      if (e.date_start && e.source !== 'activity') {
        const t = new Date(e.date_start).getTime()
        if (!isNaN(t) && t < nowMs - 3_600_000) return false
      }
      seenLive.add(key)
      return true
    })

    // Dedupe Yelp rows against live events by title
    const yelpUnique = yelpRows.filter(y => {
      const key = y.title.toLowerCase().slice(0, 40)
      return !seenLive.has(key) && !dbTitles.has(key)
    })

    // Include profile-specific activity results (de-duped against live events)
    const profileUnique = profileActivityRows.filter(p => {
      const key = p.title.toLowerCase().slice(0, 40)
      return !seenLive.has(key) && !dbTitles.has(key)
    })

    let rows: EventRow[] = [...uniqueLive, ...dbRows, ...yelpUnique, ...profileUnique]

    // Sort to boost category matches to the top — ensures AI sees relevant candidates first
    if (catHints) {
      rows.sort((a, b) => {
        const aMatch = catHints.includes(a.category) ? 0 : 1
        const bMatch = catHints.includes(b.category) ? 0 : 1
        return aMatch - bMatch
      })
    }

    // Safety net: if SerpAPI returned events but the past-event filter killed them all,
    // include everything (better to show something than nothing)
    if (rows.length < 3 && liveEvents.length > 0) {
      const allDeduped = liveEvents.filter(e => {
        const key = e.title.toLowerCase().slice(0, 40)
        return !dbTitles.has(key)
      })
      if (allDeduped.length > rows.length) {
        rows = [...allDeduped, ...dbRows]
      }
    }

    // ── 4. Radius expansion — if thin results, also query regional city in DB ─
    if (rows.length < 5 && hasGps && isSupabaseConfigured()) {
      const regionalCity = cities.find(c => !c.isLocal)?.name
      if (regionalCity && regionalCity !== resolvedCity) {
        const { data: expansion } = await supabase
          .from('events')
          .select('*')
          .ilike('city', `%${regionalCity}%`)
          .eq('is_duplicate', false)
          .gte('date_start', dateStart.toISOString())
          .order('date_start', { ascending: true })
          .limit(40)

        const expandedRows = ((expansion ?? []) as EventRow[]).filter(
          r => !dbTitles.has(r.title.toLowerCase().slice(0, 40)) &&
               !uniqueLive.some(e => e.title.toLowerCase().slice(0, 40) === r.title.toLowerCase().slice(0, 40))
        )
        rows = [...rows, ...expandedRows]
      }
    }

    // ── 5. Standard DB fallback for thin results ─────────────────────────────
    if (rows.length < 3 && isSupabaseConfigured() && resolvedCity) {
      const { data: fallback } = await supabase
        .from('events')
        .select('*')
        .ilike('city', `%${resolvedCity}%`)
        .eq('is_duplicate', false)
        .gte('date_start', dateStart.toISOString())
        .order('date_start', { ascending: true })
        .limit(40)

      const fallbackRows = (fallback ?? []) as EventRow[]
      if (fallbackRows.length > rows.length) rows = [...uniqueLive, ...fallbackRows]
    }

    // ── 6. Last-resort: broad SerpAPI sweep — never return empty ────────────
    const serperKey = process.env.SERPER_API_KEY
    if (rows.length === 0) {
      const fallbackCity =
        cities.length > 0
          ? { ...(cities.find(c => !c.isLocal) ?? cities[0]), isLocal: true }
          : resolvedCity
            ? { name: resolvedCity, distanceLabel: 'Nearby', isLocal: true }
            : null

      if (fallbackCity) {
        // 6a. Broad events search
        const broadEvents = await fetchLiveSerpEvents([fallbackCity], 'Planning Ahead')
        if (broadEvents.length > 0) {
          rows = broadEvents
        } else if (serperKey) {
          // 6b. Organic activities — scenic walks, things to do, etc.
          const actQuery = `best things to do near ${fallbackCity.name}`
          const actRes = await fetch('https://google.serper.dev/search', {
            method:  'POST',
            headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ q: actQuery, gl: 'us', hl: 'en', num: 8 }),
            cache:   'no-store',
          })
          if (actRes.ok) {
            const actData = await actRes.json()
            const organic = (actData.organic ?? []) as Array<{
              title?: string; snippet?: string; link?: string; imageUrl?: string; address?: string
            }>
            rows = organic
              .filter(r => r.title && r.snippet)
              .slice(0, 5)
              .map((r, i) => ({
                id:           `activity_fallback_${i}`,
                title:         r.title ?? 'Local Activity',
                venue_name:    r.address ?? null,
                date_start:    null,
                is_free:       true,
                price_min:     null,
                price_max:     null,
                category:      inferCategory(`${r.title ?? ''} ${r.snippet ?? ''}`),
                ticket_url:    r.link ?? null,
                image_url:     r.imageUrl ?? fallbackImg(inferCategory(r.title ?? '')),
                description:   r.snippet?.slice(0, 200) ?? null,
                ai_description: null,
                distanceLabel: 'Nearby',
                source:        'activity',
              }))
          }
        }
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ picks: [] })
    }

    // ── 7. Build AI prompt ───────────────────────────────────────────────────
    const locationLabel = hasGps
      ? `near your location (${geoDisplayName})`
      : `in ${resolvedCity}`

    const eventList = rows
      .map((r, i) => {
        const price = r.price_min === 0 ? 'Free' : r.price_min ? `$${r.price_min}` : 'price unknown'
        const date  = r.date_start
          ? new Date(r.date_start).toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric',
            })
          : 'Anytime'
        const desc  = r.ai_description ?? r.description?.slice(0, 120) ?? ''
        const src   = r.source === 'activity' ? '[activity]' : r.source === 'facebook' ? '[facebook]' : r.id.startsWith('live_') ? '[live]' : '[db]'
        const dist  = r.distanceLabel ? ` | ${r.distanceLabel}` : ''
        return `${i + 1}. ID:${r.id} ${src} | ${r.title} | ${r.venue_name ?? 'Local venue'} | ${date} | ${price} | ${r.category}${dist}${desc ? ` | ${desc}` : ''}`
      })
      .join('\n')

    // Label map for the 2-question psychology-first survey
    const labelMap = ['Feeling target', 'Vibe killer (avoid)']
    const answerSummary = [
      ...answers.map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`),
      ...(filters.when   ? [`- Timing preference: ${filters.when}`]   : []),
      ...(filters.crew   ? [`- Crew: ${filters.crew}`]                : []),
      ...(filters.budget ? [`- Budget: ${filters.budget}`]            : []),
    ].join('\n')
    const killSwitch = answers[1] ?? ''

    const timeframeInstruction =
      timeframe === 'Now'             ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tonight'         ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tomorrow'        ? 'Prefer events happening TOMORROW.' :
      timeframe === 'Soon'            ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
      timeframe === 'This weekend'    ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
      timeframe === 'Next Week'       ? 'Prefer events happening NEXT WEEK (3–14 days from now).' :
      timeframe === 'Planning Ahead'  ? 'Show events across the next 2–8 weeks — the user is calendar-planning, highlight anything worth booking early.' :
      timeframe === 'Planning a Trip' ? 'Show a variety of events 2 weeks to 3 months out — user is trip planning, include destination-worthy or unique experiences.' :
      timeframe === 'Default'         ? 'Show the best options happening in the next 2–3 days — no specific time constraint, so prioritise quality and relevance.' :
      'Show a variety across the coming weeks — the user is calendar-planning, so spread dates out and highlight anything worth booking early.'

    const hasActivities = rows.some(r => r.source === 'activity')
    const activityNote  = hasActivities
      ? " Some entries are [activity] — timeless things to do (hiking, kayaking, tours, etc.) rather than ticketed events. Include these if they match the user's vibe."
      : ''

    const prompt = `You are a local expert helping someone find their perfect outing.

User preferences:
${answerSummary}

Events and activities available ${locationLabel} for ${timeframe.toLowerCase()}:
${eventList}

Pick the 3 BEST events or activities that match this person's vibe. ${timeframeInstruction}${activityNote} CRITICAL: The user wants to feel "${expType}" — at least 2 of your 3 picks MUST evoke this feeling. They specifically want to AVOID: "${killSwitch}" — do not recommend anything that triggers this dealbreaker. Only deviate from their feeling target if the list genuinely has no matching options. Consider crew size and budget constraints. You may add 1 wildcard pick for variety, but their stated feeling takes absolute priority.

Return ONLY a valid JSON array — no other text, no markdown, no explanation:
[
  {"id":"<exact event ID from the list above>","rank":1,"pitch":"<one punchy sentence, max 25 words, why this is perfect for them>"},
  {"id":"<id>","rank":2,"pitch":"<...>"},
  {"id":"<id>","rank":3,"pitch":"<...>"}
]`

    const anthropicKey = process.env.ANTHROPIC_API_KEY

    // ── 8. No API key: return top 3 ──────────────────────────────────────────
    if (!anthropicKey) {
      const top3 = rows.slice(0, 3).map((r, i) => ({
        id:             r.id,
        rank:           i + 1,
        pitch:          r.ai_description?.slice(0, 120) ?? r.description?.slice(0, 120) ?? 'A great local experience.',
        title:          r.title,
        venue:          r.venue_name ?? '',
        dateFormatted:  r.date_start ? formatDate(r.date_start) : 'Anytime',
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl:      r.ticket_url,
        imageUrl:       r.image_url ?? fallbackImg(r.category),
        category:       r.category,
        source:         r.source,
        distanceLabel:  r.distanceLabel,
      }))
      await enrichPickImages(top3)
      return NextResponse.json({ picks: top3 })
    }

    // ── 9. Call Claude Haiku ─────────────────────────────────────────────────
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) throw new Error(`Anthropic API error: ${aiRes.status}`)

    const aiData  = await aiRes.json()
    const rawText: string = aiData.content?.[0]?.text ?? '[]'

    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in AI response')

    const aiPicks   = JSON.parse(jsonMatch[0]) as Array<{ id: string; rank: number; pitch: string }>
    const eventById = Object.fromEntries(rows.map(r => [r.id, r]))

    const picks = aiPicks
      .filter(p => eventById[p.id])
      .slice(0, 3)
      .map(p => {
        const r = eventById[p.id]
        return {
          id:             p.id,
          rank:           p.rank,
          pitch:          p.pitch,
          title:          r.title,
          venue:          r.venue_name ?? '',
          dateFormatted:  r.date_start ? formatDate(r.date_start) : 'Anytime',
          priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
          ticketUrl:      r.ticket_url,
          imageUrl:       r.image_url ?? fallbackImg(r.category),
          category:       r.category,
          source:         r.source,
          distanceLabel:  r.distanceLabel,
        }
      })

    // Fallback if AI returned bad IDs
    if (picks.length === 0) {
      const fallback = rows.slice(0, 3).map((r, i) => ({
        id:             r.id,
        rank:           i + 1,
        pitch:          r.ai_description?.slice(0, 120) ?? 'A great local experience.',
        title:          r.title,
        venue:          r.venue_name ?? '',
        dateFormatted:  r.date_start ? formatDate(r.date_start) : 'Anytime',
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl:      r.ticket_url,
        imageUrl:       r.image_url ?? fallbackImg(r.category),
        category:       r.category,
        source:         r.source,
        distanceLabel:  r.distanceLabel,
      }))
      await enrichPickImages(fallback)
      return NextResponse.json({ picks: fallback })
    }

    // Enrich images for the 3 AI-selected picks (free: OG tag → Unsplash → fallback)
    await enrichPickImages(picks)

    return NextResponse.json({ picks })

  } catch (err) {
    console.error('[recommend] Error:', (err as Error).message)
    return NextResponse.json(
      { picks: [], error: 'Failed to generate recommendations' },
      { status: 500 },
    )
  }
}
