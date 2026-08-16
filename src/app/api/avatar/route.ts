import { NextResponse } from 'next/server'

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY
  const keyPreview = key ? key.substring(0, 8) + '...' + key.slice(-4) : 'MISSING'

  const urls = [
    'https://api.us.elevenlabs.io/v1/avatars/cF0x64s80rRnlVYvZC4W',
    'https://api.elevenlabs.io/v1/avatars/cF0x64s80rRnlVYvZC4W',
  ]

  const results = []
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'xi-api-key': key ?? '',
          'Accept': 'application/json',
        }
      })
      const body = await res.text()
      results.push({ url, status: res.status, body: body.slice(0, 300) })
    } catch (e) {
      results.push({ url, error: String(e) })
    }
  }

  return NextResponse.json({ keyPreview, results })
}
