// ---------------------------------------------------------------------------
// Curated Venues — Supabase query client
// Fetches hand-curated date-night spots from the curated_venues table.
// Run supabase/migrations/20260921_curated_venues.sql first.
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConfigured } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CuratedVenue {
  id: string
  city: string
  state: string
  name: string
  google_place_id: string | null
  yelp_id: string | null
  category: string
  date_night_score: number
  tags: string[]
  notes: string | null
  image_url: string | null
  address: string | null
  lat: number | null
  lng: number | null
  price_level: string | null
  avg_rating: number | null
  review_count: number | null
  website_url: string | null
  reservation_url: string | null
  is_verified: boolean
}

// Minimal EventRow shape expected by /api/recommend/route.ts
export interface CuratedEventRow {
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
// Category → YeahDoodle category mapping
// ---------------------------------------------------------------------------

function venueToYdCategory(category: string): string {
  const map: Record<string, string> = {
    romantic_dining:   'Food & Drink',
    cocktail_bar:      'Nightlife',
    wine_bar:          'Nightlife',
    rooftop_bar:       'Nightlife',
    speakeasy:         'Nightlife',
    live_music:        'Music',
    comedy:            'Arts & Culture',
    theater:           'Arts & Culture',
    unique_experience: 'Activities',
    dessert_cafe:      'Food & Drink',
    outdoor_activity:  'Outdoors',
    entertainment:     'Activities',
  }
  return map[category] ?? 'Activities'
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function driveLabel(miles: number): string {
  if (miles < 0.3) return 'Right here'
  const rawMin = (miles / 28) * 60
  const driveMin = Math.max(2, Math.round(rawMin / 5) * 5)
  return '~' + driveMin + ' min away'
}

function venueToRow(
  venue: CuratedVenue,
  userLat?: number,
  userLng?: number,
): CuratedEventRow {
  let distLabel = ''
  if (userLat && userLng && venue.lat && venue.lng) {
    const miles = haversineMiles(userLat, userLng, venue.lat, venue.lng)
    distLabel = driveLabel(miles)
  }

  const ratingStr  = venue.avg_rating ? '\u2605 ' + venue.avg_rating.toFixed(1) : ''
  const priceStr   = venue.price_level ?? ''
  const tagStr     = venue.tags.filter(t => !['intimate','upscale','casual'].includes(t))
                               .slice(0, 3).join(' \u00b7 ')
  const metaStr    = [ratingStr, priceStr, tagStr].filter(Boolean).join(' \u00b7 ')
  const description = metaStr || null

  return {
    id:             'curated-' + venue.id,
    title:          venue.name,
    venue_name:     venue.name,
    date_start:     null,
    is_free:        venue.price_level === 'Free' || venue.price_level === '$',
    price_min:      null,
    price_max:      null,
    category:       venueToYdCategory(venue.category),
    ticket_url:     venue.reservation_url ?? venue.website_url ?? null,
    image_url:      venue.image_url,
    description,
    ai_description: null,
    distanceLabel:  distLabel,
    source:         'activity',
  }
}

export async function getCuratedVenues(params: {
  city: string
  state?: string
  tags?: string[]         // filter to venues matching ANY of these tags
  minScore?: number       // minimum date_night_score (default 75)
  limit?: number          // default 10
  userLat?: number
  userLng?: number
}): Promise<CuratedEventRow[]> {
  if (!isSupabaseConfigured()) return []

  const {
    city,
    state,
    tags,
    minScore = 75,
    limit = 10,
    userLat,
    userLng,
  } = params

  try {
    let q = supabase
      .from('curated_venues')
      .select('*')
      .eq('is_active', true)
      .ilike('city', '%' + city + '%')
      .gte('date_night_score', minScore)
      .order('date_night_score', { ascending: false })
      .limit(limit)

    if (state) {
      q = q.ilike('state', '%' + state + '%')
    }

    if (tags && tags.length > 0) {
      q = q.overlaps('tags', tags)
    }

    const { data, error } = await q

    if (error) {
      console.warn('[curated-venues] query error:', error.message)
      return []
    }

    return ((data ?? []) as CuratedVenue[])
      .map(v => venueToRow(v, userLat, userLng))
  } catch (err) {
    console.warn('[curated-venues] fetch error:', err)
    return []
  }
}
