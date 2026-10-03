import { NextRequest, NextResponse } from 'next/server'

// GET /api/place-photo?name=places/<placeId>/photos/<photoId>
// Resolves a Google Places photo server-side and redirects to Google's
// key-free image URL, so GOOGLE_PLACES_API_KEY is never exposed to browsers.
const PHOTO_NAME = /^places\/[\w-]+\/photos\/[\w-]+$/

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? ''
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!PHOTO_NAME.test(name) || !apiKey) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxHeightPx=600&maxWidthPx=600&skipHttpRedirect=true`,
      { headers: { 'X-Goog-Api-Key': apiKey }, signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const { photoUri } = await res.json() as { photoUri?: string }
    if (!photoUri) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const redirect = NextResponse.redirect(photoUri, 302)
    // Let browsers and Vercel's CDN reuse the lookup — each one is a billed Places call
    redirect.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800')
    return redirect
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
