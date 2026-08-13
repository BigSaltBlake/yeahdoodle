import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

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
  const b = answers[5] ?? ''
  if (b.includes('Free') || b.includes('25')) return 25
  if (b.includes('75')) return 75
  return null
}

function categoryHints(answers: string[]): string[] | null {
  const exp = answers[3] ?? ''
  if (exp.includes('music') || exp.includes('show')) return ['Music', 'Arts & Culture', 'Nightlife']
  if (exp.includes('Food') || exp.includes('drinks')) return ['Food & Drink', 'Community', 'Outdoors']
  return null
}

function getDateRange(timeframe: string): { start: Date; end: Date } {
  const now   = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  if (timeframe === 'Tonight') {
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)
    return { start: now, end }
  }
  if (timeframe === 'Tomorrow') {
    const start = new Date(today)
    start.setDate(start.getDate() + 1)
    const end = new Date(start)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }
  if (timeframe === 'This weekend') {
    const dow = now.getDay()
    const daysUntilFri = dow === 0 ? 6 : (5 - dow + 7) % 7 || 7
    const friday = new Date(today)
    friday.setDate(friday.getDate() + daysUntilFri)
    const sunday = new Date(friday)
    sunday.setDate(sunday.getDate() + 2)
    sunday.setHours(23, 59, 59, 999)
    const start = (dow === 0 || dow === 6) ? now : friday
    return { start, end: sunday }
  }
  // 'Coming weeks' — 4-week lookahead
  const end = new Date(today)
  end.setDate(end.getDate() + 28)
  return { start: now, end }
}

function getSerpQueriesForCity(timeframe: string, city: string, _isLocal: boolean): string[] {
  const when =
    timeframe === 'Tonight'      ? 'tonight' :
    timeframe === 'Tomorrow'     ? 'tomorrow' :
    timeframe === 'This weekend' ? 'this weekend' :
    'this month'

  // Single query per city — keeps SerpAPI usage at 1–2 calls per session
  return [`events ${when} in ${city}`]
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
async function fetchLiveSerpEvents(cities: CityQuery[], timeframe = 'Tonight'): Promise<EventRow[]> {
  const serperKey = process.env.SERPER_API_KEY
  if (!serperKey || cities.length === 0) return []

  const results: EventRow[] = []
  const seen = new Set<string>()

  await Promise.all(
    cities.flatMap(({ name: cityName, distanceLabel, isLocal }) => {
      const queries = getSerpQueriesForCity(timeframe, cityName, isLocal)

      return queries.map(async (q, qi) => {
        try {
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
              'X-API-KEY': serperKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q, gl: 'us', hl: 'en', num: 10 }),
            cache: 'no-store',
          })
          if (!res.ok) return

          const data = await res.json()
          const events: unknown[] = data.events ?? []

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

            // Activity queries (qi >= 2) typically have no date — mark as timeless activity
            const isActivity = !dateStart && qi >= 2

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

    const timeframe = (answers[0] as string) || 'Tonight'
    const { start: dateStart, end: dateEnd } = getDateRange(timeframe)
    const maxBudget = budgetMax(answers)
    const catHints  = categoryHints(answers)

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
      ? fetchLiveSerpEvents(cities, timeframe)
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

    const [liveEvents, dbRows] = await Promise.all([liveEventsPromise, dbRowsPromise])

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

    let rows: EventRow[] = [...uniqueLive, ...dbRows]

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
    if (rows.length === 0) {
      // Use best available city: regional hub, local city, or resolved city
      const fallbackCity =
        cities.length > 0
          ? { ...(cities.find(c => !c.isLocal) ?? cities[0]), isLocal: true }
          : resolvedCity
            ? { name: resolvedCity, distanceLabel: 'Nearby', isLocal: true }
            : null

      if (fallbackCity) {
        const broadEvents = await fetchLiveSerpEvents([fallbackCity], 'Coming weeks')
        if (broadEvents.length > 0) rows = broadEvents
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

    const labelMap = ['When', 'Energy level', 'Group size', 'Experience type', 'Scene/crowd', 'Budget']
    const answerSummary = answers.map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`).join('\n')

    const timeframeInstruction =
      timeframe === 'Tonight'      ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tomorrow'     ? 'Prefer events happening TOMORROW.' :
      timeframe === 'This weekend' ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
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

Pick the 3 BEST events or activities that match this person's vibe. ${timeframeInstruction}${activityNote} Consider energy level, group size, experience preference, scene, and budget. Prioritise variety — don't pick 3 of the same type. If the user is in a rural or outdoor area, outdoor activities are valid picks.

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
