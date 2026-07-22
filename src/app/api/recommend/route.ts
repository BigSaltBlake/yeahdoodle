import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'TBD'
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

function formatPrice(priceMin: number | null, priceMax: number | null, isFree: boolean): string {
  if (isFree || priceMin === 0 || priceMin === null) return 'Free'
  if (priceMax && priceMax > priceMin) return `$${Math.round(priceMin)}–$${Math.round(priceMax)}`
  return `$${Math.round(priceMin)}`
}

function budgetMax(answers: string[]): number | null {
  const b = answers[4] ?? ''
  if (b.includes('Free') || b.includes('25')) return 25
  if (b.includes('75')) return 75
  return null
}

function categoryHints(answers: string[]): string[] | null {
  const exp = answers[2] ?? ''
  if (exp.includes('music') || exp.includes('show')) return ['Music', 'Arts & Culture', 'Nightlife']
  if (exp.includes('Food') || exp.includes('drinks')) return ['Food & Drink', 'Community', 'Outdoors']
  return null
}

// POST /api/recommend
// Body: { city: string, answers: string[], lat?: number, lng?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { city: string; answers: string[]; lat?: number; lng?: number }
    const { city, answers } = body
    const lat = typeof body.lat === 'number' ? body.lat : NaN
    const lng = typeof body.lng === 'number' ? body.lng : NaN
    const hasCoords = !isNaN(lat) && !isNaN(lng)

    if (!city?.trim() && !hasCoords) return NextResponse.json({ error: 'city or coordinates required' }, { status: 400 })
    if (!Array.isArray(answers) || answers.length === 0) return NextResponse.json({ error: 'answers required' }, { status: 400 })
    if (!isSupabaseConfigured()) return NextResponse.json({ picks: [] })

    const now = new Date()
    const weekOut = new Date(now); weekOut.setDate(weekOut.getDate() + 7)
    const maxBudget = budgetMax(answers)
    const catHints = categoryHints(answers)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] = []

    // GPS radius search
    if (hasCoords) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: nearData, error: nearErr } = await (supabase as any).rpc('events_near', {
          user_lat: lat, user_lng: lng, radius_miles: 10,
        })
        if (!nearErr && Array.isArray(nearData) && nearData.length > 0) rows = nearData
      } catch { /* RPC not yet created */ }
    }

    // City-based fallback
    if (rows.length === 0 && city?.trim()) {
      let q = supabase.from('events').select('*')
        .ilike('city', `%${city.trim()}%`).eq('is_duplicate', false)
        .gte('date_start', now.toISOString()).lte('date_start', weekOut.toISOString())
        .order('date_start', { ascending: true }).limit(50)
      if (catHints) q = q.in('category', catHints)
      if (maxBudget !== null) q = q.or(`is_free.eq.true,price_min.lte.${maxBudget}`)
      const { data: primaryRows, error: primaryErr } = await q
      rows = primaryRows ?? []
      if (primaryErr || rows.length < 3) {
        const { data: fallbackRows } = await supabase.from('events').select('*')
          .ilike('city', `%${city.trim()}%`).eq('is_duplicate', false)
          .gte('date_start', now.toISOString()).order('date_start', { ascending: true }).limit(50)
        if ((fallbackRows ?? []).length > rows.length) rows = fallbackRows ?? []
      }
    }

    if (rows.length === 0) return NextResponse.json({ picks: [] })

    const seenArtists = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dedupedRows = rows.filter((row: any) => {
      const artist = row.title?.split(/ w/| with | feat./i)[0]?.trim()?.toLowerCase() || ''
      if (seenArtists.has(artist)) return false
      seenArtists.add(artist); return true
    })

    const locationDesc = hasCoords && city?.trim() ? `near ${city}` : hasCoords ? 'near your location' : `in ${city}`
    const eventList = dedupedRows.map((r, i) => {
      const price = r.is_free ? 'Free' : r.price_min ? `$${r.price_min}` : 'Price TBD'
      const date = r.date_start ? new Date(r.date_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }) : 'TBD'
      const desc = r.ai_description ?? r.description?.slice(0, 120) ?? ''
      return `${i + 1}. ID:${r.id} | ${r.title} | ${r.venue_name ?? 'Unknown venue'} | ${date} | ${price} | ${r.category}${desc ? ` | ${desc}` : ''}`
    }).join('\n')

    const labelMap = ['Energy level', 'Group size', 'Experience type', 'Scene/crowd', 'Budget']
    const answerSummary = answers.map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`).join('\n')

    const prompt = `You are a local event expert helping someone find their perfect night out.

User preferences:
${answerSummary}

Events available ${locationDesc} this week:
${eventList}

Pick the 3 BEST events that match this person's vibe. Consider their energy level, group size, experience preference, scene, and budget.

Return ONLY a valid JSON array — no other text, no markdown, no explanation:
[
  {"id":"<exact event UUID from the list above>","rank":1,"pitch":"<one punchy sentence, max 25 words, why this is perfect for them tonight>"},
  {"id":"<uuid>","rank":2,"pitch":"<...>"},
  {"id":"<uuid>","rank":3,"pitch":"<...>"}
]`

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) {
      const top3 = dedupedRows.slice(0, 3).map((r, i) => ({
        id: r.id, rank: i + 1,
        pitch: r.ai_description?.slice(0, 120) || r.description?.slice(0, 120) || `${r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Live event'} at ${r.venue_name || 'a local venue'}`,
        title: r.title, venue: r.venue_name ?? '',
        dateFormatted: formatDate(r.date_start), priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl: r.ticket_url, imageUrl: r.image_url, category: r.category,
      }))
      return NextResponse.json({ picks: top3 })
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!aiRes.ok) throw new Error(`Anthropic API error: ${aiRes.status}`)

    const aiData = await aiRes.json()
    const rawText: string = aiData.content?.[0]?.text ?? '[]'
    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in AI response')
    const aiPicks = JSON.parse(jsonMatch[0]) as Array<{ id: string; rank: number; pitch: string }>
    const eventById = Object.fromEntries(dedupedRows.map(r => [r.id, r]))

    const picks = aiPicks.filter(p => eventById[p.id]).slice(0, 3).map(p => {
      const r = eventById[p.id]
      return { id: p.id, rank: p.rank, pitch: p.pitch || 'A great pick for tonight!', title: r.title, venue: r.venue_name ?? '',
        dateFormatted: formatDate(r.date_start), priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl: r.ticket_url, imageUrl: r.image_url, category: r.category }
    })

    if (picks.length === 0) {
      const fallback = dedupedRows.slice(0, 3).map((r, i) => ({
        id: r.id, rank: i + 1,
        pitch: r.ai_description?.slice(0, 120) || `${r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Live event'} at ${r.venue_name || 'a local venue'}`,
        title: r.title, venue: r.venue_name ?? '',
        dateFormatted: formatDate(r.date_start), priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl: r.ticket_url, imageUrl: r.image_url, category: r.category,
      }))
      return NextResponse.json({ picks: fallback })
    }

    return NextResponse.json({ picks })
  } catch (err) {
    console.error('[recommend] Error:', (err as Error).message)
    return NextResponse.json({ picks: [], error: 'Failed to generate recommendations' }, { status: 500 })
  }
}
