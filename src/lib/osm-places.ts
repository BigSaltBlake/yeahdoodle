// ---------------------------------------------------------------------------
// OpenStreetMap places — the lesser-known spots: waterfalls, viewpoints,
// swimming holes, trailheads, ruins, murals. OSM is too slow to ask live, so
// the first search in an area asks for it and the Railway worker loads it
// within a few minutes (worker/src/osm.ts). Only places without a Wikipedia
// page come back here — the well-known ones arrive through wiki-places.
// Run supabase/migrations/20261102_osm_places.sql first.
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js'

export interface OsmEventRow {
  id: string
  title: string
  venue_name: string | null
  date_start: null
  is_free: boolean
  price_min: number | null
  price_max: null
  category: string
  ticket_url: string
  image_url: null
  description: string
  ai_description: null
  distanceLabel: string
  source: 'osm'
}

type OsmPlace = {
  id: string; name: string; local_name: string | null; kind: string; category: string
  lat: number; lng: number; facts: string | null
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
  const driveMin = Math.max(2, Math.round((miles / 28) * 60 / 5) * 5)
  return '~' + driveMin + ' min away'
}

/** Lesser-known places within `radiusMiles`, nearest first */
export async function getNearbyOsmPlaces(params: {
  lat: number
  lng: number
  outdoors: boolean
  culture: boolean
  radiusMiles?: number
  limit?: number
}): Promise<OsmEventRow[]> {
  const { lat, lng, outdoors, culture, radiusMiles = 8, limit = 6 } = params
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !key || (!outdoors && !culture)) return []
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const dLat = radiusMiles / 69
  const dLng = radiusMiles / (69 * Math.max(0.1, Math.cos(lat * Math.PI / 180)))

  // The 0.1° cells this search touches; any the worker hasn't loaded yet get queued
  const cells: string[] = []
  for (let a = Math.floor((lat - dLat) * 10); a <= Math.floor((lat + dLat) * 10); a++)
    for (let b = Math.floor((lng - dLng) * 10); b <= Math.floor((lng + dLng) * 10); b++)
      cells.push(`${a}:${b}`)

  const categories = [...(outdoors ? ['Outdoors', 'Activities'] : []), ...(culture ? ['Arts & Culture'] : [])]
  try {
    const [placesRes, areasRes] = await Promise.all([
      sb.from('osm_places')
        .select('id,name,local_name,kind,category,lat,lng,facts')
        .eq('well_known', false)
        // Every block has a named park, and Google lists them — a waterfall or a mural is the real find
        .neq('kind', 'Park')
        .in('category', categories)
        .gte('lat', lat - dLat).lte('lat', lat + dLat)
        .gte('lng', lng - dLng).lte('lng', lng + dLng)
        .limit(1000),
      sb.from('osm_areas').select('key').in('key', cells),
    ])

    const known = new Set((areasRes.data ?? []).map(a => a.key as string))
    const missing = cells.filter(c => !known.has(c))
    if (missing.length && !areasRes.error) {
      const { error } = await sb.from('osm_areas')
        .upsert(missing.map(k => ({ key: k })), { onConflict: 'key', ignoreDuplicates: true })
      if (error) console.warn('[osm-places] queue error:', error.message)
    }

    if (placesRes.error) {
      console.warn('[osm-places] query error:', placesRes.error.message)
      return []
    }
    const near = ((placesRes.data ?? []) as OsmPlace[])
      .map(p => ({ p, miles: haversineMiles(lat, lng, p.lat, p.lng) }))
      .filter(x => x.miles <= radiusMiles)
      .sort((a, b) => a.miles - b.miles)
    const seen = new Set<string>()
    return near
      .filter(x => { const k = x.p.name.toLowerCase(); return !seen.has(k) && !!seen.add(k) })
      .slice(0, limit)
      .map(({ p, miles }) => ({
        id:             `osm-${p.id}`,
        title:          p.name,
        venue_name:     p.local_name,
        date_start:     null,
        is_free:        /\bFree\b/.test(p.facts ?? ''),
        price_min:      /\bFree\b/.test(p.facts ?? '') ? 0 : null,
        price_max:      null,
        category:       p.category,
        // A pin on the exact spot — a name search can land on a same-named place elsewhere
        ticket_url:     `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`,
        image_url:      null,
        description:    `${p.kind}${p.facts ? `: ${p.facts}` : ''} (a lesser-known spot on OpenStreetMap)`,
        ai_description: null,
        distanceLabel:  driveLabel(miles),
        source:         'osm' as const,
      }))
  } catch (err) {
    console.warn('[osm-places] fetch error:', String(err).slice(0, 200))
    return []
  }
}
