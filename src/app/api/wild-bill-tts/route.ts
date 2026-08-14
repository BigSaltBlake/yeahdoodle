import { NextRequest } from 'next/server'

const VOICE_SETTINGS = [
  { stability: 0.75, similarity_boost: 0.75, style: 0.0,  use_speaker_boost: true },
  { stability: 0.50, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
  { stability: 0.20, similarity_boost: 0.85, style: 0.80, use_speaker_boost: true },
]

export async function POST(req: NextRequest) {
  const { text, intensity = 1 } = await req.json()
  const elevenKey = process.env.ELEVENLABS_API_KEY
  const voiceId   = process.env.ELEVENLABS_VOICE_ID
  if (!elevenKey || !voiceId) return new Response('TTS not configured', { status: 500 })
  if (!text?.trim()) return new Response('No text provided', { status: 400 })
  const settings = VOICE_SETTINGS[intensity] ?? VOICE_SETTINGS[1]
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId + '/stream', {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: settings }),
  })
  if (!res.ok || !res.body) { const err = await res.text(); console.error('ElevenLabs TTS error:', err); return new Response('TTS failed', { status: 502 }) }
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' } })
}