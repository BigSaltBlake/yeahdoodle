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

const VENUE_TYPE_GROUPS = [
  ['restaurant', 'fine_dining_restaurant'],
  ['bar', 'wine_bar', 'cocktail_bar'],
  ['jazz_club', 'comedy_club', 'bowling_alley', 'movie_theater', 'escape_room', 'night_club'],
]

async function fetchNearby(apiKey,lat,lng,types,radiusMeters,maxResultCount=10){try{const body={includedTypes:types,maxResultCount,rankPreference:'POPULARITY',locationRestriction:{circle:{center:{latitude:lat,longitude:lng},radius:radiusMeters}}};const res=await fetch('https://places.googleapis.com/v1/places:searchNearby',{method:'POST'headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':FIELD_MASK?}body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});if(!res.ok) return[];const data=await res.json();return data.places??[]}catch(err){return[]}}