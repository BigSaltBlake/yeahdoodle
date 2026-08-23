import { NextRequest, NextResponse } from 'next/server'
import { getPlaceProfile, getCurrentSeason, buildProfileQueries } from '@/lib/place-profile'

// ---------------------------------------------------------------------------
// GET /api/place-profile?lat=40.76&lng=-111.89
// GET /api/place-profile?city=Moab&state=UT
// Returns the full place knowledge profile for a location.
// Used for debugging, and optionally by the frontend to surface local context.
// ---------------------------------------------------------------------------

async function geocodeCity(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
  }
}

async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; state: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YeahDoodle/1.0 (blake@saltcfo.com)' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const addr = data.address ?? {}
    const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? ''
    const state = addr.state ?? ''
    return { city, state }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const latStr  = searchParams.get('lat')
  const lngStr  = searchParams.get('lng')
  const cityRaw = searchParams.get('city') ?? ''
  const stateRaw = searchParams.get('state') ?? ''

  let lat: number | null = latStr ? parseFloat(latStr) : null
  let lng: number | null = lngStr ? parseFloat(lngStr) : null
  let cityName = cityRaw
  let stateName = stateRaw

  // Resolve coordinates
  if (!lat || !lng) {
    if (cityRaw) {
      const coords = await geocodeCity(stateRaw ? `${cityRaw}, ${stateRaw}` : cityRaw)
      if (!coords) {
        return NextResponse.json({ error: 'Could not geocode city' }, { status: 400 })
      }
      lat = coords.lat
      lng = coords.lng
    } else {
      return NextResponse.json({ error: 'Provide lat/lng or city' }, { status: 400 })
    }
  }

  // Resolve city name if only coords given
  if (!cityName && lat && lng) {
    const geo = await reverseGeocode(lat, lng)
    if (geo) { cityName = geo.city; stateName = geo.state }
  }

  const profile = await getPlaceProfile(lat!, lng!, cityName, stateName)
  if (!profile) {
    return NextResponse.json({ error: 'Could not build profile' }, { status: 500 })
  }

  const season = getCurrentSeason()
  const enrichedQueries = buildProfileQueries(profile, 'now')

  return NextResponse.json({
    profile,
    season,
    enriched_queries: enrichedQueries,
  })
}
