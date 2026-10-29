// ---------------------------------------------------------------------------
// Wikipedia places — real landmarks, shrines, castles, lakes, parks and
// museums near any point on Earth, with a photo and a one-line description.
// Free, no key, answers in under a second.
// ---------------------------------------------------------------------------

export interface WikiEventRow {
  id: string
  title: string
  venue_name: null
  date_start: null
  is_free: boolean
  price_min: null
  price_max: null
  category: string
  ticket_url: string
  image_url: string | null
  description: string
  ai_description: null
  distanceLabel: string
  source: 'wiki'
}

type WikiPage = {
  pageid: number
  title: string
  description?: string
  coordinates?: Array<{ lat: number; lon: number }>
  thumbnail?: { source: string }
}

// Judged from Wikipedia's short description ("Shinto shrine in Kyoto, Japan")
const NOT_A_PLACE_TO_GO = /\b(station|stop|school|college|university|academy|district|ward|county|prefecture|municipality|city|town|village|hamlet|neighbou?rhood|suburb|incident|battle|siege|rebellion|war|period|restoration|era|agency|ministry|department|company|corporation|brand|street|road|highway|avenue|railway|line|route|hospital|office|court|prison|cemetery|stadium|venue|arena|airport|person|politician|footballer|born|band|film|novel|album|newspaper|radio|television|organization|organisation|government|parliament|embassy|bank|hotel|mall|store|shopping)\b/i
const OUTDOORS = /\b(park|garden|gardens|lake|pond|reservoir|beach|bay|waterfall|falls|mountain|mount|peak|hill|volcano|island|forest|woods|grove|canyon|gorge|cave|hot spring|onsen|river|creek|trail|nature reserve|wildlife|national park|state park|grassland|wetland|cliff|coast|viewpoint|lookout)\b/i
const CULTURE = /\b(castle|palace|shrine|temple|church|cathedral|basilica|mosque|synagogue|monastery|abbey|museum|gallery|monument|memorial|landmark|historic|ruins|fort|fortress|tower|bridge|square|plaza|market|theatre|theater|opera|library|zoo|aquarium|observatory|lighthouse|house|mansion|villa|tomb|pagoda|statue|art)\b/i

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

/** Notable real places within ~6 miles (Wikipedia's limit), nearest first */
export async function getNearbyWikiPlaces(params: {
  lat: number
  lng: number
  outdoors: boolean
  culture: boolean
  limit?: number
}): Promise<WikiEventRow[]> {
  const { lat, lng, outdoors, culture, limit = 8 } = params
  if (!outdoors && !culture) return []

  // Rounded to ~1 km so nearby searches share a cached answer for a day
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'geosearch',
    ggscoord: `${lat.toFixed(2)}|${lng.toFixed(2)}`, ggsradius: '10000', ggslimit: '100',
    prop: 'description|coordinates|pageimages', piprop: 'thumbnail', pithumbsize: '640',
  })
  let pages: WikiPage[] = []
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (https://yeahdoodle.com)' },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    })
    if (!res.ok) {
      console.warn('[wiki-places] wikipedia', res.status)
      return []
    }
    pages = Object.values((await res.json()).query?.pages ?? {}) as WikiPage[]
  } catch (err) {
    console.warn('[wiki-places] fetch error:', String(err).slice(0, 200))
    return []
  }

  return pages
    .flatMap(p => {
      const d = p.description ?? ''
      const c = p.coordinates?.[0]
      // What it is, not where: "Landmark in the city of Paris, Texas" → "Landmark"
      const what = d.split(/\s+(?:in|of|on|near|at|based|located|from)\s+/i)[0]
      if (!what || !c || NOT_A_PLACE_TO_GO.test(what)) return []
      const category = OUTDOORS.test(what) ? 'Outdoors' : CULTURE.test(what) ? 'Arts & Culture' : null
      if (!category || (category === 'Outdoors' ? !outdoors : !culture)) return []
      return [{ p, d, c, category, miles: haversineMiles(lat, lng, c.lat, c.lon) }]
    })
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit)
    .map(({ p, d, c, category, miles }) => ({
      id:             `wiki-${p.pageid}`,
      // "Eiffel Tower (Paris, Texas)" → "Eiffel Tower"
      title:          p.title.replace(/\s*\([^)]*\)\s*$/, ''),
      venue_name:     null,
      date_start:     null,
      is_free:        false,
      price_min:      null,
      price_max:      null,
      category,
      // A pin on the exact spot — a name search can land on a same-named place elsewhere
      ticket_url:     `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`,
      image_url:      p.thumbnail?.source ?? null,
      description:    `${d} (on Wikipedia — a well-known place)`,
      ai_description: null,
      distanceLabel:  driveLabel(miles),
      source:         'wiki' as const,
    }))
}
