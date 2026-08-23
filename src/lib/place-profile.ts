// ---------------------------------------------------------------------------
// Place Knowledge Layer
// Builds a rich, cached profile of what any location is known for.
// Sources: Wikipedia REST API + OpenStreetMap Overpass API + Claude Haiku
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConfigured } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaceAttraction {
  name: string
  category: string        // e.g. "Outdoor", "History", "Sports", "Culture"
  description: string
  seasonal?: string[]     // e.g. ["winter", "summer"] ?????? when it's best
}

export interface PlaceProfile {
  city: string
  state: string
  country: string
  lat: number
  lng: number
  known_for: string[]              // e.g. ["skiing", "ranching", "history", "fishing"]
  notable_attractions: PlaceAttraction[]
  seasonal_highlights: {
    spring: string[]
    summer: string[]
    fall: string[]
    winter: string[]
  }
  serper_queries: string[]         // ready-to-fire Serper queries for this place
  activity_tags: string[]          // short tags for query enrichment
  famous_people: string[]
  wikipedia_extract: string
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const CACHE_RADIUS_DEG = 0.15   // ~15 km ?????? same "city" tolerance

async function getCachedProfile(lat: number, lng: number): Promise<PlaceProfile | null> {
  if (!isSupabaseConfigured()) return null
  const { data } = await supabase
    .from('city_profiles')
    .select('*')
    .gte('lat', lat - CACHE_RADIUS_DEG)
    .lte('lat', lat + CACHE_RADIUS_DEG)
    .gte('lng', lng - CACHE_RADIUS_DEG)
    .lte('lng', lng + CACHE_RADIUS_DEG)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return {
    city: data.city,
    state: data.state ?? '',
    country: data.country,
    lat: data.lat,
    lng: data.lng,
    known_for: data.known_for ?? [],
    notable_attractions: data.notable_attractions ?? [],
    seasonal_highlights: data.seasonal_highlights ?? { spring: [], summer: [], fall: [], winter: [] },
    serper_queries: data.serper_queries ?? [],
    activity_tags: data.activity_tags ?? [],
    famous_people: data.famous_people ?? [],
    wikipedia_extract: data.wikipedia_extract ?? '',
  }
}

async function cacheProfile(profile: PlaceProfile): Promise<void> {
  if (!isSupabaseConfigured()) return
  const expires = new Date()
  expires.setDate(expires.getDate() + 90)
  await supabase.from('city_profiles').upsert(
    {
      city: profile.city,
      state: profile.state,
      country: profile.country,
      lat: profile.lat,
      lng: profile.lng,
      known_for: profile.known_for,
      notable_attractions: profile.notable_attractions,
      seasonal_highlights: profile.seasonal_highlights,
      serper_queries: profile.serper_queries,
      activity_tags: profile.activity_tags,
      famous_people: profile.famous_people,
      wikipedia_extract: profile.wikipedia_extract,
      cached_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
    },
    { onConflict: 'city,state' }
  )
}

// ---------------------------------------------------------------------------
// Wikipedia REST API
// ---------------------------------------------------------------------------

async function fetchWikipediaSummary(city: string, state?: string): Promise<string> {
  const candidates = [
    state ? `${city},_${state.replace(/\s+/g, '_')}` : null,
    city.replace(/\s+/g, '_'),
    `${city.replace(/\s+/g, '_')},_${(state ?? '').replace(/\s+/g, '_')}`,
  ].filter(Boolean) as string[]

  for (const slug of candidates) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const data = await res.json()
      if (data.extract && data.extract.length > 50) return data.extract as string
    } catch {
      // try next candidate
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// OpenStreetMap Overpass API ?????? what's physically present nearby
// ---------------------------------------------------------------------------

interface OSMFeature {
  name: string
  type: string
  tags: Record<string, string>
}

async function fetchOSMFeatures(lat: number, lng: number, radiusM = 40000): Promise<OSMFeature[]> {
  const query = `
[out:json][timeout:12];
(
  node["tourism"~"attraction|museum|viewpoint|theme_park|zoo"](around:${radiusM},${lat},${lng});
  node["leisure"~"golf_course|marina|ski_jump|stadium|nature_reserve"](around:${radiusM},${lat},${lng});
  node["sport"~"skiing|equestrian|fishing|climbing|shooting|motor|golf"](around:${radiusM},${lat},${lng});
  node["natural"~"peak|beach|hot_spring|cave_entrance|waterfall"](around:${radiusM},${lat},${lng});
  node["waterway"~"reservoir|lake"](around:${radiusM},${lat},${lng});
  node["historic"~"monument|castle|ruins|archaeological_site|memorial|landmark"](around:${radiusM},${lat},${lng});
  way["route"~"hiking|bicycle|mtb|horse|canoe"](around:${radiusM},${lat},${lng});
  way["leisure"="golf_course"](around:${radiusM},${lat},${lng});
  way["landuse"~"ski_piste|winter_sports"](around:${radiusM},${lat},${lng});
);
out body 60;
`
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const elements = (data.elements ?? []) as Record<string, unknown>[]

    return elements
      .filter(e => e.tags && (e.tags as Record<string, string>).name)
      .map(e => {
        const tags = e.tags as Record<string, string>
        return {
          name: tags.name,
          type: tags.tourism ?? tags.leisure ?? tags.sport ?? tags.natural ?? tags.historic ?? tags.route ?? tags.waterway ?? 'feature',
          tags,
        }
      })
      .slice(0, 50)
  } catch {
    return []
  }
}

function osmFeaturesToText(features: OSMFeature[]): string {
  if (features.length === 0) return 'No OpenStreetMap features found.'
  return features
    .map(f => `- ${f.name} (${f.type})`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Claude Haiku synthesis
// ---------------------------------------------------------------------------

async function synthesizeProfile(
  city: string,
  state: string,
  lat: number,
  lng: number,
  wikiExtract: string,
  osmFeatures: OSMFeature[]
): Promise<PlaceProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const loc = state ? `${city}, ${state}` : city
  const osmText = osmFeaturesToText(osmFeatures)
  const month = new Date().toLocaleString('en-US', { month: 'long' })

  const fallback: PlaceProfile = {
    city, state, country: 'US', lat, lng,
    known_for: [],
    notable_attractions: [],
    seasonal_highlights: { spring: [], summer: [], fall: [], winter: [] },
    serper_queries: [
      `things to do in ${loc}`,
      `${loc} attractions and activities`,
      `outdoor activities near ${loc}`,
    ],
    activity_tags: [],
    famous_people: [],
    wikipedia_extract: wikiExtract,
  }

  if (!apiKey) return fallback

  const prompt = `You are a local activity expert. Based on the information below about ${loc}, generate a structured JSON profile of what this place is known for and the best activities available.

WIKIPEDIA EXTRACT:
${wikiExtract || '(not available)'}

NEARBY PHYSICAL FEATURES (from OpenStreetMap):
${osmText}

Current month: ${month}

Return ONLY valid JSON matching this exact structure (no markdown, no explanation):
{
  "known_for": ["string array ?????? what the area is broadly known for, e.g. skiing, ranching, wine country, history, fishing"],
  "notable_attractions": [
    {"name": "string", "category": "one of: Outdoor|History|Sports|Culture|Food|Nightlife|Family", "description": "1 sentence", "seasonal": ["winter"]}
  ],
  "seasonal_highlights": {
    "spring": ["activity strings"],
    "summer": ["activity strings"],
    "fall": ["activity strings"],
    "winter": ["activity strings"]
  },
  "serper_queries": ["5-8 specific search queries optimized for finding activities and events in ${loc} ?????? be very specific to what this place is actually known for"],
  "activity_tags": ["short tags for query enrichment, e.g. hiking, skiing, golf, wine tasting, history tours"],
  "famous_people": ["notable past or present residents or people associated with this place"]
}

Rules:
- Be highly specific to ${loc} ?????? avoid generic results
- serper_queries should be ready to paste into Google and return great local results
- Include seasonal context in serper_queries where appropriate (e.g. current month is ${month})
- Max 8 notable_attractions, max 4 per seasonal array, max 10 serper_queries, max 10 activity_tags`

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!aiRes.ok) return fallback
    const aiData = await aiRes.json()
    const raw = (aiData.content[0] as { text: string }).text.trim()
    const json = JSON.parse(raw.replace(/^```json?\n?/, '').replace(/\n?```$/, ''))
    return {
      city, state, country: 'US', lat, lng,
      known_for: json.known_for ?? [],
      notable_attractions: json.notable_attractions ?? [],
      seasonal_highlights: json.seasonal_highlights ?? { spring: [], summer: [], fall: [], winter: [] },
      serper_queries: json.serper_queries ?? fallback.serper_queries,
      activity_tags: json.activity_tags ?? [],
      famous_people: json.famous_people ?? [],
      wikipedia_extract: wikiExtract,
    }
  } catch (err) {
    console.warn('[place-profile] Haiku synthesis failed:', err)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Main export ?????? call this from /api/now and /api/recommend
// ---------------------------------------------------------------------------

export async function getPlaceProfile(
  lat: number,
  lng: number,
  cityName: string,
  state = ''
): Promise<PlaceProfile | null> {
  // 1. Check cache first
  try {
    const cached = await getCachedProfile(lat, lng)
    if (cached) return cached
  } catch {
    // cache read failure is non-fatal
  }

  // 2. Fetch sources in parallel (with generous timeouts)
  const [wikiExtract, osmFeatures] = await Promise.all([
    fetchWikipediaSummary(cityName, state).catch(() => ''),
    fetchOSMFeatures(lat, lng).catch(() => [] as OSMFeature[]),
  ])

  // 3. Synthesize via Claude Haiku
  const profile = await synthesizeProfile(cityName, state, lat, lng, wikiExtract, osmFeatures)

  // 4. Cache result (fire-and-forget)
  cacheProfile(profile).catch(() => {})

  return profile
}

// ---------------------------------------------------------------------------
// Helper: get current season
// ---------------------------------------------------------------------------

export function getCurrentSeason(): 'spring' | 'summer' | 'fall' | 'winter' {
  const month = new Date().getMonth() + 1   // 1-12
  if (month >= 3 && month <= 5)  return 'spring'
  if (month >= 6 && month <= 8)  return 'summer'
  if (month >= 9 && month <= 11) return 'fall'
  return 'winter'
}

// ---------------------------------------------------------------------------
// Helper: build enriched Serper queries from profile + current season
// ---------------------------------------------------------------------------

export function buildProfileQueries(
  profile: PlaceProfile,
  timeframe: 'now' | 'soon' | 'anytime' = 'now'
): string[] {
  const season = getCurrentSeason()
  const loc = profile.state ? `${profile.city}, ${profile.state}` : profile.city

  // Seasonal highlights ?????? queries
  const seasonalActivities = profile.seasonal_highlights[season] ?? []
  const seasonalQueries = seasonalActivities.slice(0, 2).map(a => `${a} near ${loc}`)

  // Profile's pre-built queries (already highly specific)
  const profileQueries = profile.serper_queries.slice(0, 4)

  // Combine and dedupe
  const all = [...profileQueries, ...seasonalQueries]
  return Array.from(new Set(all).slice(0, 5)
}
