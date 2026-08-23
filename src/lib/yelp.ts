// ---------------------------------------------------------------------------
// Yelp Fusion API client
// Docs: https://docs.developer.yelp.com/reference/v3_business_search
// ---------------------------------------------------------------------------

export interface YelpBusiness {
  id: string
  name: string
  url: string
  rating: number
  review_count: number
  price?: string           // "$" | "$$" | "$$$" | "$$$$"
  categories: { alias: string; title: string }[]
  coordinates: { latitude: number; longitude: number }
  location: { display_address: string[] }
  image_url: string | null
  is_closed: boolean
  hours?: { is_open_now: boolean }[]
  distance?: number        // metres from search point
}

interface YelpSearchResponse {
  businesses: YelpBusiness[]
  total: number
}

// ---------------------------------------------------------------------------
// Date-night query terms and their YeahDoodle categories
// ---------------------------------------------------------------------------
export const DATE_NIGHT_TERMS: { term: string; category: string }[] = [
  { term: 'cocktail bars',       category: 'Nightlife'     },
  { term: 'romantic restaurants',category: 'Food & Drink'  },
  { term: 'live music venues',   category: 'Music'         },
  { term: 'rooftop bars',        category: 'Nightlife'     },
  { term: 'escape rooms',        category: 'Activities'    },
  { term: 'comedy clubs',        category: 'Arts & Culture'},
  { term: 'wine bars',           category: 'Food & Drink'  },
  { term: 'bowling alleys',      category: 'Activities'    },
  { term: 'dessert cafes',       category: 'Food & Drink'  },
  { term: 'jazz clubs',          category: 'Music'         },
]

// Map Yelp category aliases to YeahDoodle categories
function mapYelpCategory(cats: YelpBusiness['categories']): string {
  const aliases = cats.map(c => c.alias).join(' ')
  const titles  = cats.map(c => c.title).join(' ').toLowerCase()
  const text    = aliases + ' ' + titles

  if (/music|jazz|blues|karaoke|piano_bars/.test(text))            return 'Music'
  if (/bars|cocktail|wine_bars|nightlife|beer|brewery/.test(text)) return 'Nightlife'
  if (/restaurants|food|brunch|dinner|sushi|steak/.test(text))     return 'Food & Drink'
  if (/arts|gallery|theater|cinema|comedy|museum/.test(text))      return 'Arts & Culture'
  if (/escape_games|bowling|minigolf|arcades|laser_tag/.test(text)) return 'Activities'
  if (/hiking|parks|outdoors|yoga/.test(text))                     return 'Outdoors'
  return 'Activities'
}

// ---------------------------------------------------------------------------
// Core search function
// ---------------------------------------------------------------------------
export async function searchYelp(params: {
  lat: number
  lng: number
  term: string
  radiusMeters?: number   // default 16000 (~10 miles)
  limit?: number          // default 5
  openNow?: boolean       // default true
}): Promise<YelpBusiness[]> {
  const apiKey = process.env.YELP_API_KEY
  if (!apiKey) return []

  const {
    lat, lng, term,
    radiusMeters = 16000,
    limit = 5,
    openNow = true,
  } = params

  const url = new URL('https://api.yelp.com/v3/businesses/search')
  url.searchParams.set('latitude',  String(lat))
  url.searchParams.set('longitude', String(lng))
  url.searchParams.set('term',      term)
  url.searchParams.set('radius',    String(Math.min(radiusMeters, 40000)))
  url.searchParams.set('limit',     String(limit))
  url.searchParams.set('sort_by',   'best_match')
  if (openNow) url.searchParams.set('open_now', 'true')

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      console.warn('[yelp] search failed', res.status, await res.text())
      return []
    }
    const data: YelpSearchResponse = await res.json()
    return data.businesses ?? []
  } catch (err) {
    console.warn('[yelp] fetch error', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Fetch multiple date-night category searches in parallel
// Returns deduplicated, sorted businesses
// ---------------------------------------------------------------------------
export async function dateNightSearch(params: {
  lat: number
  lng: number
  terms?: string[]        // defaults to DATE_NIGHT_TERMS
  radiusMeters?: number
  maxResults?: number
}): Promise<(YelpBusiness & { yd_category: string })[]> {
  const {
    lat, lng,
    terms,
    radiusMeters = 16000,
    maxResults = 12,
  } = params

  const termList = terms
    ? terms.map(t => ({ term: t, category: 'Activities' }))
    : DATE_NIGHT_TERMS.slice(0, 6)  // limit parallel calls

  const results = await Promise.all(
    termList.map(({ term, category }) =>
      searchYelp({ lat, lng, term, radiusMeters, limit: 3, openNow: true })
        .then(bizs => bizs.map(b => ({
          ...b,
          yd_category: mapYelpCategory(b.categories) || category,
        })))
    )
  )

  // Dedupe by Yelp ID, sort by rating desc
  const seen = new Set<string>()
  return results
    .flat()
    .filter(b => {
      if (seen.has(b.id)) return false
      seen.add(b.id)
      return true
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxResults)
}

// ---------------------------------------------------------------------------
// Convert a YelpBusiness to a NowResult-compatible shape
// (imported by /api/now -- avoids circular deps by keeping types loose)
// ---------------------------------------------------------------------------
export function yelpToResult(biz: YelpBusiness & { yd_category?: string }, userLat: number, userLng: number) {
  const lat = biz.coordinates.latitude
  const lng = biz.coordinates.longitude
  const address = biz.location.display_address.join(', ')
  const category = biz.yd_category ?? mapYelpCategory(biz.categories)

  // Haversine for drive estimate
  const R = 3958.8
  const phi1 = userLat * Math.PI / 180, phi2 = lat * Math.PI / 180
  const dphi = (lat - userLat) * Math.PI / 180
  const dlam = (lng - userLng) * Math.PI / 180
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const rawMin = (miles / 28) * 60
  const driveMin = miles < 0.3 ? 2 : Math.max(2, Math.round(rawMin / 5) * 5)

  const stars = '?'.repeat(Math.round(biz.rating)) + '?'.repeat(5 - Math.round(biz.rating))
  const priceStr = biz.price ? ` ? ${biz.price}` : ''
  const description = `${stars} ${biz.rating.toFixed(1)} (${biz.review_count} reviews)${priceStr} -- ${biz.categories.map(c => c.title).join(', ')}`

  return {
    id:            `yelp-${biz.id}`,
    title:         biz.name,
    description,
    venue:         biz.name,
    address,
    lat,
    lng,
    drive_minutes: driveMin,
    drive_label:   driveMin <= 2 ? 'Right here' : `~${driveMin} min away`,
    start_label:   'Open now ?',
    category,
    image_url:     biz.image_url,
    ticket_url:    biz.url,
    maps_url:      `https://maps.google.com/?daddr=${encodeURIComponent(address)}&saddr=Current+Location`,
    source:        'yelp',
    is_evergreen:  true,
  }
}
