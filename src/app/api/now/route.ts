import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface NowResult {
  id: string
  title: string
  description: string
  venue: string
  address: string
  lat: number | null
  lng: number | null
  drive_minutes: number   // estimated drive time
  drive_label: string     // "~8 min away"
  start_label: string     // "Happening now" | "Starts in 20 min" | "Ongoing"
  category: string
  image_url: string | null
  ticket_url: string | null
  maps_url: string        // Google Maps directions deep link
  source: string
  is_evergreen?: boolean  // true = timeless activity, no time/drive filtering applied
}

// ---------------------------------------------------------------------------
// Haversine distance in miles (reused from recommend route)
// ---------------------------------------------------------------------------
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Estimate drive time from straight-line distance
// Assumes ~28 mph average accounting for traffic, stops, routing overhead
function estimateDriveMinutes(miles: number): number {
  if (miles < 0.3) return 2
  const raw = (miles / 28) * 60
  return Math.max(2, Math.round(raw / 5) * 5)  // round to nearest 5 min
}

function driveLabel(mins: number): string {
  if (mins <= 2)  return 'Right here'
  if (mins < 5)   return '~2 min away'
  return `~${mins} min away`
}

// ---------------------------------------------------------------------------
// Serper.dev helpers
// ---------------------------------------------------------------------------
interface SerperEventResult {
  title?: string
  date?: { when?: string; start_date?: string; start_time?: string }
  address?: string[]
  link?: string
  thumbnail?: string
  description?: string
  venue?: { name?: string; rating?: number }
}

interface SerperOrganicResult {
  title?: string
  snippet?: string
  link?: string
  imageUrl?: string
  address?: string
}

async function serperSearch(query: string, key: string, type: 'search' | 'events' = 'events'): Promise<SerperEventResult[] | SerperOrganicResult[]> {
  const endpoint = type === 'events'
    ? 'https://google.serper.dev/events'
    : 'https://google.serper.dev/search'

  const body = type === 'events'
    ? { q: query, gl: 'us', num: 10 }
    : { q: query, gl: 'us', num: 8 }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
  const data = await res.json()
  return type === 'events' ? (data.events ?? []) : (data.organic ?? [])
}

// ---------------------------------------------------------------------------
// Parse event time from Serper result
// Returns null if no parseable time
// ---------------------------------------------------------------------------
function parseEventTime(dateObj?: SerperEventResult['date']): { start: Date | null; end: Date | null } {
  if (!dateObj) return { start: null, end: null }

  const when = (dateObj.when ?? '').toLowerCase()
  const now = new Date()

  // "Happening now" / "Today" with start time
  if (dateObj.start_date) {
    try {
      const startStr = dateObj.start_date + (dateObj.start_time ? ' ' + dateObj.start_time : '')
      const start = new Date(startStr)
      if (!isNaN(start.getTime())) {
        // Assume 2-hour duration if no end time
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
        return { start, end }
      }
    } catch { /* fall through */ }
  }

  // "Tonight", "Today", time-only strings
  if (when.includes('tonight') || when.includes('today')) {
    const timeMatch = when.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i)
    if (timeMatch) {
      let h = parseInt(timeMatch[1])
      const m = parseInt(timeMatch[2] ?? '0')
      const ampm = timeMatch[3].toLowerCase()
      if (ampm === 'pm' && h < 12) h += 12
      if (ampm === 'am' && h === 12) h = 0
      const start = new Date(now)
      start.setHours(h, m, 0, 0)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      return { start, end }
    }
    // No specific time → treat as ongoing today
    return { start: null, end: null }
  }

  return { start: null, end: null }
}

// ---------------------------------------------------------------------------
// Start-label logic
// ---------------------------------------------------------------------------
function getStartLabel(start: Date | null, end: Date | null): string {
  const now = new Date()
  if (!start) return 'Happening now'

  const diffMs = start.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)

  if (diffMin < -120) return 'Ongoing'
  if (diffMin < 0)    return 'Happening now'
  if (diffMin < 5)    return 'Starting any minute'
  if (diffMin < 60)   return `Starts in ${diffMin} min`
  if (diffMin < 120)  return `Starts in ~${Math.round(diffMin / 60)} hr`
  return 'Later today'
}

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------
function inferCategory(title: string, description: string = ''): string {
  const text = (title + ' ' + description).toLowerCase()
  if (/music|concert|band|live\s+show|dj|jazz|blues|country|rock|rap|hip.hop/.test(text)) return 'Music'
  if (/bar|brewery|cocktail|wine|beer|happy.hour|trivia|karaoke/.test(text)) return 'Nightlife'
  if (/food|eat|restaurant|taco|burger|brunch|dinner|lunch|bbq|sushi/.test(text)) return 'Food & Drink'
  if (/art|gallery|museum|exhibit|theatre|comedy|show|improv|film|movie/.test(text)) return 'Arts & Culture'
  if (/hike|trail|park|outdoor|run|yoga|fitness|climb|kayak|bike/.test(text)) return 'Outdoors'
  if (/market|fair|festival|farmers|pop.up|craft/.test(text)) return 'Events'
  if (/game|sport|bowling|arcade|mini.golf|escape|laser|axe/.test(text)) return 'Activities'
  return 'Events'
}

// Category fallback images
const CATEGORY_IMAGES: Record<string, string> = {
  'Music':        'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&q=80',
  'Nightlife':    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80',
  'Food & Drink': 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80',
  'Arts & Culture':'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=80',
  'Outdoors':     'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=400&q=80',
  'Activities':   'https://images.unsplash.com/photo-1576613109753-27804de2cce8?w=400&q=80',
  'Events':       'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&q=80',
}

// ---------------------------------------------------------------------------
// Geocode an address string → {lat, lng} via Nominatim
// ---------------------------------------------------------------------------
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Build Serper queries based on vibe + location
// ---------------------------------------------------------------------------
function buildQueries(lat: number, lng: number, vibe: string, locationLabel: string): string[] {
  const loc = locationLabel || `${lat.toFixed(3)},${lng.toFixed(3)}`
  const base = [
    `things to do right now near ${loc}`,
    `events happening today near ${loc}`,
  ]

  switch (vibe) {
    case 'food':
      return [...base, `restaurants open now near ${loc}`, `happy hour tonight near ${loc}`]
    case 'entertainment':
      return [...base, `live music tonight near ${loc}`, `shows events tonight near ${loc}`]
    case 'outdoors':
      return [...base, `outdoor activities near ${loc}`, `parks trails open near ${loc}`]
    default:
      return [...base, `fun things to do tonight near ${loc}`, `open now near ${loc}`]
  }
}

// ---------------------------------------------------------------------------
// Evergreen activity queries — scenic walks, viewpoints, romantic spots, etc.
// These run in parallel and are used when event results are thin
// ---------------------------------------------------------------------------
function buildEvergreenQueries(vibe: string, loc: string): string[] {
  switch (vibe) {
    case 'food':
      return [
        `best late night food spots near ${loc}`,
        `bars restaurants open late near ${loc}`,
      ]
    case 'entertainment':
      return [
        `things to do at night near ${loc}`,
        `best nightlife spots near ${loc}`,
      ]
    case 'outdoors':
      return [
        `scenic hikes lookout points near ${loc}`,
        `best viewpoints city views near ${loc}`,
      ]
    default:
      return [
        `romantic scenic spots date night near ${loc}`,
        `best things to do nearby ${loc}`,
      ]
  }
}

function mapOrganicToNowResult(r: SerperOrganicResult, idx: number): NowResult {
  const title  = r.title ?? 'Nearby Activity'
  const text   = `${title} ${r.snippet ?? ''}`
  const cat    = inferCategory(text)
  const image  = r.imageUrl ?? CATEGORY_IMAGES[cat] ?? CATEGORY_IMAGES['Events']!
  const addr   = r.address ?? ''
  const mapsUrl = addr
    ? `https://maps.google.com/?daddr=${encodeURIComponent(addr)}&saddr=Current+Location`
    : `https://maps.google.com/?q=${encodeURIComponent(title)}+near+me`

  return {
    id:            `activity-${Date.now()}-${idx}`,
    title,
    description:   (r.snippet ?? '').slice(0, 200),
    venue:         addr,
    address:       addr,
    lat:           null,
    lng:           null,
    drive_minutes: 5,
    drive_label:   'Nearby',
    start_label:   'Anytime ✓',
    category:      cat,
    image_url:     image,
    ticket_url:    r.link ?? null,
    maps_url:      mapsUrl,
    source:        'activity',
    is_evergreen:  true,
  }
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const {
      lat,
      lng,
      time_available = 60,    // minutes user has
      max_drive_min  = 15,    // max drive time user accepts
      vibe           = 'any', // food | entertainment | outdoors | any
      location_label = '',    // reverse-geocoded city name for better queries
    } = await req.json()

    if (!lat || !lng) {
      return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
    }

    const serperKey = process.env.SERPER_API_KEY
    if (!serperKey) {
      return NextResponse.json({ error: 'SERPER_API_KEY not set' }, { status: 500 })
    }

    const now = new Date()
    const cutoff = new Date(now.getTime() + time_available * 60 * 1000)

    // Queries — run up to 2 in parallel to stay fast
    const queries = buildQueries(lat, lng, vibe, location_label)
    const evergreenLoc = location_label || `${lat.toFixed(3)},${lng.toFixed(3)}`
    const evergreenQ   = buildEvergreenQueries(vibe, evergreenLoc)[0]
    const [r1, r2, activityRaw] = await Promise.all([
      serperSearch(queries[0], serperKey, 'events'),
      serperSearch(queries[2] ?? queries[1], serperKey, 'events'),
      serperSearch(evergreenQ, serperKey, 'search'),
    ])

    const rawResults = [...(r1 as SerperEventResult[]), ...(r2 as SerperEventResult[])]

    // De-duplicate by title
    const seen = new Set<string>()
    const deduped = rawResults.filter(r => {
      const key = (r.title ?? '').toLowerCase().trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Build NowResult objects
    const candidates: NowResult[] = []

    for (const raw of deduped.slice(0, 20)) {
      const title = raw.title ?? 'Untitled'
      const description = raw.description ?? ''
      const addressParts = raw.address ?? []
      const address = addressParts.join(', ')
      const venueName = raw.venue?.name ?? addressParts[0] ?? ''
      const link = raw.link ?? null
      const thumbnail = raw.thumbnail ?? null

      // Parse timing
      const { start, end } = parseEventTime(raw.date)
      const startLabel = getStartLabel(start, end)

      // Filter out events that have already ended
      if (end && end < now) continue

      // Filter out events starting too far in the future
      if (start && start > cutoff) continue

      // Category
      const category = inferCategory(title, description)

      // Location — geocode the address to get coords for drive time
      let resultLat: number | null = null
      let resultLng: number | null = null

      if (address) {
        const geo = await geocodeAddress(address)
        if (geo) { resultLat = geo.lat; resultLng = geo.lng }
      }

      // Drive time estimate
      let driveMin = 999
      if (resultLat !== null && resultLng !== null) {
        const miles = haversine(lat, lng, resultLat, resultLng)
        driveMin = estimateDriveMinutes(miles)
      } else {
        // No address → assume it's somewhere nearby; use a conservative 10 min
        driveMin = 10
      }

      // Filter by max drive time
      if (driveMin > max_drive_min) continue

      // Build Google Maps directions URL
      const mapsUrl = address
        ? `https://maps.google.com/?daddr=${encodeURIComponent(address)}&saddr=Current+Location`
        : `https://maps.google.com/?q=${encodeURIComponent(title)}`

      // Image fallback
      const imageUrl = thumbnail || CATEGORY_IMAGES[category] || CATEGORY_IMAGES['Events']

      candidates.push({
        id: `now-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        description: description.slice(0, 200),
        venue: venueName,
        address,
        lat: resultLat,
        lng: resultLng,
        drive_minutes: driveMin,
        drive_label: driveLabel(driveMin),
        start_label: startLabel,
        category,
        image_url: imageUrl,
        ticket_url: link,
        maps_url: mapsUrl,
        source: 'serper',
      })

      if (candidates.length >= 8) break
    }

    // ── Evergreen activities — always supplement when events are sparse ────────
    const organicItems = (activityRaw as SerperOrganicResult[])
      .filter(r => r.title && (r.snippet || r.imageUrl))
    const slotsLeft = Math.max(0, 4 - candidates.length)

    for (let i = 0; i < Math.min(organicItems.length, slotsLeft); i++) {
      candidates.push(mapOrganicToNowResult(organicItems[i], i))
    }

    // Nuclear fallback — never return empty-handed
    if (candidates.length === 0) {
      const cityLabel = location_label.split(',')[0].trim() || 'the area'
      candidates.push({
        id:            `fallback-explore-${Date.now()}`,
        title:         `Explore ${cityLabel}`,
        description:   "Sometimes the best night out is unplanned — take a walk, find an open spot, and see where the night takes you.",
        venue:         '',
        address:       '',
        lat:           null,
        lng:           null,
        drive_minutes: 5,
        drive_label:   'Right here',
        start_label:   'Anytime ✓',
        category:      'Outdoors',
        image_url:     CATEGORY_IMAGES['Outdoors'] ?? CATEGORY_IMAGES['Events']!,
        ticket_url:    null,
        maps_url:      'https://maps.google.com/?q=things+to+do+near+me',
        source:        'activity',
        is_evergreen:  true,
      })
    }

    // Sort by drive time
    candidates.sort((a, b) => a.drive_minutes - b.drive_minutes)

    return NextResponse.json({ results: candidates.slice(0, 6) })
  } catch (err) {
    console.error('/api/now error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
