// ---------------------------------------------------------------------------
// Google Places API (New) client
// Docs: https://developers.google.com/maps/documentation/places/web-service
// Setup: Google Cloud Console → Enable "Places API (New)" → Create API key
//        → Add as GOOGLE_PLACES_API_KEY in Vercel env vars
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GooglePlace {
  id: string
  displayName: { text: string; languageCode?: string }
  formattedAddress: string
  location: { latitude: number; longitude: number }
  rating?: number
  userRatingCount?: number
  /** Enum string from Google */
  priceLevel?: 'PRICE_LEVEL_FREE' | 'PRICE_LEVEL_INEXPENSIVE' | 'PRICE_LEVEL_MODERATE' | 'PRICE_LEVEL_EXPENSIVE' | 'PRICE_LEVEL_VERY_EXPENSIVE' | string
  editorialSummary?: { text: string }
  regularOpeningHours?: {
    openNow: boolean
    weekdayDescriptions?: string[]
    periods?: Array<{
      open: { day: number; hour: number; minute: number }
      close?: { day: number; hour: number; minute: number }
    }>
  }
  photos?: Array<{ name: string; widthPx: number; heightPx: number }>
  websiteUri?: string
  reservable?: boolean
  servesDinner?: boolean
  servesCocktails?: boolean
  servesWine?: boolean
  liveMusic?: boolean
  outdoorSeating?: boolean
  goodForGroups?: boolean
  goodForWatchingSports?: boolean
  primaryType?: string
  types?: string[]
}

// Shape returned from searchNearbyVenues — enriched with scoring
export interface ScoredPlace extends GooglePlace {
  datNightScore: number  // 0–100
}

// Minimal EventRow shape expected by /api/recommend/route.ts
export interface PlaceEventRow {
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
  distanceLabel: string
  source: 'activity'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fields to request — kept focused to avoid billable SKU upgrades */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.editorialSummary',
  'places.regularOpeningHours',
  'places.photos',
  'places.websiteUri',
  'places.reservable',
  'places.servesDinner',
  'places.servesCocktails',
  'places.servesWine',
  'places.liveMusic',
  'places.outdoorSeating',
  'places.goodForGroups',
  'places.primaryType',
].join(',')

const BASE_URL = 'https://places.googleapis.com/v1/places:searchNearby'

// Date-night venue type groups — run as separate parallel searches so each
// group competes fairly; Google caps Nearby Search at 20 results per call.
const VENUE_TYPE_GROUPS = [
  // Romantic dining
  ['restaurant', 'fine_dining_restaurant'],
  // Bars & cocktails
  ['bar', 'wine_bar', 'cocktail_bar'],
  // Entertainment & activities
  ['jazz_club', 'comedy_club', 'bowling_alley', 'movie_theater', 'escape_room', 'night_club'],
]

// ---------------------------------------------------------------------------
// Core API call
// ---------------------------------------------------------------------------

async function fetchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  types: string[],
  radiusMeters: number,
  maxResultCount = 10,
): Promise<GooglePlace[]> {
  try {
    const body = {
      includedTypes: types,
      maxResultCount,
      rankPreference: 'POPULARITY',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
    }

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) {
      console.warn('[google-places] Nearby Search failed', res.status, await res.text())
      return []
    }

    const data = await res.json()
    return (data.places ?? []) as GooglePlace[]
  } catch (err) {
    console.warn('[google-places] fetch error', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Photo URL helper
// ---------------------------------------------------------------------------

/** Returns a direct photo URL from a GooglePlace photo reference */
export function getPhotoUrl(photoName: string, apiKey: string, maxDim = 600): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${maxDim}&maxWidthPx=${maxDim}&key=${apiKey}`
}

// ---------------------------------------------------------------------------
// Date-night venue scoring (0–100)
// ---------------------------------------------------------------------------

/** Maps Google priceLevel enum → numeric 1–4 */
function numericPriceLevel(level?: string): number {
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE:         1,
    PRICE_LEVEL_INEXPENSIVE:  1,
    PRICE_LEVEL_MODERATE:     2,
    PRICE_LEVEL_EXPENSIVE:    3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  }
  return level ? (map[level] ?? 2) : 2
}

/** Maps Google priceLevel enum → dollar-sign string */
export function priceLevelToString(level?: string): string {
  const map: Record<string, string> = {
    PRICE_LEVEL_FREE:         'Free',
    PRICE_LEVEL_INEXPENSIVE:  '$',
    PRICE_LEVEL_MODERATE:     '$$',
    PRICE_LEVEL_EXPENSIVE:    '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  }
  return level ? (map[level] ?? '$$') : '$$'
}

/** Maps Google primaryType → YeahDoodle category */
function placeTypeToCategory(primaryType?: string, types?: string[]): string {
  const t = primaryType ?? ''
  const all = (types ?? []).join(' ')
  if (/restaurant|dining|food|cafe|bistro|sushi|steak/.test(t + all)) return 'Food & Drink'
  if (/wine_bar|cocktail_bar|bar|brewery|pub/.test(t + all))          return 'Nightlife'
  if (/jazz_club|music|karaoke/.test(t + all))                        return 'Music'
  if (/comedy|theater|cinema|movie/.test(t + all))                    return 'Arts & Culture'
  if (/night_club|club/.test(t + all))                                return 'Nightlife'
  if (/bowling|escape_room|arcade|game/.test(t + all))                return 'Activities'
  return 'Activities'
}

/**
 * Score a venue's date-night fit on a 0–100 scale.
 * Higher = better pick for a romantic/social outing.
 */
export function scoreDateNightFit(place: GooglePlace): number {
  let score = 0

  // Rating quality (max 45 pts) — 4.5 = 45, 4.0 = 35, 3.5 = 22, <3 = 0
  const rating = place.rating ?? 0
  const reviews = place.userRatingCount ?? 0
  if (rating >= 4.5 && reviews >= 50)  score += 45
  else if (rating >= 4.3 && reviews >= 30) score += 40
  else if (rating >= 4.0 && reviews >= 20) score += 35
  else if (rating >= 3.7 && reviews >= 10) score += 22
  else if (rating >= 3.5)              score += 12
  // Very few reviews → credibility penalty already built-in above

  // Price calibration for date night (max 15 pts)
  // Sweet spot: $$–$$$. Very cheap or very expensive gets less.
  const price = numericPriceLevel(place.priceLevel)
  if (price === 2) score += 15  // $$ — accessible date night
  else if (price === 3) score += 12  // $$$ — upscale, still valid
  else if (price === 4) score += 6   // $$$$ — special occasion
  else score += 5                    // $ — casual but fine

  // Atmosphere bonuses (max 30 pts)
  if (place.liveMusic)       score += 10
  if (place.servesCocktails) score += 5
  if (place.servesWine)      score += 4
  if (place.outdoorSeating)  score += 5
  if (place.reservable)      score += 4
  if (place.goodForGroups)   score += 2

  // Open now bonus (max 10 pts)
  if (place.regularOpeningHours?.openNow) score += 10

  // Editorial summary bonus — if Google has written about it, it's notable
  if (place.editorialSummary?.text) score += 5

  return Math.min(score, 100)
}

// ---------------------------------------------------------------------------
// Haversine helper (reused from route.ts pattern)
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function driveLabel(km: number): string {
  const miles = km * 0.621371
  if (miles < 0.3) return 'Right here'
  const rawMin = (miles / 28) * 60
  const driveMin = Math.max(2, Math.round(rawMin / 5) * 5)
  return `~${driveMin} min away`
}

// ---------------------------------------------------------------------------
// Convert a GooglePlace → PlaceEventRow for /api/recommend
// ---------------------------------------------------------------------------

export function googlePlaceToRow(
  place: GooglePlace,
  userLat: number,
  userLng: number,
  apiKey: string,
): PlaceEventRow {
  const name       = place.displayName.text
  const category   = placeTypeToCategory(place.primaryType, place.types)
  const km         = haversineKm(userLat, userLng, place.location.latitude, place.location.longitude)
  const photoUrl   = place.photos?.[0]?.name
    ? getPhotoUrl(place.photos[0].name, apiKey)
    : null

  // Build a rich description from available signals
  const rating    = place.rating ? `★ ${place.rating.toFixed(1)} (${place.userRatingCount ?? 0} reviews)` : ''
  const price     = priceLevelToString(place.priceLevel)
  const attrs: string[] = []
  if (place.liveMusic)        attrs.push('Live music')
  if (place.servesCocktails)  attrs.push('Cocktails')
  if (place.servesWine)       attrs.push('Wine')
  if (place.outdoorSeating)   attrs.push('Outdoor seating')
  if (place.reservable)       attrs.push('Reservable')
  if (place.goodForGroups)    attrs.push('Good for groups')
  const attrStr   = attrs.length > 0 ? ' · ' + attrs.join(' · ') : ''
  const priceRating = [rating, price].filter(Boolean).join(' · ')
  const description = place.editorialSummary?.text
    ? place.editorialSummary.text + ' — ' + priceRating + attrStr
    : (priceRating + attrStr).trim()

  return {
    id:           'gplace-' + place.id,
    title:        name,
    venue_name:   name,
    date_start:   null,
    is_free:      place.priceLevel === 'PRICE_LEVEL_FREE',
    price_min:    null,
    price_max:    null,
    category,
    ticket_url:   place.websiteUri ?? null,
    image_url:    photoUrl,
    description:  description || null,
    ai_description: null,
    distanceLabel: driveLabel(km),
    source:       'activity',
  }
}

// ---------------------------------------------------------------------------
// Main export — search nearby date-night venues
// ---------------------------------------------------------------------------

/**
 * Search Google Places for date-night-calibrated venues near a GPS point.
 * Returns up to `maxResults` PlaceEventRows, sorted by date-night score desc.
 * Gracefully returns [] when GOOGLE_PLACES_API_KEY is not set.
 */
export async function searchNearbyVenues(params: {
  lat: number
  lng: number
  radiusMeters?: number   // default 16000 (~10 mi)
  maxResults?: number     // default 9
  openNowOnly?: boolean   // default false — let AI decide; openNow is a bonus in scoring
}): Promise<PlaceEventRow[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return []

  const { lat, lng, radiusMeters = 16000, maxResults = 9, openNowOnly = false } = params

  // Fire all type groups in parallel
  const groupResults = await Promise.all(
    VENUE_TYPE_GROUPS.map(types => fetchNearby(apiKey, lat, lng, types, radiusMeters, 10))
  )

  // Merge, dedupe by place ID, score, sort
  const seen = new Set<string>()
  const scored: ScoredPlace[] = []

  for (const group of groupResults) {
    for (const place of group) {
      if (seen.has(place.id)) continue
      seen.add(place.id)

      // Filter: require at least some rating credibility
      if ((place.rating ?? 0) < 3.5) continue

      // openNowOnly hard filter
      if (openNowOnly && place.regularOpeningHours?.openNow === false) continue

      scored.push({ ...place, datNightScore: scoreDateNightFit(place) })
    }
  }

  // Sort by date-night score descending, take top N
  scored.sort((a, b) => b.datNightScore - a.datNightScore)

  return scored
    .slice(0, maxResults)
    .map(p => googlePlaceToRow(p, lat, lng, apiKey))
}
