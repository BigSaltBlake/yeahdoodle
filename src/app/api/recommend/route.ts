import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { getPlaceProfile, buildProfileQueries } from '@/lib/place-profile'
import { searchNearbyVenues, FOOD_TYPE_GROUPS, lastGooglePlacesError, verifyPlace, type VerifiedPlace } from '@/lib/google-places'
import { getCuratedVenues } from '@/lib/curated-venues'
import { getNearbySecrets } from '@/lib/local-secrets'
import { getNearbyWikiPlaces } from '@/lib/wiki-places'
import { isChain } from '@/lib/chains'

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
  /** IANA time zone of the event's venue, when the source tells us (Ticketmaster does) */
  tz?: string
  /** Listing gave a day but no start time */
  dateOnly?: boolean
  /** 1 ($) – 4 ($$$$): Google's price level, or derived from ticket price */
  priceTier?: number
  /** Venue takes reservations (Google) */
  reservable?: boolean
  /** Set when this entry breaks the visitor's dealbreaker and is only here to fill a slot */
  bendsDealbreaker?: boolean
  /** Local secret details (source 'secret') */
  secret?: { access: string | null; bestTime: string | null; cautions: string | null }
}

// Listicles and guides, whatever source they came from
const ARTICLE_TITLE = /\b(things to do|top \d+|\d+\+? (best|fun|unique|cool|things|places|ways|spots)|travel guide|itinerary|bucket list)\b/i
// Plain web-search results are pages, not places: anything that reads like an
// article title goes
const WEB_PAGE_TITLE = /\b(best|top|guide|things|ways|places|tips|itinerary|visit|visiting|travel|review|reviews|reddit|tripadvisor|what|where|how|why|weather|crowds|favou?rites?|must|events|calendar|attractions|recommendations|exploring|explore|sightseeing|\d{1,4})\b|\?|\.\.\.|…/i
// A listing page, not a thing: "Events", "Events in Paris", "Main Street Events"
const GENERIC_TITLE = /^\s*(\S+\s+){0,2}(events?|calendar|happenings|things to do)(\s+in\s+.+)?\s*$/i

function looksLikeArticle(r: EventRow): boolean {
  if (ARTICLE_TITLE.test(r.title) || GENERIC_TITLE.test(r.title)) return true
  // Undated search results that aren't a Google place or one of ours are web pages
  const isWebPage = r.id.startsWith('profile-') || r.id.startsWith('activity_fallback_') ||
    (r.id.startsWith('live_') && !r.date_start)
  return isWebPage && WEB_PAGE_TITLE.test(r.title)
}

/** Ticket price → rough $–$$$$ tier, so events and venues compare the same way */
function tierFromPrice(price: number | null | undefined): number | undefined {
  if (price == null) return undefined
  return price <= 25 ? 1 : price <= 60 ? 2 : price <= 120 ? 3 : 4
}

// ---------------------------------------------------------------------------
// Dealbreakers are enforced with data where we have it. If at least 3 options
// clear the dealbreaker, the rest are dropped; if fewer do, the gap may be
// filled with options that bend it — always with a note saying so.
// ---------------------------------------------------------------------------
const BIG_VENUE = /\b(arena|stadium|amphitheat(er|re)|coliseum|speedway|fairgrounds|ballpark|field house|event center|events center)\b/i

type Dealbreaker = {
  breaks: (r: EventRow) => boolean
  /** Shown on the card of any pick that bends it */
  note: string
  /** Sentences in a bending pick's pitch that claim the opposite get removed */
  contradicts: RegExp
}

const DEALBREAKERS: Record<string, Dealbreaker> = {
  'too pricey': {
    breaks: r => (r.priceTier ?? tierFromPrice(r.price_min) ?? 0) >= 3,
    note: "I know “too pricey” is a dealbreaker, but here's another option, just in case.",
    contradicts: /\b(cheap|affordable|budget|low[- ]priced?|low prices|inexpensive|bargain|won'?t break the bank|easy on the wallet|\$ prices|fair price)\b/i,
  },
  'needs a reservation': {
    breaks: r => r.reservable === true,
    note: "I know needing a reservation is a dealbreaker, but here's another option, just in case — it may have walk-in space.",
    contradicts: /\b(no reservations?( needed| required)?|without (calling|booking|a reservation)|walk[- ]?ins?( only| welcome)?|just show up|no need to book)\b/i,
  },
  'massive crowds': {
    breaks: r => r.source === 'live' && BIG_VENUE.test(`${r.venue_name ?? ''} ${r.title}`),
    note: "I know big crowds are a dealbreaker, but here's another option, just in case.",
    contradicts: /\b(quiet|intimate|uncrowded|no crowds?|crowd[- ]free|low[- ]key|tucked away|hidden gem)\b/i,
  },
}

function dealbreakerFor(answer: string | undefined) {
  return answer ? DEALBREAKERS[answer.trim().toLowerCase()] : undefined
}

/**
 * A pick that bends the dealbreaker carries the code-written note, so its
 * pitch must never claim the opposite (e.g. "no reservation needed" on a place
 * that takes reservations). Drop any sentence that does.
 */
function bendSafePitch(pitch: string, deal: Dealbreaker | undefined): string {
  if (!deal) return pitch
  const sentences = pitch.match(/[^.!?]+[.!?]*\s*/g) ?? [pitch]
  const kept = sentences.filter(s => !deal.contradicts.test(s)).join('').trim()
  return kept || 'Worth a look if you can stretch on this one.'
}

interface CityQuery {
  name: string
  distanceLabel: string
  isLocal: boolean
  /** The town's own point, when we have it — saves re-geocoding a bare name */
  lat?: number
  lng?: number
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
// The server runs in UTC on Vercel, so every date must be formatted in the
// visitor's (or venue's) time zone — otherwise an 8 PM show prints as 2 AM.
const DEFAULT_TZ = 'America/Denver'

function safeTz(tz: string | undefined | null): string {
  if (!tz) return DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

function formatDate(isoDate: string | null, tz: string, dateOnly = false): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
  })
}

/** Calendar day (YYYY-MM-DD) of an instant, as seen in a time zone */
function dayKey(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

/** "TODAY" / "TOMORROW" / "in 3 days" relative to now, in the given time zone */
function relativeDay(isoDate: string, tz: string): string {
  const d = new Date(isoDate)
  if (isNaN(d.getTime())) return ''
  const diff = Math.round(
    (Date.parse(dayKey(d, tz)) - Date.parse(dayKey(new Date(), tz))) / 86_400_000,
  )
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'TOMORROW'
  if (diff < 0)   return 'PAST'
  return `in ${diff} days`
}

/**
 * Interpret a wall-clock time (e.g. "Oct 3, 8 PM" with no zone) as local time
 * in `tz` and return the real UTC instant. `parsed` is the result of
 * `new Date(str)` on a zone-less string, whose local fields hold the wall-clock
 * values whatever time zone the server itself runs in.
 */
function wallClockToUtc(parsed: Date, tz: string): Date {
  const asIfUtc = Date.UTC(
    parsed.getFullYear(), parsed.getMonth(), parsed.getDate(),
    parsed.getHours(), parsed.getMinutes(), parsed.getSeconds(),
  )
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(asIfUtc))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const offset = zoned - asIfUtc
  return new Date(asIfUtc - offset)
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
      `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=en&lat=${lat}&lon=${lng}` +
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
    // Outside the US, name the country too ("Paris, Texas" vs "Paris, Île-de-France, France")
    const country = addr.country_code && addr.country_code !== 'us' ? addr.country : ''
    const displayName = [city, state !== city ? state : '', country].filter(Boolean).join(', ')
    const resultLat = parseFloat(data.lat ?? String(lat))
    const resultLng = parseFloat(data.lon ?? String(lng))
    return { city, state, displayName, resultLat, resultLng, placeType }
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

async function geocodeZipCode(zip: string): Promise<{ lat: number; lng: number } | null> {
  // The zip directory gives the town's own point; a zip area's centre can fall
  // outside town (84082's does), which makes everything resolve to the county.
  try {
    const z = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(4000),
    })
    if (z.ok) {
      const place = ((await z.json()) as { places?: Array<{ latitude?: string; longitude?: string }> }).places?.[0]
      const lat = Number(place?.latitude), lng = Number(place?.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) return { lat, lng }
    }
  } catch { /* fall back to Nominatim */ }

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
      `https://nominatim.openstreetmap.org/search?format=json&accept-language=en` +
      `&q=${encodeURIComponent(query)}&limit=1&addressdetails=0`
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
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2
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

// Slides whose whole survey is about one kind of thing — "Surprise me" still
// has to stay inside that lane.
const MODE_CATEGORIES: Record<string, string[]> = {
  foodie:  ['Food & Drink'],
  music:   ['Music', 'Nightlife'],
  outdoor: ['Outdoors', 'Sports & Outdoors', 'Activities'],
}

function categoryHints(answers: string[], mode = ''): string[] | null {
  return answerCategoryHints(answers) ?? MODE_CATEGORIES[mode] ?? null
}

function answerCategoryHints(answers: string[]): string[] | null {
  const feeling = (answers[0] ?? '').toLowerCase()
  // Date-night taxonomy (current)
  if (feeling.includes('dinner date'))    return ['Food & Drink']
  if (feeling.includes('drinks & vibes')) return ['Nightlife', 'Food & Drink']
  if (feeling.includes('live show'))      return ['Music', 'Arts & Culture', 'Comedy']
  if (feeling.includes('get outside'))    return ['Outdoors', 'Sports & Outdoors', 'Activities']
  if (feeling.includes('something fun'))  return ['Activities', 'Community', 'Nightlife']
  if (feeling.includes('surprise'))       return null
  // First-date bank
  if (feeling.includes('impressive dinner')) return ['Food & Drink']
  if (feeling.includes('low-key coffee'))    return ['Food & Drink']
  if (feeling.includes('fun activity'))      return ['Activities', 'Community', 'Comedy']
  if (feeling.includes('outdoors & chill'))  return ['Outdoors', 'Sports & Outdoors']
  // FOMO bank
  if (feeling.includes('hottest show'))        return ['Music', 'Arts & Culture', 'Comedy']
  if (feeling.includes('trending restaurant')) return ['Food & Drink']
  if (feeling.includes('party of the season')) return ['Nightlife', 'Music']
  if (feeling.includes('must-see art'))        return ['Arts & Culture']
  if (feeling.includes('outdoor buzz'))        return ['Outdoors', 'Sports & Outdoors']
  if (feeling.includes("what's hot"))          return null
  // Music bank — every option is live music
  if (/rock|folk|acoustic|edm|dance|jazz|blues|hip-hop|anything live/.test(feeling)) return ['Music', 'Nightlife']
  // Outdoor bank
  if (/hike|trail|bike|water stuff|urban walk|park & chill/.test(feeling)) return ['Outdoors', 'Sports & Outdoors', 'Activities']
  // Foodie bank — every option is food
  if (/bold & new|comfort done right|quick & fresh|special experience|street & casual/.test(feeling)) return ['Food & Drink']
  // Legacy Go ___ taxonomy (backwards compat)
  if (feeling.includes('go eat'))     return ['Food & Drink']
  if (feeling.includes('go listen'))  return ['Music', 'Nightlife']
  if (feeling.includes('go out'))     return ['Nightlife', 'Food & Drink', 'Community']
  if (feeling.includes('go move'))    return ['Sports & Outdoors', 'Outdoors', 'Nightlife']
  if (feeling.includes('go see'))     return ['Arts & Culture', 'Comedy', 'Sports & Outdoors']
  if (feeling.includes('go explore')) return ['Community', 'Arts & Culture', 'Outdoors']
  if (feeling.includes('go play'))    return ['Community', 'Nightlife']
  // Legacy feeling-based labels
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

function getDateRange(timeframe: string, tz: string): { start: Date; end: Date } {
  const now   = new Date()
  // Midnight today in the visitor's time zone (the server itself runs in UTC)
  const localDay = dayKey(now, tz)
  const today = wallClockToUtc(new Date(`${localDay}T00:00:00`), tz)

  // 'Now' and legacy 'Tonight' — 18-hour rolling window
  if (timeframe === 'Now' || timeframe === 'Tonight') {
    const end = new Date(now.getTime() + 18 * 60 * 60 * 1000)
    return { start: now, end }
  }
  const DAY_MS = 86_400_000
  const localHour = Number(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }))
  // 'Tomorrow' = the next open day. Asked at 1 AM, that's later today.
  if (timeframe === 'Tomorrow') {
    const day = localHour < 5 ? today : new Date(today.getTime() + DAY_MS)
    return { start: new Date(day.getTime() + 6 * 3_600_000), end: new Date(day.getTime() + 29 * 3_600_000) }
  }
  // 'This Week' = from the next open day through the next 7 days
  if (timeframe === 'This Week') {
    const day = localHour < 5 ? today : new Date(today.getTime() + DAY_MS)
    return { start: new Date(day.getTime() + 6 * 3_600_000), end: new Date(day.getTime() + 7 * DAY_MS) }
  }
  // 'Anytime' = just exploring: standout things over the next month
  if (timeframe === 'Anytime') {
    return { start: now, end: new Date(now.getTime() + 30 * DAY_MS) }
  }
  // 'Soon' and legacy 'This weekend' — next Friday–Sunday
  if (timeframe === 'Soon' || timeframe === 'This weekend') {
    const DAY = 86_400_000
    const dow = new Date(`${localDay}T12:00:00Z`).getUTCDay()   // local day of week
    // Fri/Sat/Sun → this weekend, starting now; Mon–Thu → the coming Friday
    const inWeekend = dow === 5 || dow === 6 || dow === 0
    const daysUntilFri = inWeekend ? 0 : 5 - dow
    const friday = new Date(today.getTime() + daysUntilFri * DAY)
    const daysFriToMon = dow === 6 ? 2 : dow === 0 ? 1 : 3
    const mondayMidnight = new Date((inWeekend ? today : friday).getTime() + daysFriToMon * DAY)
    return { start: inWeekend ? now : friday, end: mondayMidnight }
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

  // Date-night taxonomy (current)
  if (exp.includes('dinner date')) {
    return [
      `romantic restaurants date night dining ${when} in ${city}`,
      `best date night restaurants ${city}`,
      `intimate dining wine bars ${when} near ${city}`,
    ]
  }
  if (exp.includes('drinks & vibes')) {
    return [
      `cocktail bars rooftop bars date night ${when} in ${city}`,
      `best bars for couples drinks ${city}`,
      `speakeasy wine bar nightlife date night ${when} near ${city}`,
    ]
  }
  if (exp.includes('live show')) {
    return [
      `live music concerts date night ${when} in ${city}`,
      `comedy theatre shows events ${when} in ${city}`,
      `best live entertainment venues ${city}`,
    ]
  }
  if (exp.includes('get outside')) {
    return [
      `outdoor date night activities ${when} near ${city}`,
      `hiking trails scenic views sunset spots ${city}`,
      `outdoor experiences nature date night ${when} near ${city}`,
    ]
  }
  if (exp.includes('something fun')) {
    return [
      `fun date night ideas activities ${when} in ${city}`,
      `escape room bowling arcade date night ${when} near ${city}`,
      `unique things to do couples tonight ${city}`,
    ]
  }
  if (exp.includes('surprise us')) {
    return [
      `best date night ideas ${when} in ${city}`,
      `unique romantic things to do couples ${when} near ${city}`,
      `hidden gems date night spots ${city}`,
    ]
  }
  // Legacy Go ___ taxonomy (backwards compat)
  if (exp.includes('go eat')) {
    return [
      `restaurants dining ${when} in ${city}`,
      `food events brunch bars happy hour ${when} near ${city}`,
      `best restaurants bars open tonight ${city}`,
    ]
  }
  if (exp.includes('go listen')) {
    return [
      `live music concerts ${when} in ${city}`,
      `live music bands performing ${when} near ${city}`,
      `best live music venues tonight ${city}`,
    ]
  }
  if (exp.includes('go out')) {
    return [
      `bars nightlife ${when} in ${city}`,
      `rooftop bars lounge patio drinks ${when} near ${city}`,
      `best nightlife bars places to go out ${city}`,
    ]
  }
  if (exp.includes('go move')) {
    return [
      `dancing dance clubs ${when} in ${city}`,
      `outdoor activities sports recreation ${when} near ${city}`,
      `hiking outdoor active fun things to do ${city}`,
    ]
  }
  if (exp.includes('go see')) {
    return [
      `comedy theatre shows events ${when} in ${city}`,
      `art galleries museums cultural events ${when} near ${city}`,
      `sports games entertainment ${when} near ${city}`,
    ]
  }
  if (exp.includes('go explore')) {
    return [
      `farmers market pop-up events ${when} in ${city}`,
      `things to do discover explore ${when} near ${city}`,
      `night market hidden gems neighborhood events ${city}`,
    ]
  }
  if (exp.includes('go play')) {
    return [
      `trivia night escape room bowling ${when} in ${city}`,
      `games fun activities social events ${when} near ${city}`,
      `best trivia bars arcade entertainment ${city}`,
    ]
  }
  // Legacy feeling-based labels (backwards compat)
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
    `things to do ${when} near ${city}`,
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
  user: { lat: number; lng: number } | null,
): Promise<EventRow[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY
  if (!apiKey || cities.length === 0) return []

  const results: EventRow[] = []
  const seen = new Set<string>()

  await Promise.all(
    cities.map(async (c) => {
      const { name: cityName, distanceLabel } = c
      try {
        // Geocode city → latlong so TM can find areas like "Jackson Hole"
        // (TM's city DB uses "Jackson, WY" not "Jackson Hole, WY")
        // A bare town name can match the wrong country, so use the point we
        // already resolved when there is one
        const geo = typeof c.lat === 'number' && typeof c.lng === 'number'
          ? { lat: c.lat, lng: c.lng }
          : await geocodeCity(cityName)
        const paramObj: Record<string, string> = {
          apikey:        apiKey,
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
          const eventTz = typeof dates?.timezone === 'string' ? safeTz(dates.timezone) : undefined
          // dateTime is a real UTC instant; localDate/localTime is venue wall-clock time
          const dateIso = (startObj?.dateTime as string | null) ??
            (startObj?.localDate
              ? wallClockToUtc(
                  new Date(`${startObj.localDate}T${(startObj.localTime as string | undefined) ?? '00:00:00'}`),
                  eventTz ?? DEFAULT_TZ,
                ).toISOString()
              : null)

          const priceRanges = e.priceRanges as Array<{ min: number; max: number }> | undefined
          const priceMin = priceRanges?.[0]?.min ?? null
          const priceMax = priceRanges?.[0]?.max ?? null
          const isFree   = priceMin === 0

          const venues   = (e._embedded as Record<string, unknown> | undefined)?.venues as Array<Record<string, unknown>> | undefined
          const venue    = venues?.[0]
          const venueName = (venue?.name as string | undefined) ?? null
          const venueLoc  = venue?.location as { latitude?: string; longitude?: string } | undefined
          const vLat = Number(venueLoc?.latitude), vLng = Number(venueLoc?.longitude)
          const eventDistance = user && Number.isFinite(vLat) && Number.isFinite(vLng) && (vLat || vLng)
            ? driveTimeLabel(haversine(user.lat, user.lng, vLat, vLng))
            : distanceLabel

          const images   = e.images as Array<{ url: string; width: number; height: number; ratio?: string }> | undefined
          const imgUrl   = tmBestImage(images) ?? fallbackImg(category)

          results.push({
            id:           `tm_${(e.id as string) ?? `${cityName}_${i}`}`,
            title,
            venue_name:   venueName,
            date_start:   dateIso,
            is_free:      isFree,
            price_min:    isFree ? 0 : priceMin,
            priceTier:    isFree ? 1 : tierFromPrice(priceMin),
            price_max:    priceMax,
            category,
            ticket_url:   (e.url as string | null) ?? null,
            image_url:    imgUrl,
            description:  (e.info as string | null) ?? (e.description as string | null) ?? null,
            ai_description: null,
            distanceLabel: eventDistance,
            source:       'live',
            tz:           eventTz,
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
// Google's event dates are local wall-clock text ("Sat, Oct 3, 8 PM") with no zone
function parseGoogleEventDate(dateStr: string | undefined, tz: string): string | null {
  if (!dateStr) return null
  try {
    // "7 – 10 PM" / "7:30 PM – 10 PM" → keep the start time, borrowing AM/PM from the end if needed
    const cleaned = dateStr
      .replace(
        /(\d{1,2}(?::\d{2})?)\s*(AM|PM)?\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(AM|PM).*/i,
        (_m, start: string, ap1?: string, ap2?: string) => `${start} ${ap1 ?? ap2}`,
      )
      .trim()
    // V8 can't parse "8 PM" — normalise to "8:00 PM"
    const normalised = cleaned.replace(/\b(\d{1,2})\s*(AM|PM)\b/i, '$1:00 $2')
    const thisYear = new Date().getFullYear()
    let d = new Date(normalised)
    // Year-less strings parse to 2001 in V8 — retry with the current year
    if (isNaN(d.getTime()) || d.getFullYear() < thisYear - 1) d = new Date(`${normalised} ${thisYear}`)
    if (isNaN(d.getTime())) return null
    return wallClockToUtc(d, tz).toISOString()
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
async function fetchLiveSerpEvents(cities: CityQuery[], timeframe = 'Tonight', expType = '', tz = DEFAULT_TZ): Promise<EventRow[]> {
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
            const dateStart = parseGoogleEventDate(date?.start_date ?? date?.when, tz)
            const rawWhen = date?.start_date ?? date?.when ?? ''
            const dateOnly = !!dateStart && !/\d:\d\d|\b(AM|PM)\b/i.test(rawWhen)

            // Activity queries (qi >= 1) typically have no date — mark as timeless activity
            const isActivity = !dateStart && qi >= 1

            const thumbnail = (e.thumbnail ?? null) as string | null
            const imgUrl = thumbnail ?? fallbackImg(inferCategory(title + ' ' + ((e.description as string) ?? '')))

            results.push({
              id: `live_${cityName.slice(0, 6).replace(/\s/g, '')}_${qi}_${i}`,
              title,
              venue_name: venue?.name ?? address?.[0] ?? null,
              date_start: dateStart,
              dateOnly,
              is_free: isFree,
              price_min: isFree ? 0 : price,
              priceTier: isFree ? 1 : tierFromPrice(price),
              price_max: null,
              category: inferCategory(title + ' ' + ((e.description as string) ?? '')),
              ticket_url: (ticketInfo?.[0]?.link ?? e.link ?? null) as string | null,
              image_url: imgUrl,
              description: (e.description ?? null) as string | null,
              ai_description: null,
              // Only claim the town when the listed address is actually in it
              distanceLabel: address?.length && !address.join(' ').toLowerCase().includes(cityName.split(',')[0].toLowerCase()) ? '' : distanceLabel,
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
// Matching the AI's picks back to candidate rows
// ---------------------------------------------------------------------------
// Words too common to show two names are the same place
const PLACE_FILLER_WORDS = new Set([
  'the', 'and', 'of', 'de', 'da', 'do', 'des', 'du', 'la', 'le', 'el', 'del', 'park', 'parque', 'trail', 'trails',
  'national', 'state', 'area', 'recreation', 'garden', 'gardens', 'walk', 'hike', 'loop', 'system', 'network',
  'center', 'centre', 'museum', 'beach', 'lake', 'river', 'view', 'viewpoint', 'overlook', 'scenic', 'refuge',
  'wildlife', 'forest', 'grounds', 'tour', 'night', 'sunset', 'evening', 'city', 'old', 'town',
  'historic', 'historical', 'site', 'house', 'home', 'recreational', 'walking', 'routes', 'access', 'preserve',
  'reserve', 'monument', 'memorial', 'path', 'county', 'public', 'community', 'downtown', 'south', 'north',
  'east', 'west', 'upper', 'lower', 'side', 'exploration', 'bottoms',
])
function placeWords(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !PLACE_FILLER_WORDS.has(w))
}
/** Does Google's match share a distinctive word with what was suggested? ("Lake Crook" ≈ "Lake Crook Park", "Ribeira Aberta" ≠ "Beira Rio") */
function sameNamedPlace(suggested: string, found: string, townName = ''): boolean {
  const town = new Set(placeWords(townName))   // "Paris" alone doesn't make two Paris places the same
  const f = new Set(placeWords(found).filter(w => !town.has(w)))
  const s = new Set(placeWords(suggested).filter(w => !town.has(w)))
  const shared = Array.from(f).filter(w => s.has(w)).length
  // At least a third of the found name must be what was suggested
  return shared > 0 && shared * 3 >= f.size
}

/**
 * Rewrites each verified pick's title and pitch using only what Google says
 * about the place (type, description, reviews). Returns null per pick — or for
 * the whole call — when it can't, so the caller keeps the original wording.
 */
async function groundPitches(
  apiKey: string,
  items: Array<{ title: string; pitch: string; place: VerifiedPlace | null; note?: string }>,
  ctx: { want: string; town: string; isTourist: boolean },
): Promise<Array<{ title: string; pitch: string } | null> | null> {
  const blocks = items.map((it, i) => {
    if (!it.place && !it.note) return `PLACE ${i + 1}: (no facts — skip)`
    const f = it.place?.facts ?? { reviews: [] as string[] } as VerifiedPlace['facts']
    return [
      `PLACE ${i + 1}: ${it.place?.name ?? it.title}`,
      it.note ? `Wikipedia: ${it.note}` : '',
      f.type ? `Type: ${f.type}` : '',
      f.summary ? `Google's description: ${f.summary}` : '',
      f.rating ? `Rating: ${f.rating}★ from ${f.ratingCount ?? 0} reviews` : '',
      it.place?.openNow === true ? 'Open right now' : it.place?.openNow === false ? 'Closed right now' : '',
      it.place ? `Drive: ${it.place.distanceLabel}` : '',
      ...f.reviews.map(r => `Review: "${r}"`),
      `Draft idea (from memory, may be wrong): ${it.title} — ${it.pitch}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const prompt = `You write short picks for someone in ${ctx.town} who wants: "${ctx.want}". ${ctx.isTourist
    ? 'They are visiting — never say "no tourists" or "locals only".'
    : 'They want to explore like a local.'}

For each place, write a title (max 8 words) and a pitch (max 30 words, present tense, makes not going feel like a missed opportunity).

STRICT: use only facts stated in the place's type, Wikipedia or Google description, or reviews. The draft idea comes from memory and may be wrong — keep anything from it only if the facts back it up. Never invent features (decks, trails, overlooks, tours, exhibits), history, prices, hours or crowd levels. If the facts are thin, keep the pitch simple and true.

${blocks}

Return ONLY a JSON array with one entry per place, in order: [{"title":"...","pitch":"..."}]. Use null for a place marked "skip".`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const text: string = (await res.json()).content?.[0]?.text ?? ''
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) return null
    const out = JSON.parse(m[0]) as Array<{ title?: string; pitch?: string } | null>
    return items.map((_, i) => {
      const o = out[i]
      return o?.title && o?.pitch ? { title: o.title, pitch: o.pitch } : null
    })
  } catch {
    return null
  }
}

function normName(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Short, distinctive form of a place/event name for spotting it inside a
 * pitch: "Red Rock Brewing - Downtown Salt Lake City" → "red rock".
 * Returns null when the name is too generic to be a reliable signal.
 */
function nameKey(title: string, cityWords: Set<string>): string | null {
  const core = normName(title.split(/\s[-–|:(]\s?|\s\(/)[0]).replace(/^the /, '')
  const words = core.split(' ').filter(Boolean)
  const key = words.slice(0, 2).join(' ')
  if (key.length < 5) return null
  if (words.slice(0, 2).every(w => cityWords.has(w) || GENERIC_NAME_WORDS.has(w))) return null
  return key
}

// Words that start many event titles and appear in ordinary pitches
const GENERIC_NAME_WORDS = new Set([
  'live', 'music', 'night', 'nights', 'show', 'shows', 'comedy', 'dinner', 'date', 'open', 'mic',
  'party', 'festival', 'fest', 'tour', 'concert', 'event', 'events', 'trivia', 'karaoke', 'happy',
  'hour', 'free', 'family', 'weekend', 'friday', 'saturday', 'sunday', 'annual', 'summer', 'fall',
  'winter', 'spring', 'holiday', 'tasting', 'wine', 'beer', 'food', 'market', 'farmers', 'art',
  'arts', 'jazz', 'and', 'of', 'at', 'in', 'on', 'with', 'a', 'an',
])

/**
 * Resolve each AI pick to the row it is really about. The model refers to rows
 * by number and must echo the title; if the number and title disagree, the
 * title wins. A pitch that talks about a different candidate is moved to that
 * candidate (if it isn't already picked) or dropped, so a write-up can never
 * appear under the wrong venue.
 */
function matchPicksToRows<P extends { n?: number | string; id?: string; title?: string; pitch: string }>(
  aiPicks: P[],
  rows: EventRow[],
  city: string,
): Array<{ p: P; r: EventRow }> {
  const cityWords = new Set(normName(city).split(' ').filter(w => w.length > 2))
  const keys = rows.map(r => nameKey(r.title, cityWords))
  const byTitle = (t: string) => {
    const nt = normName(t)
    return rows.findIndex(r => normName(r.title) === nt)
  }
  const titleAgrees = (row: EventRow, t: string) => {
    const a = normName(row.title), b = normName(t)
    return a === b || a.includes(b) || b.includes(a)
  }

  const used = new Set<number>()
  const out: Array<{ p: P; r: EventRow }> = []

  for (const p of aiPicks) {
    // 1. Candidate from the number (or a legacy id)
    let idx = -1
    const n = Number(String(p.n ?? '').replace(/^#/, ''))
    if (Number.isInteger(n) && n >= 1 && n <= rows.length) idx = n - 1
    else if (p.id) idx = rows.findIndex(r => r.id === String(p.id).replace(/^ID:\s*/i, '').trim())

    // 2. The echoed title overrides a mismatched number
    if (p.title && (idx < 0 || !titleAgrees(rows[idx], p.title))) {
      const t = byTitle(p.title)
      if (t >= 0) idx = t
    }
    if (idx < 0) continue

    // 3. The pitch must be about this row, not another candidate
    const pitch = normName(p.pitch ?? '')
    const ownKey = keys[idx]
    const mentionsOwn = !!ownKey && pitch.includes(ownKey)
    if (!mentionsOwn) {
      const other = keys.findIndex((k, i) => i !== idx && !!k && pitch.includes(k))
      if (other >= 0) {
        if (used.has(other)) continue // describes a venue already shown — drop it
        idx = other
      }
    }

    if (used.has(idx)) continue
    // Two locations of the same place (Slackwater SLC + Slackwater Sandy) count once
    const brand = brandWord(rows[idx].title)
    if (brand && out.some(o => brandWord(o.r.title) === brand)) continue
    used.add(idx)
    out.push({ p, r: rows[idx] })
  }
  return out
}

// Common first words that don't identify a business on their own
const NON_BRAND_WORDS = new Set([
  'little', 'grand', 'golden', 'royal', 'happy', 'great', 'south', 'north', 'west', 'east', 'rocky',
  'mountain', 'valley', 'river', 'canyon', 'desert', 'summit', 'urban', 'downtown', 'historic',
  'original', 'famous', 'classic', 'american', 'mexican', 'italian', 'french', 'japanese', 'chinese',
])

function brandWord(title: string): string | null {
  const first = normName(title).replace(/^the /, '').split(' ')[0] ?? ''
  return first.length >= 6 && !NON_BRAND_WORDS.has(first) ? first : null
}

// ---------------------------------------------------------------------------
// POST /api/recommend
// Body: { city, answers, questionIds?, mode?, tz?, lat?, lng?, filters? }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      city?: string
      answers: string[]
      /** Question id for each answer (feeling, occasion, party, duration, priority, budget, killswitch) */
      questionIds?: string[]
      /** Homepage slide that launched the survey (foodie, date-night, music, ...) */
      mode?: string
      /** Visitor's IANA time zone, e.g. America/Denver */
      tz?: string
      lat?: number
      lng?: number
      filters?: { budget?: string; crew?: string; when?: string }
      /** Include per-source candidate counts in the response (no content, no keys) */
      debug?: boolean
      /** 'tourist' = visiting, show the must-sees done right; 'local' (default) = hidden spots */
      traveler?: string
    }

    const { answers } = body
    const mode       = body.mode ?? ''
    const isTourist  = body.traveler === 'tourist'
    const userTz     = safeTz(body.tz)
    const questionIds = Array.isArray(body.questionIds) && body.questionIds.length === answers?.length
      ? body.questionIds
      : null
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
    const { start: dateStart, end: dateEnd } = getDateRange(timeframe, userTz)
    const maxBudget = budgetMax(filters.budget ? [filters.budget] : [])
    const catHints  = categoryHints(answers, mode)
    const wantsFoodOnly = !!catHints && catHints.every(c => c === 'Food & Drink')
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
        // City-level label only — per-venue distances replace it when we have coordinates
        cities.push({ name: localCity, distanceLabel: `In ${localCity}`, isLocal: true, lat, lng })
      }
      if (regionalCity && regionalCity !== localCity) {
        cities.push({
          name:          regionalCity,
          distanceLabel: regionalDist ? driveTimeLabel(regionalDist) : 'Nearby',
          isLocal:       false,
          lat:           regionalGeo?.resultLat,
          lng:           regionalGeo?.resultLng,
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
          fetchLiveSerpEvents(cities, timeframe, expType, userTz),
          fetchTicketmasterLive(cities, dateStart, dateEnd,
            typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null),
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


    // Google Places (New): high-quality venue signals — requires GOOGLE_PLACES_API_KEY
    const googlePlacesPromise = hasGps && typeof lat === 'number' && typeof lng === 'number'
      ? searchNearbyVenues(wantsFoodOnly
          ? { lat, lng, maxResults: 15, radiusMeters: 25000, typeGroups: FOOD_TYPE_GROUPS }
          : { lat, lng, maxResults: 9 })
          .then(rows => rows as EventRow[])
          .catch(() => [] as EventRow[])
      : Promise.resolve([] as EventRow[])

    // Curated venues: hand-selected date-night spots from Supabase
    const curatedPromise = resolvedCity
      ? getCuratedVenues({
          city: resolvedCity,
          userLat: typeof lat === 'number' ? lat : undefined,
          userLng: typeof lng === 'number' ? lng : undefined,
          limit: 6,
        })
          .then(rows => rows as EventRow[])
          .catch(() => [] as EventRow[])
      : Promise.resolve([] as EventRow[])

    // Local secrets: hidden spots anyone has shared, within ~40 miles
    const secretsPromise = hasGps && typeof lat === 'number' && typeof lng === 'number'
      ? getNearbySecrets({ lat, lng })
          .then(rows => rows as EventRow[])
          .catch(() => [] as EventRow[])
      : Promise.resolve([] as EventRow[])

    // Real, well-known places (Wikipedia), anywhere in the world — landmarks,
    // shrines, lakes, parks — so a pick never depends on Google or memory alone
    const wantsOutdoors = !catHints || catHints.some(c => c === 'Outdoors' || c === 'Sports & Outdoors')
    const wantsCulture  = !catHints || catHints.includes('Arts & Culture')
    const wikiPromise = hasGps && typeof lat === 'number' && typeof lng === 'number' && !wantsFoodOnly
      ? getNearbyWikiPlaces({ lat, lng, outdoors: wantsOutdoors, culture: wantsCulture })
          .then(rows => rows as EventRow[])
          .catch(() => [] as EventRow[])
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

    const [liveEvents, dbRows, placeProfile, googleRows, curatedRows, secretRows, wikiRows] = await Promise.all([
      liveEventsPromise, dbRowsPromise, profilePromise,
      googlePlacesPromise, curatedPromise, secretsPromise, wikiPromise,
    ])

    // Opt-in diagnostics: counts only, so it is safe to return to any caller
    const debugInfo: Record<string, unknown> | null = body.debug ? {
      resolvedCity, hasGps, mode, catHints, traveler: isTourist ? 'tourist' : 'local',
      timeframe, window: { start: dateStart.toISOString(), end: dateEnd.toISOString() },
      counts: {
        live: liveEvents.length, db: dbRows.length,
        google: googleRows.length, curated: curatedRows.length, secrets: secretRows.length, wiki: wikiRows.length,
      },
      keys: {
        google: !!process.env.GOOGLE_PLACES_API_KEY,
        serper: !!process.env.SERPER_API_KEY, ticketmaster: !!process.env.TICKETMASTER_API_KEY,
      },
      errors: {
        google: googleRows.length === 0 ? lastGooglePlacesError : null,
      },
    } : null
    const dbg = () => (debugInfo ? { debug: debugInfo } : {})

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
        // Date-only listings sit at midnight — keep them for the whole day
        const grace = e.dateOnly ? 86_400_000 : 3_600_000
        if (!isNaN(t) && t < nowMs - grace) return false
      }
      seenLive.add(key)
      return true
    })

    // Include profile-specific activity results (de-duped against live events)
    const profileUnique = profileActivityRows.filter(p => {
      const key = p.title.toLowerCase().slice(0, 40)
      return !seenLive.has(key) && !dbTitles.has(key)
    })

    // Google Places — dedupe by title and place ID
    const seenPlaceIds = new Set<string>()
    const googleUnique = googleRows.filter(g => {
      const key = g.title.toLowerCase().slice(0, 40)
      if (seenLive.has(key) || dbTitles.has(key)) return false
      if (seenPlaceIds.has(g.id)) return false
      seenPlaceIds.add(g.id)
      return true
    })

    // Curated venues — dedupe by name
    const seenCurated = new Set<string>()
    const curatedUnique = curatedRows.filter(c => {
      const key = c.title.toLowerCase().slice(0, 40)
      if (seenLive.has(key) || dbTitles.has(key) || seenPlaceIds.has(key)) return false
      if (seenCurated.has(key)) return false
      seenCurated.add(key)
      return true
    })

    // Curated venues + Google Places float to the front — highest-quality date-night signals
    let rows: EventRow[] = [...curatedUnique, ...googleUnique, ...uniqueLive, ...dbRows, ...profileUnique]

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
        const broadEvents = await fetchLiveSerpEvents([fallbackCity], 'Planning Ahead', '', userTz)
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

    // ── 6c. Final filters — run after every backfill step so nothing undoes them ─
    // Local secrets go first (added here so no backfill above can drop them);
    // the filters below still decide whether they fit this request
    rows = [...secretRows, ...rows.filter(r => r.source !== 'secret')]
    // Wikipedia places go last, skipping any another source already lists
    const listed = rows.map(r => r.title)
    rows = [...rows, ...wikiRows.filter(w => !listed.some(t => sameNamedPlace(t, w.title) || sameNamedPlace(w.title, t)))]

    // Never offer a chain restaurant/venue — fewer picks beats a generic one
    const beforeChains = rows.length
    rows = rows.filter(r => !isChain(r.title) && !(r.source === 'activity' && isChain(r.venue_name)))
    if (debugInfo) debugInfo.chainsRemoved = beforeChains - rows.length

    // A blog post or travel guide is homework, not a pick — and where paid
    // placements hide. (Later: pull the places they name out as their own rows.)
    const beforeArticles = rows.length
    rows = rows.filter(r => !looksLikeArticle(r))
    if (debugInfo) debugInfo.articlesRemoved = beforeArticles - rows.length

    // Category relevance: if they asked for food, show food. Off-topic entries
    // are never used to pad the list — two great picks beat three with filler.
    // With nothing on-topic, the knowledge fallback below suggests the right kind.
    if (catHints) {
      const onTopic = rows.filter(r => catHints.includes(r.category))
      rows = onTopic
      if (debugInfo) debugInfo.onTopic = onTopic.length
    }

    // Dealbreaker: drop what breaks it — unless that would leave fewer than 3,
    // in which case just enough of them stay to fill, flagged for a disclaimer
    const dealIdx = questionIds ? questionIds.indexOf('killswitch') : answers.length - 1
    const dealbreaker = dealbreakerFor(answers[dealIdx])
    if (dealbreaker) {
      const clear = rows.filter(r => !dealbreaker.breaks(r))
      const breaking = rows.filter(r => dealbreaker.breaks(r))
      const fillers = clear.length >= 3 ? [] : breaking.slice(0, 3 - clear.length)
      fillers.forEach(r => { r.bendsDealbreaker = true })
      rows = [...clear, ...fillers]
      if (debugInfo) debugInfo.dealbreaker = { clear: clear.length, removed: breaking.length - fillers.length, keptWithNote: fillers.length }
    }

    // ── 7a. Knowledge fallback — nothing usable, ask Claude from memory ────────
    // Used when no candidates survive the filters, and when the AI looks at the
    // candidates and finds none worth recommending.
    const knowledgePicks = async (reason: string, alreadyPicked: string[] = []) => {
      if (debugInfo) debugInfo.knowledgeReason = reason
      const anthropicKeyKb = process.env.ANTHROPIC_API_KEY
      if (!anthropicKeyKb) return []

      const locationKb = hasGps ? geoDisplayName : city
      const kbKillIdx = questionIds ? questionIds.indexOf('killswitch') : -1
      const kbKillSwitch = kbKillIdx >= 0 ? answers[kbKillIdx] : answers[answers.length - 1]
      const kbAnswerSummary = [
        answers[0] ? `- What they want: ${answers[0]}` : '',
        answers.length > 2 && answers[1] ? `- Occasion: ${answers[1]}`  : '',
        answers.length > 2 && answers[2] ? `- Party: ${answers[2]}`     : '',
        answers.length > 2 && answers[3] ? `- Duration: ${answers[3]}`  : '',
        kbKillSwitch && kbKillSwitch !== answers[0] ? `- What to avoid: ${kbKillSwitch}` : '',
        filters.crew   ? `- Who they're with: ${filters.crew}` : '',
        filters.budget ? `- Budget: ${filters.budget}`         : '',
        filters.when   ? `- Timing: ${filters.when}`           : '',
        isTourist ? '- Visiting as a tourist: wants what this place is known for, done right'
                  : '- Wants to explore like a local: hidden local favorites, not the tourist circuit',
      ].filter(Boolean).join('\n')

      const kbNow = new Date().toLocaleString('en-US', {
        timeZone: userTz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      const kbPoint = hasGps && typeof lat === 'number' && typeof lng === 'number'
        ? ` (coordinates ${lat.toFixed(3)}, ${lng.toFixed(3)})` : ''
      const kbPrompt = `You are an expert local guide helping someone find the perfect thing to do in ${locationKb || 'their city'}${kbPoint}. Right now it is ${kbNow} there.

Their profile:
${kbAnswerSummary}

No live event data is available right now. Draw on your deep knowledge of ${locationKb || 'this city'} to suggest up to 5 genuinely specific, actionable things this person should do, best first (each is checked on Google Maps before anyone sees it; the best 3 that check out are shown). ${isTourist
  ? 'They are visiting: favor what this place is genuinely known for — landmarks, signature views and experiences — done the right way. Never tell them to skip the famous spots.'
  : 'Think like a trusted local friend: hidden local favorites over the tourist circuit.'}

Requirements:
- Real, specific venues or activity types with enough detail to actually go do them
- WHERE: every pick must be in or within about 30 miles of ${locationKb || 'this place'}${kbPoint}. Many towns share a name with a more famous place (Paris, Texas is not Paris, France) — never suggest anything from the other one.
- ONLY WHAT YOU'RE SURE OF: suggest a place only if you are confident it exists there and is open to the public. If you can't name 3 with confidence, return fewer — even an empty array []. A wrong pick costs us their trust.
- Each pick must scratch the itch: "${answers[0] ?? 'a memorable evening'}"
- Nothing that triggers: "${kbKillSwitch || 'none stated'}"
- Never a chain, a hotel, a mall or a store${alreadyPicked.length ? `
- Already recommended, so suggest different places: ${alreadyPicked.join('; ')}` : ''}
- Pitches make not going feel like a missed opportunity — write to close, not to describe. First-person energy, present tense. Max 30 words.
- Pitch only what's true of the place itself: no invented prices, vendors, hours, crowd levels or "open late" claims.${isTourist ? ' They are a tourist — never say "no tourists" or "locals only".' : ''}
- "search" is what to type into Google Maps to find exactly this place: its proper name plus the town.

Return ONLY a valid JSON array:
[
  {"id":"kb_1","rank":1,"title":"<specific activity or venue>","search":"<place name, town>","price":"<rough cost or Free>","category":"<music|food|art|sports|outdoor|general>","pitch":"<urgent, personal, accurate>"},
  {"id":"kb_2","rank":2,"title":"...","search":"...","price":"...","category":"...","pitch":"..."}
]`

      try {
        const kbRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKeyKb, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: kbPrompt }] }),
        })
        if (kbRes.ok) {
          const kbData = await kbRes.json()
          const kbText: string = kbData.content?.[0]?.text ?? '[]'
          const kbMatch = kbText.match(/\[[\s\S]*\]/)
          if (kbMatch) {
            type KbPick = { id: string; rank: number; title: string; search?: string; venue?: string; price: string; category: string; pitch: string }
            const kbPicks = (JSON.parse(kbMatch[0]) as KbPick[]).slice(0, 5)

            // Every suggestion from memory must check out on Google Maps near
            // the searcher — made-up or wrong-town places never reach anyone
            const canVerify = hasGps && typeof lat === 'number' && typeof lng === 'number' && !!process.env.GOOGLE_PLACES_API_KEY
            const checked = canVerify
              ? await Promise.all(kbPicks.map(async p => ({
                  p,
                  place: await verifyPlace({ query: p.search || `${p.title} ${locationKb}`, lat: lat as number, lng: lng as number }),
                })))
              : kbPicks.map(p => ({ p, place: undefined }))

            const wantsNow = timeframe === 'Now'
            const kept = checked.filter(({ p, place }) =>
              place === undefined ||                                  // couldn't check (no GPS/key)
              (place !== null && sameNamedPlace(`${p.title} ${p.search ?? ''}`, place.name, locationKb) &&
               !isChain(place.name) && !(wantsNow && place.openNow === false)))
            if (debugInfo) debugInfo.knowledge = {
              suggested: kbPicks.length, verified: kept.length,
              dropped: checked.filter(c => !kept.includes(c)).map(c => c.p.title),
            }

            // Memory gets the place right but embellishes it ("climb to the
            // observation deck"), so rewrite each pitch from Google's facts only
            const top = kept.slice(0, 3)
            const grounded = top.some(k => k.place)
              ? await groundPitches(anthropicKeyKb, top.map(k => ({ title: k.p.title, pitch: k.p.pitch, place: k.place ?? null })),
                  { want: answers[0] ?? '', town: locationKb, isTourist })
              : null
            if (debugInfo) (debugInfo.knowledge as Record<string, unknown>).grounded =grounded ? grounded.filter(Boolean).length : 0

            const picks = top.map(({ p, place }, i) => ({
              id: p.id, rank: i + 1, pitch: grounded?.[i]?.pitch ?? p.pitch,
              title: grounded?.[i]?.title ?? p.title,
              venue: place ? (place.name !== (grounded?.[i]?.title ?? p.title) ? place.name : '') : (p.venue ?? ''),
              dateFormatted: place?.openNow === true ? 'Open now' : place?.openNow === false ? 'Closed right now' : '',
              priceFormatted: p.price,
              // The verified Google Maps listing, so they can check it before they go
              ticketUrl: place?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.title} ${locationKb}`)}`,
              imageUrl: place?.photoUrl ?? fallbackImg(p.category),
              category: p.category, source: 'knowledge',
              distanceLabel: place?.distanceLabel,
            }))
            return picks
          }
        }
      } catch { /* fall through */ }

      return []
    }
    const knowledgeFallback = async (reason: string) =>
      NextResponse.json({ ...dbg(), picks: await knowledgePicks(reason) })

    if (rows.length === 0) return knowledgeFallback('no_candidates')

    // ── 7. Build AI prompt ───────────────────────────────────────────────────
    const locationLabel = hasGps
      ? `near your location (${geoDisplayName})`
      : `in ${resolvedCity}`

    const eventList = rows
      .map((r, i) => {
        const price = r.source === 'secret' ? 'price varies'
                    : r.price_min === 0 ? 'Free'
                    : r.price_min ? `$${r.price_min}`
                    : r.priceTier ? '$'.repeat(r.priceTier)
                    : 'price unknown'
        const date  = r.date_start
          ? `${formatDate(r.date_start, r.tz ?? userTz, r.dateOnly)} (${relativeDay(r.date_start, r.tz ?? userTz)})`
          : r.source === 'secret' || r.source === 'wiki' ? 'No fixed time (place)'
          : 'No fixed time (venue/activity)'
        const desc  = r.ai_description ?? r.description?.slice(0, 150) ?? ''
        const src   = r.source === 'secret'        ? '[LOCAL SECRET]'
                    : r.source === 'wiki'          ? '[wikipedia]'
                    : r.id.startsWith('curated-') ? '[curated]'
                    : r.id.startsWith('gplace-')  ? '[google]'
                    : r.source === 'activity'      ? '[activity]'
                    : r.source === 'facebook'      ? '[facebook]'
                    : r.id.startsWith('live_')     ? '[live]'
                    : '[db]'
        const dist  = r.distanceLabel ? ` | ${r.distanceLabel}` : ''
        const bends = r.bendsDealbreaker ? ' [BENDS DEALBREAKER]' : ''
        return `#${i + 1} ${src}${bends} | ${r.title} | ${r.venue_name ?? 'Local venue'} | ${date} | ${price} | ${r.category}${dist}${desc ? ` | ${desc}` : ''}`
      })
      .join('\n')

    // Label each answer by its question id when the client sends them (each
    // slide asks different questions in a different order); otherwise fall
    // back to the old positional guess.
    const isDeepSurvey = answers.length >= 4
    const QUESTION_LABELS: Record<string, string> = {
      feeling: 'What they want', occasion: 'Occasion', party: 'Who is coming',
      duration: 'Time available', priority: 'What matters most', budget: 'Budget',
      killswitch: 'Dealbreaker (avoid)',
    }
    const labelMap = questionIds
      ? questionIds.map(id => QUESTION_LABELS[id] ?? id)
      : isDeepSurvey
        ? ['Vibe', 'Occasion', 'Party', 'Duration', 'Vibe killer (avoid)']
        : ['Feeling target', 'Vibe killer (avoid)']
    const answerSummary = [
      ...answers.map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`),
      ...(filters.when   ? [`- Timing preference: ${filters.when}`]   : []),
      ...(filters.crew   ? [`- Crew: ${filters.crew}`]                : []),
      ...(filters.budget ? [`- Budget: ${filters.budget}`]            : []),
      `- Visiting as: ${isTourist ? 'a tourist — wants the must-sees, done right' : 'a local — wants what locals love, not the tourist circuit'}`,
    ].join('\n')
    const killIdx = questionIds ? questionIds.indexOf('killswitch') : -1
    const killSwitch = (killIdx >= 0 ? answers[killIdx] : answers[answers.length - 1]) ?? ''

    const hourNow = Number(new Date().toLocaleString('en-US', { timeZone: userTz, hour: 'numeric', hourCycle: 'h23' }))
    const lateNight = hourNow >= 23 || hourNow < 5
    const timeframeInstruction =
      timeframe === 'Now' && lateNight
        ? "It's the middle of the night and they want something RIGHT NOW. Only pick things that are genuinely open or doable at this hour (24-hour diners, late-night spots, stargazing, a night drive, a sunrise viewpoint to head to). Be honest that options are thin — never pretend a closed place is open." :
      timeframe === 'Now'             ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tonight'         ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tomorrow'        ? 'They want the next open day (if it is after midnight, that means later today) — prefer daytime and evening plans for that day, not anything happening right now.' :
      timeframe === 'This Week'       ? 'They are planning a day later this week — spread picks across the coming days and name the day for each event.' :
      timeframe === 'Anytime'         ? 'They are just exploring what this place is great for — favor timeless local gems and standout upcoming events; no urgency, no "tonight" pressure.' :
      timeframe === 'Soon'            ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
      timeframe === 'This weekend'    ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
      timeframe === 'Next Week'       ? 'Prefer events happening NEXT WEEK (3–14 days from now).' :
      timeframe === 'Planning Ahead'  ? 'Show events across the next 2–8 weeks — the user is calendar-planning, highlight anything worth booking early.' :
      timeframe === 'Planning a Trip' ? 'Show a variety of events 2 weeks to 3 months out — user is trip planning, include destination-worthy or unique experiences.' :
      timeframe === 'Default'         ? 'Show the best options happening in the next 2–3 days — no specific time constraint, so prioritise quality and relevance.' :
      'Show a variety across the coming weeks — the user is calendar-planning, so spread dates out and highlight anything worth booking early.'

    const hasActivities = rows.some(r => r.source === 'activity')
    const activityNote  = hasActivities
      ? " Some entries are [activity] — timeless things to do (restaurants, bars, venues, experiences) that don't have a fixed event time. Include these — they're often the best picks."
      : ''
    const hasCurated = curatedUnique.length > 0
    const curatedNote = hasCurated
      ? ' Entries tagged [curated] are hand-picked YeahDoodle date-night gems — they have extra credibility and are verified great for couples. Strongly prefer them when they match the vibe.'
      : ''

    const travelerNote = isTourist
      ? `
11. THEY'RE VISITING — Favor what this place is genuinely known for: landmarks, signature experiences, the dish or view people come here for, and anything worth booking ahead. Still local and independent, still no tourist traps sold mainly on hype — the version a well-traveled friend would send them to.`
      : `
11. THEY LIVE HERE (OR WANT TO FEEL LIKE IT) — Favor hidden, local-favorite spots over famous landmarks and tourist circuits. Skip anything mainly sold to visitors.`

    const secretNote = rows.some(r => r.source === 'secret')
      ? `\n10. LOCAL SECRETS — Entries tagged [LOCAL SECRET] are hidden spots shared by people who know the area: exactly what YeahDoodle exists to find. Every one listed has already been checked as a fit for this request, so always pick one as rank 1 (the nearest if there are several). Its card shows how to get there, so the pitch sells the experience — never invent directions, hours or prices.`
      : ''

    const wikiNote = rows.some(r => r.source === 'wiki')
      ? `
12. WIKIPEDIA PLACES — Entries tagged [wikipedia] are real, well-known places. ${isTourist
          ? 'Great for a visitor: pick them freely when they fit.'
          : 'Fine when nothing more local fits, but prefer a local favorite.'} Their description is all we know — pitch only that, never invent features, hours or prices.`
      : ''

    const isDateMode = ['date-night', 'couple', 'first-date'].includes(mode) || (!mode && isDeepSurvey)
    const nowLocal = new Date().toLocaleString('en-US', {
      timeZone: userTz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })

    const personaLine = isDateMode
      ? `You are YeahDoodle's date night scout. Your ONLY job is to help this couple plan a date night they'll actually remember. You are NOT writing venue descriptions. You are writing the case for why they should go.`
      : `You are YeahDoodle's local scout. Your ONLY job is to find the 3 best options for this person. You are NOT writing venue descriptions. You are writing the case for why they should go.`

    const missionLine = isDateMode
      ? `Your mission: Pick the 3 date night options most likely to make this couple put down their phones and actually go.`
      : `Your mission: Pick the 3 options most likely to make this person stop scrolling and actually go.`

    const pitchGuidance = isDateMode
      ? `4. WRITE TO CLOSE — Each pitch is why a couple should go, not a description. Write like a trusted friend: urgent, specific, romantic. "This is the spot where..." not "This venue features..." Make staying in feel like a mistake. Max 30 words. No filler.`
      : `4. WRITE TO CLOSE — Each pitch is why this person should go. Write like a trusted local friend: urgent, specific, personal. Make doing nothing feel like a miss. Max 30 words. No filler.`

    const prompt = `${personaLine}

Right now it is ${nowLocal} where they are.

The person:
${answerSummary}

What's available ${locationLabel}:
${eventList}

${missionLine}

Follow every rule:
1. SCRATCH THE ITCH — They said "${expType}". Every pick must deliver exactly that — no substitutes, no watered-down versions.${catHints ? ` Only pick entries whose category is ${catHints.join(' or ')} — if fewer than 3 qualify, return fewer.` : ''}
2. KILL THE DEALBREAKER — They want to avoid "${killSwitch}". Any pick that even hints at this is disqualified, no exceptions.
3. ${timeframeInstruction}
${pitchGuidance}
5. MIX IT UP — 2 picks that directly match their itch + 1 that surprises them while still matching it.${activityNote}${curatedNote}
6. BE ACCURATE — Never invent facts. Only say "tonight" or "today" for entries marked (TODAY); say "tomorrow" only for (TOMORROW); otherwise name the day. Never claim something is close, walkable or "right here" unless its distance says so. Entries with no fixed time are venues: don't call them events. Never describe an entry as something it isn't — a concert is not a dinner, a band name is not a restaurant; if an entry doesn't fit the request, skip it.

7. ONE PLACE PER PITCH — Each pitch describes only the entry you picked. Never mention or borrow details from any other entry.
8. LOCAL GEMS ONLY — YeahDoodle exists to find the local, independent, one-of-a-kind spot a friend who lives here would take them to. Never pick a national or regional chain or anything generic. If fewer than 3 entries are genuinely worth it, return fewer — an empty slot beats a forgettable pick. Never mention chains or compare a pick to them.
9. BENDING THE DEALBREAKER — Entries marked [BENDS DEALBREAKER] break "${killSwitch}" and are only listed because few options clear it. Pick one only when no unmarked entry fits that slot. Its card already carries a note owning that, so the pitch must sell what makes it worth it — never claim the opposite of the dealbreaker (no "cheap", "no reservation needed", "quiet" for those).${secretNote}${travelerNote}${wikiNote}

Return ONLY a valid JSON array — no markdown, no explanation. "n" is the entry's number from the list and "title" is that entry's title copied exactly:
[
  {"n":<number>,"title":"<exact title of entry n>","rank":1,"pitch":"<urgent, personal, accurate>"},
  {"n":<number>,"title":"<...>","rank":2,"pitch":"<...>"},
  {"n":<number>,"title":"<...>","rank":3,"pitch":"<...>"}
]`

    const anthropicKey = process.env.ANTHROPIC_API_KEY

    // ── 8. No API key: return top 3 ──────────────────────────────────────────
    if (!anthropicKey) {
      const top3 = rows.slice(0, 3).map((r, i) => ({
        id:             r.id,
        rank:           i + 1,
        pitch:          r.ai_description?.slice(0, 120) ?? r.description?.slice(0, 120) ?? 'A local favorite worth checking out tonight.',
        title:          r.title,
        venue:          r.venue_name ?? '',
        dateFormatted:  formatDate(r.date_start, r.tz ?? userTz, r.dateOnly),
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl:      r.ticket_url,
        imageUrl:       r.image_url ?? fallbackImg(r.category),
        category:       r.category,
        source:         r.source,
        distanceLabel:  r.distanceLabel,
        dealbreakerNote: r.bendsDealbreaker ? dealbreaker?.note : undefined,
        secret: r.secret,
      }))
      await enrichPickImages(top3)
      return NextResponse.json({ ...dbg(), picks: top3 })
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

    if (!aiRes.ok) {
      // Anthropic unavailable — serve raw top-3 rather than returning empty
      console.warn('[recommend] Anthropic non-ok:', aiRes.status, '— raw fallback')
      const fb = rows.slice(0, 3).map((r, i) => ({
        id: r.id, rank: i + 1,
        pitch: r.ai_description?.slice(0, 120) ?? 'A great local experience.',
        title: r.title, venue: r.venue_name ?? '',
        dateFormatted: formatDate(r.date_start, r.tz ?? userTz, r.dateOnly),
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl: r.ticket_url, imageUrl: r.image_url ?? fallbackImg(r.category),
        category: r.category, source: r.source, distanceLabel: r.distanceLabel,
        dealbreakerNote: r.bendsDealbreaker ? dealbreaker?.note : undefined,
        secret: r.secret,
      }))
      await enrichPickImages(fb)
      const errBody = await aiRes.text().catch(() => '')
      const errType = errBody.match(/"message":"([^"]{0,120})/)?.[1] ?? ''
      return NextResponse.json({ ...dbg(), picks: fb, fallbackReason: `ai_http_${aiRes.status}${errType ? `: ${errType}` : ''}` })
    }

    const aiData  = await aiRes.json()
    const rawText: string = aiData.content?.[0]?.text ?? '[]'

    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      // Bad AI response — serve raw top-3 rather than returning empty
      console.warn('[recommend] No JSON in AI response — raw fallback')
      const fb = rows.slice(0, 3).map((r, i) => ({
        id: r.id, rank: i + 1,
        pitch: r.ai_description?.slice(0, 120) ?? 'A great local experience.',
        title: r.title, venue: r.venue_name ?? '',
        dateFormatted: formatDate(r.date_start, r.tz ?? userTz, r.dateOnly),
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl: r.ticket_url, imageUrl: r.image_url ?? fallbackImg(r.category),
        category: r.category, source: r.source, distanceLabel: r.distanceLabel,
        dealbreakerNote: r.bendsDealbreaker ? dealbreaker?.note : undefined,
        secret: r.secret,
      }))
      await enrichPickImages(fb)
      return NextResponse.json({ ...dbg(), picks: fb, fallbackReason: 'ai_no_json' })
    }

    type AiPick = { n?: number | string; id?: string; title?: string; rank: number; pitch: string }
    const aiPicks = JSON.parse(jsonMatch[0]) as AiPick[]
    const matched = matchPicksToRows(aiPicks, rows, resolvedCity)

    // A local secret that survived the category filter fits the request —
    // it always gets the top slot, even if the AI passed it over. (With no
    // category to check against, the AI decides whether it fits.)
    const topSecret = catHints ? rows.find(r => r.source === 'secret') : undefined
    if (topSecret && !matched.some(m => m.r.source === 'secret')) {
      const why = (topSecret.description ?? '').replace(/^[^:]*:\s*/, '').replace(/\s*\(Best:.*$|\s*\(Heads up:.*$/, '')
      matched.unshift({ p: { rank: 1, pitch: why || 'A spot the locals keep to themselves.' }, r: topSecret })
      matched.forEach((m, i) => { m.p.rank = i + 1 })
      if (debugInfo) debugInfo.secretForced = true
    }

    const picks = matched
      .slice(0, 3)
      .map(({ p, r }) => {
        return {
          id:             r.id,
          rank:           p.rank,
          pitch:          r.bendsDealbreaker ? bendSafePitch(p.pitch, dealbreaker) : p.pitch,
          title:          r.title,
          venue:          r.venue_name ?? '',
          dateFormatted:  formatDate(r.date_start, r.tz ?? userTz, r.dateOnly),
          priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
          ticketUrl:      r.ticket_url,
          imageUrl:       r.image_url ?? fallbackImg(r.category),
          category:       r.category,
          source:         r.source,
          distanceLabel:  r.distanceLabel,
          dealbreakerNote: r.bendsDealbreaker ? dealbreaker?.note : undefined,
          secret: r.secret,
        }
      })

    // The AI found nothing here worth recommending — never pad with raw rows;
    // suggest from knowledge instead
    if (picks.length === 0) return knowledgeFallback(aiPicks.length === 0 ? 'ai_none_fit' : 'ai_unmatched')

    // Enrich images for the 3 AI-selected picks (free: OG tag → Unsplash → fallback)
    await enrichPickImages(picks)

    // A Wikipedia place comes with one line of description, so the AI's pitch
    // tends to embellish it — rewrite it from Wikipedia plus Google's facts
    const wikiAt = picks.flatMap((p, i) => p.source === 'wiki' ? [i] : [])
    const groundKey = process.env.ANTHROPIC_API_KEY
    if (wikiAt.length && groundKey) {
      const town = hasGps ? geoDisplayName : resolvedCity
      const canCheck = hasGps && typeof lat === 'number' && typeof lng === 'number'
      const found = await Promise.all(wikiAt.map(i => canCheck
        ? verifyPlace({ query: `${picks[i].title} ${town}`, lat: lat as number, lng: lng as number })
        : Promise.resolve(null)))
      const grounded = await groundPitches(groundKey, wikiAt.map((i, k) => {
        const place = found[k]
        const r = rows.find(x => x.id === picks[i].id)
        return {
          title: picks[i].title, pitch: picks[i].pitch,
          place: place && sameNamedPlace(picks[i].title, place.name, town) ? place : null,
          note: (r?.description ?? '').replace(/\s*\(on Wikipedia[^)]*\)\s*$/, ''),
        }
      }), { want: answers[0] ?? '', town, isTourist })
      wikiAt.forEach((i, k) => { const g = grounded?.[k]; if (g) picks[i].pitch = g.pitch })
      if (debugInfo) debugInfo.wikiGrounded = grounded ? grounded.filter(Boolean).length : 0
    }

    // Only one or two real candidates fit — fill the rest with suggestions
    // that checked out on Google Maps, never with filler
    if (picks.length < 3) {
      const extra = (await knowledgePicks('top_up', picks.map(p => p.title)))
        .filter(k => !picks.some(p => sameNamedPlace(p.title, k.title)))
        .slice(0, 3 - picks.length)
        .map((k, i) => ({ ...k, rank: picks.length + i + 1 }))
      return NextResponse.json({ ...dbg(), picks: [...picks, ...extra] })
    }

    return NextResponse.json({ ...dbg(), picks })

  } catch (err) {
    console.error('[recommend] Error:', (err as Error).message)
    return NextResponse.json(
      { picks: [], error: 'Failed to generate recommendations' },
      { status: 500 },
    )
  }
}
