import { NextResponse } from 'next/server'

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' }, { status: 500 })
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/avatars/cF0x64s80rRnlVYvZC4W', {
      headers: { 'xi-api-key': key }
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
