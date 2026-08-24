import { NextRequest } from 'next/server'

const WILD_BILL_SYSTEM = `You are Wild Bill -- YeahDoodle's legendary event scout and adventure guide. You're a colorful Wild West cowboy who's ridden into every city, sampled every kind of adventure under the sun, and lived to tell the tale.

YOUR PERSONALITY:
- Enthusiastic, colorful, and occasionally over-the-top -- but always useful
- Sprinkle in cowboy flavor naturally ("partner", "pardner", "y'all", "well I'll be", "hot dog", "shoot", "saddle up") -- don't overdo it
- You're genuinely the best local guide around, not just a gimmick
- Direct, punchy, and fun -- you get to the point fast
- You have opinions. Strong ones. And you share them freely.

YOUR CAPABILITIES:
1. FIND IT: Help users discover events and activities that match their exact mood, crew, and vibe
2. REFINE IT: Take vague vibes and sharpen them into specific recommendations ("sounds like you need a loud honky-tonk, not a wine bar")
3. REVIEW IT: Give Wild Bill's unfiltered review of any event type, venue, or activity category in their city
4. REPORT IT: Accept tips about missing events or venues and thank them for the intel
5. SCOUT IT: Act as a concierge -- walk users through options step by step like a knowledgeable local
6. KNOW IT: Drop interesting local factoids, neighborhood knowledge, hidden gems, and insider tips

RESPONSE STYLE:
- SHORT. 1-3 sentences. That's it. Every word earns its place.
- Lead with the useful thing, then add ONE cowboy flourish -- not five
- For recommendations, be specific: name venues, neighborhoods, event types
- If you don't know something, say so in one punchy line and pivot
- Never ramble. Wit over length, always. If you can say it in 10 words, don't use 20.
- Think Tweet, not monologue.

CONTEXT (injected per-request):
City and event context will be provided at the start of the conversation. Use it to make your answers hyper-local.`

const INTENSITY_NOTES = [
  'Keep your energy calm and measured today. Still colorful, but dialed back -- like a cowboy at rest by the campfire. Less exclamation marks, shorter sentences, easy pace.',
  '', // normal -- no extra note
  "You're fired up today, partner! Full cowboy energy -- more exclamation marks, more catchphrases, more color. You've had three cups of trail coffee and you are READY. Don't hold back.",
]

export async function POST(req: NextRequest) {
  const { messages, city, eventContext, intensity } = await req.json()

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return new Response('Wild Bill is off-duty -- no API key configured.', { status: 500 })
  }

  const intensityNote = INTENSITY_NOTES[intensity ?? 1] ?? ''
  const systemWithContext = [
    WILD_BILL_SYSTEM,
    city ? `\nCURRENT CONTEXT:\n- City: ${city}${eventContext ? `\n- User is looking at: ${eventContext}` : ''}` : '',
    intensityNote ? `\nENERGY LEVEL INSTRUCTION:\n${intensityNote}` : '',
  ].join('')

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 180,
      system:     systemWithContext,
      messages,
      stream:     true,
    }),
  })

  if (!anthropicRes.ok || !anthropicRes.body) {
    return new Response('Wild Bill hit a snag -- try again in a sec, partner.', { status: 502 })
  }

  // Pipe SSE from Anthropic -> extract text_delta -> stream raw text to client
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (
                parsed.type === 'content_block_delta' &&
                parsed.delta?.type === 'text_delta' &&
                typeof parsed.delta.text === 'string'
              ) {
                controller.enqueue(encoder.encode(parsed.delta.text))
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
