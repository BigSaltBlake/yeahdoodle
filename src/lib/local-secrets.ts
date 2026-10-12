// ---------------------------------------------------------------------------
// Local secrets — hidden spots shared by anyone, anywhere.
// Run supabase/migrations/20261011_local_secrets.sql first.
// ---------------------------------------------------------------------------

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { SECRET_KINDS, type SecretKind } from '@/lib/secret-kinds'

export { SECRET_KINDS, isSecretKind, type SecretKind } from '@/lib/secret-kinds'

export interface LocalSecret {
  id: string
  name: string
  kind: SecretKind
  why_special: string
  how_to_get_there: string | null
  best_time: string | null
  cautions: string | null
  lat: number
  lng: number
  place_label: string | null
  source: string
}

// Shape /api/recommend works with (a subset of its EventRow)
export interface SecretEventRow {
  id: string
  title: string
  venue_name: string | null
  date_start: null
  is_free: boolean
  price_min: null
  price_max: null
  category: string
  ticket_url: string | null
  image_url: null
  description: string
  ai_description: null
  distanceLabel: string
  source: 'secret'
  secret: { access: string | null; bestTime: string | null; cautions: string | null }
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

function secretToRow(s: LocalSecret, miles: number): SecretEventRow {
  const extras = [s.best_time && `Best: ${s.best_time}`, s.cautions && `Heads up: ${s.cautions}`]
    .filter(Boolean).join(' · ')
  return {
    id:             'secret-' + s.id,
    title:          s.name,
    venue_name:     s.place_label,
    date_start:     null,
    is_free:        false,
    price_min:      null,
    price_max:      null,
    category:       SECRET_KINDS[s.kind]?.category ?? 'Activities',
    ticket_url:     `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`,
    image_url:      null,
    description:    `${SECRET_KINDS[s.kind]?.label ?? 'Spot'}: ${s.why_special}${extras ? ` (${extras})` : ''}`,
    ai_description: null,
    distanceLabel:  driveLabel(miles),
    source:         'secret',
    secret: { access: s.how_to_get_there, bestTime: s.best_time, cautions: s.cautions },
  }
}

/** Active secrets within `radiusMiles` of a point, nearest first */
export async function getNearbySecrets(params: {
  lat: number
  lng: number
  radiusMiles?: number
  limit?: number
}): Promise<SecretEventRow[]> {
  if (!isSupabaseConfigured()) return []
  const { lat, lng, radiusMiles = 40, limit = 6 } = params

  // Bounding box first (indexed), exact distance after
  const dLat = radiusMiles / 69
  const dLng = radiusMiles / (69 * Math.max(0.1, Math.cos(lat * Math.PI / 180)))

  try {
    const { data, error } = await supabase
      .from('local_secrets')
      .select('id,name,kind,why_special,how_to_get_there,best_time,cautions,lat,lng,place_label,source')
      .eq('status', 'active')
      .gte('lat', lat - dLat).lte('lat', lat + dLat)
      .gte('lng', lng - dLng).lte('lng', lng + dLng)
      .limit(50)

    if (error) {
      console.warn('[local-secrets] query error:', error.message)
      return []
    }

    return ((data ?? []) as LocalSecret[])
      .map(s => ({ s, miles: haversineMiles(lat, lng, s.lat, s.lng) }))
      .filter(x => x.miles <= radiusMiles)
      .sort((a, b) => a.miles - b.miles)
      .slice(0, limit)
      .map(x => secretToRow(x.s, x.miles))
  } catch (err) {
    console.warn('[local-secrets] fetch error:', err)
    return []
  }
}
