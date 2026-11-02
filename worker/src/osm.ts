/**
 * OpenStreetMap places — loads the lesser-known spots (waterfalls, viewpoints,
 * swimming holes, trailheads, ruins, murals) for areas people search.
 *
 * The site adds an area to osm_areas the first time someone searches there;
 * this job fetches each pending area from the Overpass API (too slow to ask
 * live — often 30–60s) and stores its named places in osm_places.
 * Run supabase/migrations/20261102_osm_places.sql first.
 */

import type { Db } from './lib/db'

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const AREAS_PER_RUN = 2
const MAX_ATTEMPTS  = 3
const REFRESH_DAYS  = 60

type OsmElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

// What each kind of place is called on a card, and which category it counts as
function kindOf(t: Record<string, string>): { label: string; category: string } | null {
  if (t.waterway === 'waterfall')            return { label: 'Waterfall', category: 'Outdoors' }
  if (t.tourism === 'viewpoint')             return { label: 'Viewpoint', category: 'Outdoors' }
  if (t.boundary === 'national_park')        return { label: 'National park', category: 'Outdoors' }
  if (t.highway === 'trailhead')             return { label: 'Trailhead', category: 'Outdoors' }
  const leisure: Record<string, string> = {
    nature_reserve: 'Nature reserve', park: 'Park', garden: 'Garden',
    swimming_area: 'Swimming spot', picnic_site: 'Picnic spot',
  }
  if (t.leisure && leisure[t.leisure])       return { label: leisure[t.leisure], category: 'Outdoors' }
  const natural: Record<string, string> = {
    beach: 'Beach', peak: 'Peak', hot_spring: 'Hot spring', cave_entrance: 'Cave', spring: 'Spring',
    cliff: 'Cliffs', volcano: 'Volcano', arch: 'Rock arch', bay: 'Bay', gorge: 'Gorge',
  }
  if (t.natural && natural[t.natural])       return { label: natural[t.natural], category: 'Outdoors' }
  const historic: Record<string, string> = {
    castle: 'Castle', ruins: 'Ruins', archaeological_site: 'Archaeological site', fort: 'Fort',
    monument: 'Monument', city_gate: 'City gate', manor: 'Historic manor', memorial: 'Memorial',
  }
  if (t.historic && historic[t.historic])    return { label: historic[t.historic], category: 'Arts & Culture' }
  if (t.tourism === 'museum')                return { label: 'Museum', category: 'Arts & Culture' }
  if (t.tourism === 'gallery')               return { label: 'Gallery', category: 'Arts & Culture' }
  if (t.tourism === 'artwork') {
    const label = t.artwork_type === 'mural' ? 'Mural' : t.artwork_type === 'sculpture' ? 'Sculpture'
                : t.artwork_type === 'statue' ? 'Statue' : 'Public art'
    return { label, category: 'Arts & Culture' }
  }
  if (t.amenity === 'place_of_worship') {
    const r = t.religion
    const label = r === 'buddhist' ? 'Temple' : r === 'shinto' ? 'Shrine' : r === 'muslim' ? 'Mosque'
                : r === 'hindu' ? 'Temple' : r === 'christian' ? 'Church' : 'Place of worship'
    return { label, category: 'Arts & Culture' }
  }
  if (t.tourism === 'attraction')            return { label: 'Attraction', category: 'Activities' }
  return null
}

/** "352:-956" → south, west, north, east of that 0.1° cell */
function cellBox(key: string): [number, number, number, number] {
  const [a, b] = key.split(':').map(Number)
  return [a / 10, b / 10, (a + 1) / 10, (b + 1) / 10]
}

function buildQuery(key: string): string {
  const [s, w, n, e] = cellBox(key)
  return `[out:json][timeout:150][bbox:${s},${w},${n},${e}];(` +
    `nwr["natural"~"^(beach|peak|hot_spring|cave_entrance|spring|cliff|volcano|arch|bay|gorge)$"]["name"];` +
    `nwr["waterway"="waterfall"]["name"];` +
    `nwr["tourism"~"^(viewpoint|museum|gallery|artwork|attraction)$"]["name"];` +
    `nwr["leisure"~"^(nature_reserve|park|garden|swimming_area|picnic_site)$"]["name"];` +
    `nwr["boundary"="national_park"]["name"];` +
    `nwr["highway"="trailhead"]["name"];` +
    `nwr["historic"~"^(castle|ruins|archaeological_site|fort|monument|city_gate|manor)$"]["name"];` +
    // Every plaque and parish church is mapped — only the notable ones
    `nwr["historic"="memorial"]["name"]["wikidata"];` +
    `nwr["amenity"="place_of_worship"]["name"]["wikidata"];` +
    `);out center tags 4000;`
}

async function overpass(query: string): Promise<OsmElement[]> {
  let lastErr = ''
  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(server, {
        method: 'POST',
        // overpass-api.de answers 406 without an Accept header
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
          'User-Agent': 'YeahDoodle/1.0 (https://yeahdoodle.com)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) { lastErr = `${server} ${res.status}`; continue }
      const data = await res.json() as { elements?: OsmElement[]; remark?: string }
      // A timed-out query still answers 200, with a remark and partial data
      if (data.remark && /timed out|out of memory/i.test(data.remark)) { lastErr = `${server} ${data.remark}`; continue }
      return data.elements ?? []
    } catch (err) {
      lastErr = `${server} ${(err as Error).message}`
    }
  }
  throw new Error(lastErr || 'no Overpass server answered')
}

function toRow(el: OsmElement, areaKey: string) {
  const t = el.tags ?? {}
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  const kind = kindOf(t)
  if (!kind || !t.name || lat === undefined || lng === undefined) return null
  if (t.access === 'private' || t.access === 'no') return null
  // A way's center can fall in the next cell over — it belongs to that one
  if (`${Math.floor(lat * 10)}:${Math.floor(lng * 10)}` !== areaKey) return null
  const name = t['name:en'] || t.name
  const facts = [
    t.description,
    t.artist_name ? `By ${t.artist_name}` : '',
    t.ele && (kind.label === 'Peak' || kind.label === 'Viewpoint') ? `${t.ele} m up` : '',
    t.height && kind.label === 'Waterfall' ? `${t.height} m tall` : '',
    t.opening_hours ? `Hours: ${t.opening_hours}` : '',
    t.fee === 'no' ? 'Free' : t.fee === 'yes' ? 'Entry fee' : '',
  ].filter(Boolean).join(' · ').slice(0, 400)
  return {
    id:         `${el.type}/${el.id}`,
    area_key:   areaKey,
    name:       name.slice(0, 200),
    local_name: name !== t.name ? t.name.slice(0, 200) : null,
    kind:       kind.label,
    category:   kind.category,
    lat, lng,
    well_known: !!(t.wikidata || t.wikipedia),
    facts:      facts || null,
    fetched_at: new Date().toISOString(),
  }
}

async function loadArea(db: Db, key: string, attempts: number) {
  try {
    const elements = await overpass(buildQuery(key))
    const seen = new Set<string>()
    const rows = elements
      .map(el => toRow(el, key))
      .filter((r): r is NonNullable<ReturnType<typeof toRow>> => !!r && !seen.has(r.id) && !!seen.add(r.id))

    const { error: delErr } = await db.from('osm_places').delete().eq('area_key', key)
    if (delErr) throw delErr
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('osm_places').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
    await db.from('osm_areas').update({
      status: 'done', place_count: rows.length, error: null, attempts: attempts + 1,
      fetched_at: new Date().toISOString(),
    }).eq('key', key)
    console.log(`[OSM] ${key}: ${rows.length} places`)
  } catch (err) {
    const msg = ((err as Error).message ?? String(err)).slice(0, 300)
    await db.from('osm_areas').update({
      status: attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending', error: msg, attempts: attempts + 1,
    }).eq('key', key)
    console.warn(`[OSM] ${key} failed (attempt ${attempts + 1}): ${msg}`)
  }
}

let running = false

/** Load the areas people have searched that aren't loaded yet */
export async function syncOsmAreas(db: Db) {
  if (running) return
  running = true
  try {
    const { data, error } = await db
      .from('osm_areas')
      .select('key, attempts')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(AREAS_PER_RUN)
    if (error) throw error
    // One at a time — the public Overpass servers ask for that
    for (const a of data ?? []) await loadArea(db, a.key, a.attempts)
  } finally {
    running = false
  }
}

/** Places change slowly — reload each area every couple of months */
export async function refreshOsmAreas(db: Db) {
  const before = new Date(Date.now() - REFRESH_DAYS * 86_400_000).toISOString()
  const { error } = await db.from('osm_areas')
    .update({ status: 'pending', attempts: 0, requested_at: new Date().toISOString() })
    .eq('status', 'done').lt('fetched_at', before)
  if (error) throw error
}
