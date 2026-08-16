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
  drive_minutes: number
  drive_label: string
  start_label: string
  category: string
  image_url: string | null
  ticket_url: string | null
  maps_url: string
  source: string
}

// ---------------------------------------------------------------------------
// Haversine distance in miles
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

function estimateDriveMinutes(miles: number): number {
  if (miles < 0.3) return 2
  const raw = (miles / 28) * 60
  return Math.max(2, Math.round(raw / 5) * 5)
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
// Parse event time
// ---------------------------------------------------------------------------
function parseEventTime(dateObj?: SerperEventResult['date']): { start: Date | null; end: Date | null } {
  if (!dateObj) return { start: null, end: null }

  const when = (dateObj.when ?? '').toLowerCase()
  const now = new Date()

  if (dateObj.start_date) {
    try {
      const startStr = dateObj.start_date + (dateObj.start_time ? ' ' + dateObj.start_time : '')
      const start = new Date(startStr)
      if (!isNaN(start.getTime())) {
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
        return { start, end }
      }
    } catch { /* fall through */ }
  }

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
function inferCategory(title: string, description: string): string {
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

const CATEGORY_IMAGES: Record<string, string> = {
  'Music':         'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&q=80',
  'Nightlife':     'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80',
  'Food & Drink':  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&q=80',
  'Arts & Culture':'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=80',
  'Outdoors':      'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=400&q=80',
  'Activities':    'https://images.unsplash.com/photo-1576613109753-27804de2cce8?w=400&q=80',
  'Events':        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&q=80',
}

// ---------------------------------------------------------------------------
// Geocode address via Nominatim
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
// Main POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const {
      lat,
      lng,
      time_available = 60,
      max_drive_min  = 15,
      vibe           = 'any',
      location_label = '',
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

    const queries = buildQueries(lat, lng, vibe, location_label)
    const [r1, r2] = await Promise.all([
      serperSearch(queries[0], serperKey, 'events'),
      serperSearch(queries[2] ?? queries[1], serperKey, 'events'),
    ])

    const rawResults = [...(r1 as SerperEventResult[]), ...(r2 as SerperEventResult[])]

    const seen = new Set<string>()
    const deduped = rawResults.filter(r => {
      const key = (r.title ?? '').toLowerCase().trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    const candidates: NowResult[] = []

    for (const raw of deduped.slice(0, 20)) {
      const title = raw.title ?? 'Untitled'
      const description = raw.description ?? ''
      const addressParts = raw.address ?? []
      const address = addressParts.join(', ')
      const venueName = raw.venue?.name ?? addressParts[0] ?? ''
      const link = raw.link ?? null
      const thumbnail = raw.thumbnail ?? null

      const { start, end } = parseEventTime(raw.date)
      const startLabel = getStartLabel(start, end)

      if (end && end < now) continue
      if (start && start > cutoff) continue

      const category = inferCategory(title, description)

      let resultLat: number | null = null
      let resultLng: number | null = null

      if (address) {
        const geo = await geocodeAddress(address)
        if (geo) { resultLat = geo.lat; resultLng = geo.lng }
      }

      let driveMin = 999
      if (resultLat !== null && resultLng !== null) {
        const miles = haversine(lat, lng, resultLat, resultLng)
        driveMin = estimateDriveMinutes(miles)
      } else {
        driveMin = 10
      }

      if (driveMin > max_drive_min) continue

      const mapsUrl = address
        ? `https://maps.google.com/?daddr=${encodeURIComponent(address)}&saddr=Current+Location`
        : `https://maps.google.com/?q=${encodeURIComponent(title)}`

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

    candidates.sort((a, b) => a.drive_minutes - b.drive_minutes)

    return NextResponse.json({ results: candidates.slice(0, 6) })
  } catch (err) {
    console.error('/api/now error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
