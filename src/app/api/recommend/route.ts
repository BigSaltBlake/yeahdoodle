import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'TBD'
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPrice(
  priceMin: number | null,
  priceMax: number | null,
  isFree: boolean,
): string {
  if (isFree || priceMin === 0 || priceMin === null) return 'Free'
  if (priceMax && priceMax > priceMin) return `$${Math.round(priceMin)}–$${Math.round(priceMax)}`
  return `$${Math.round(priceMin)}`
}

// Map the 5th survey answer (budget) to a max price filter
function budgetMax(answers: string[]): number | null {
  const b = answers[4] ?? ''
  if (b.includes('Free') || b.includes('25')) return 25
  if (b.includes('75')) return 75
  return null // no limit
}

// Map the 3rd survey answer (experience type) to category hints
function categoryHints(answers: string[]): string[] | null {
  const exp = answers[2] ?? ''
  if (exp.includes('music') || exp.includes('show')) return ['Music', 'Arts & Culture', 'Nightlife']
  if (exp.includes('Food') || exp.includes('drinks')) return ['Food & Drink', 'Community', 'Outdoors']
  return null
}

// ---------------------------------------------------------------------------
// POST /api/recommend
// Body: { city: string, answers: string[] }
// Returns: { picks: Pick[] }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const { city, answers } = await req.json() as { city: string; answers: string[] }

    if (!city?.trim() || !Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: 'city and answers required' }, { status: 400 })
    }

    if (!isSupabaseConfigured()) {
      return NextResponse.json({ picks: [] })
    }

    const now = new Date()
    const weekOut = new Date(now)
    weekOut.setDate(weekOut.getDate() + 7)

    const maxBudget = budgetMax(answers)
    const catHints  = categoryHints(answers)

    // Primary query (with category + budget hints)
    let q = supabase
      .from('events')
      .select('*')
      .ilike('city', `%${city.trim()}%`)
      .eq('is_duplicate', false)
      .gte('date_start', now.toISOString())
      .lte('date_start', weekOut.toISOString())
      .order('date_start', { ascending: true })
      .limit(50)

    if (catHints) q = q.in('category', catHints)
    if (maxBudget !== null) q = q.or(`is_free.eq.true,price_min.lte.${maxBudget}`)

    const { data: primaryRows, error: primaryErr } = await q

    let rows = primaryRows ?? []

    // Fallback: drop filters if primary returned fewer than 3 results
    if (primaryErr || rows.length < 3) {
      const { data: fallbackRows } = await supabase
        .from('events')
        .select('*')
        .ilike('city', `%${city.trim()}%`)
        .eq('is_duplicate', false)
        .gte('date_start', now.toISOString())
        .order('date_start', { ascending: true })
        .limit(50)

      if ((fallbackRows ?? []).length > rows.length) {
        rows = fallbackRows ?? []
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ picks: [] })
    }

    // Build event list for the AI prompt
    const eventList = rows
      .map((r, i) => {
        const price = r.is_free ? 'Free' : r.price_min ? `$${r.price_min}` : 'Price TBD'
        const date  = r.date_start
          ? new Date(r.date_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })
          : 'TBD'
        const desc  = r.ai_description ?? r.description?.slice(0, 120) ?? ''
        return `${i + 1}. ID:${r.id} | ${r.title} | ${r.venue_name ?? 'Unknown venue'} | ${date} | ${price} | ${r.category}${desc ? ` | ${desc}` : ''}`
      })
      .join('\n')

    const labelMap = ['Energy level', 'Group size', 'Experience type', 'Scene/crowd', 'Budget']
    const answerSummary = answers
      .map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`)
      .join('\n')

    const prompt = `You are a local event expert helping someone find their perfect night out.

User preferences:
${answerSummary}

Events available in ${city} this week:
${eventList}

Pick the 3 BEST events that match this person's vibe. Consider their energy level, group size, experience preference, scene, and budget.

Return ONLY a valid JSON array — no other text, no markdown, no explanation:
[
  {"id":"<exact event UUID from the list above>","rank":1,"pitch":"<one punchy sentence, max 25 words, why this is perfect for them tonight>"},
  {"id":"<uuid>","rank":2,"pitch":"<...>"},
  {"id":"<uuid>","rank":3,"pitch":"<...>"}
]`

    const anthropicKey = process.env.ANTHROPIC_API_KEY

    // No API key: return top 3 by date with fallback pitch
    if (!anthropicKey) {
      const top3 = rows.slice(0, 3).map((r, i) => ({
        id:             r.id,
        rank:           i + 1,
        pitch:          r.ai_description?.slice(0, 120) ?? r.description?.slice(0, 120) ?? 'A great local event happening soon.',
        title:          r.title,
        venue:          r.venue_name ?? '',
        dateFormatted:  formatDate(r.date_start),
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl:      r.ticket_url,
        imageUrl:       r.image_url,
        category:       r.category,
      }))
      return NextResponse.json({ picks: top3 })
    }

    // Call Claude Haiku
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':          anthropicKey,
        'anthropic-version':  '2023-06-01',
        'content-type':       'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) {
      throw new Error(`Anthropic API error: ${aiRes.status}`)
    }

    const aiData = await aiRes.json()
    const rawText: string = aiData.content?.[0]?.text ?? '[]'

    // Extract JSON array even if Claude adds surrounding text
    const jsonMatch = rawText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in AI response')

    const aiPicks = JSON.parse(jsonMatch[0]) as Array<{ id: string; rank: number; pitch: string }>

    const eventById = Object.fromEntries(rows.map(r => [r.id, r]))

    const picks = aiPicks
      .filter(p => eventById[p.id])
      .slice(0, 3)
      .map(p => {
        const r = eventById[p.id]
        return {
          id:             p.id,
          rank:           p.rank,
          pitch:          p.pitch,
          title:          r.title,
          venue:          r.venue_name ?? '',
          dateFormatted:  formatDate(r.date_start),
          priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
          ticketUrl:      r.ticket_url,
          imageUrl:       r.image_url,
          category:       r.category,
        }
      })

    // If AI returned bad IDs, fall back to top 3
    if (picks.length === 0) {
      const fallback = rows.slice(0, 3).map((r, i) => ({
        id:             r.id,
        rank:           i + 1,
        pitch:          r.ai_description?.slice(0, 120) ?? 'A great local event happening soon.',
        title:          r.title,
        venue:          r.venue_name ?? '',
        dateFormatted:  formatDate(r.date_start),
        priceFormatted: formatPrice(r.price_min, r.price_max, r.is_free),
        ticketUrl:      r.ticket_url,
        imageUrl:       r.image_url,
        category:       r.category,
      }))
      return NextResponse.json({ picks: fallback })
    }

    return NextResponse.json({ picks })

  } catch (err) {
    console.error('[recommend] Error:', (err as Error).message)
    return NextResponse.json(
      { picks: [], error: 'Failed to generate recommendations' },
      { status: 500 },
    )
  }
}
