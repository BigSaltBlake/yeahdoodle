import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isSecretKind } from '@/lib/secret-kinds'

// Anyone can share a secret — no account, no review (for now). The server
// cleans the input, finds the spot on the map, and saves it.

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** Typed place → coordinates + a short label, anywhere in the world */
async function geocodePlace(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}` +
                `&limit=1&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const a = data[0].address ?? {}
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || ''
    const region = a.state || a.country || ''
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      label: [town, region].filter(Boolean).join(', ') || String(data[0].display_name ?? '').split(',').slice(0, 2).join(','),
    }
  } catch {
    return null
  }
}

/** Coordinates → "Town, State" for display */
async function labelFor(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`,
      { headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' }, cache: 'no-store', signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const a = (await res.json()).address ?? {}
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || ''
    const region = a.state || a.country || ''
    return [town, region].filter(Boolean).join(', ') || null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>

    // Bots fill every field; people never see this one
    if (clean(body.website, 200)) return NextResponse.json({ ok: true })

    const name        = clean(body.name, 120)
    const kind        = isSecretKind(body.kind) ? body.kind : 'other'
    const whySpecial  = clean(body.whySpecial, 600)
    const howToGet    = clean(body.howToGetThere, 600) || null
    const bestTime    = clean(body.bestTime, 120) || null
    const cautions    = clean(body.cautions, 300) || null
    const where       = clean(body.where, 200)
    const submitter   = clean(body.submitterName, 60) || null

    if (name.length < 2)        return NextResponse.json({ error: 'Give the spot a name.' }, { status: 400 })
    if (whySpecial.length < 10) return NextResponse.json({ error: 'Tell us a little about why it\'s special.' }, { status: 400 })

    // Location: the visitor's GPS pin, or the place they typed
    let lat = typeof body.lat === 'number' ? body.lat : NaN
    let lng = typeof body.lng === 'number' ? body.lng : NaN
    let placeLabel: string | null = null
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      placeLabel = await labelFor(lat, lng)
    } else if (where) {
      const geo = await geocodePlace(where)
      if (!geo) return NextResponse.json({ error: 'We couldn\'t find that place on the map. Try a nearby town, landmark, or address.' }, { status: 400 })
      lat = geo.lat; lng = geo.lng; placeLabel = geo.label
    } else {
      return NextResponse.json({ error: 'Tell us where it is.' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 500 })
    }

    const sb = createClient(supabaseUrl, serviceKey)
    const { error } = await sb.from('local_secrets').insert({
      name, kind, why_special: whySpecial, how_to_get_there: howToGet,
      best_time: bestTime, cautions, lat, lng, place_label: placeLabel,
      source: 'community', submitter_name: submitter,
    })
    if (error) throw error

    return NextResponse.json({ ok: true, placeLabel })
  } catch (err) {
    console.error('[secrets]', (err as Error).message)
    return NextResponse.json({ error: 'Something went wrong saving your secret. Please try again.' }, { status: 500 })
  }
}
