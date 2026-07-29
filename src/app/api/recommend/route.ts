import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface EventRow {
  id: string
  title: string
  venue_name: string | null
  date_start: string | null
  is_free: boolean
  price_min: number | null
  price_max: number | null
  category: string
  ticket_url: string | null
  image_url: string | null
  description: string | null
  ai_description: string | null
}

// ---------------------------------------------------------------------------
// Formatters
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

function formatPrice(priceMin: number | null, priceMax: number | null, isFree: boolean): string {
  if (priceMin === 0 || isFree && priceMin !== null) return 'Free'
  if (priceMin === null) return ''
  if (priceMax && priceMax > priceMin) return `$${Math.round(priceMin)}–$${Math.round(priceMax)}`
  return `$${Math.round(priceMin)}`
}

// ---------------------------------------------------------------------------
// Survey answer helpers
// answers[0]=timeframe, [1]=energy, [2]=crew, [3]=experience, [4]=scene, [5]=budget
// ---------------------------------------------------------------------------
function budgetMax(answers: string[]): number | null {
  const b = answers[5] ?? ''
  if (b.includes('Free') || b.includes('25')) return 25
  if (b.includes('75')) return 75
  return null
}

function categoryHints(answers: string[]): string[] | null {
  const exp = answers[3] ?? ''
  if (exp.includes('music') || exp.includes('show')) return ['Music', 'Arts & Culture', 'Nightlife']
  if (exp.includes('Food') || exp.includes('drinks')) return ['Food & Drink', 'Community', 'Outdoors']
  return null
}

function getDateRange(timeframe: string): { start: Date; end: Date } {
  const now  = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  if (timeframe === 'Tonight') {
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)
    return { start: now, end }
  }

  if (timeframe === 'Tomorrow') {
    const start = new Date(today)
    start.setDate(start.getDate() + 1)
    const end = new Date(start)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (timeframe === 'This weekend') {
    const dow = now.getDay() // 0=Sun … 6=Sat
    const daysUntilFri = dow === 0 ? 6 : (5 - dow + 7) % 7 || 7
    const friday = new Date(today)
    friday.setDate(friday.getDate() + daysUntilFri)
    const sunday = new Date(friday)
    sunday.setDate(sunday.getDate() + 2)
    sunday.setHours(23, 59, 59, 999)
    // If it's already the weekend, start from now
    const start = (dow === 0 || dow === 6) ? now : friday
    return { start, end: sunday }
  }

  // 'Coming weeks' or unknown — 4-week lookahead
  const end = new Date(today)
  end.setDate(end.getDate() + 28)
  return { start: now, end }
}

function getSerpQueries(timeframe: string, city: string): string[] {
  if (timeframe === 'Tonight')      return [`events tonight in ${city}`, `things to do tonight in ${city}`]
  if (timeframe === 'Tomorrow')     return [`events tomorrow in ${city}`, `things to do tomorrow in ${city}`]
  if (timeframe === 'This weekend') return [`events this weekend in ${city}`, `things to do this weekend in ${city}`]
  // Coming weeks — broader queries
  return [`upcoming events in ${city}`, `things to do in ${city} this month`]
}

// ---------------------------------------------------------------------------
// Live SerpAPI crawl helpers
// ---------------------------------------------------------------------------
function inferCategory(text: string): string {
  const t = text.toLowerCase()
  if (/music|concert|band|jazz|rock|hip.?hop|festival|dj|live show/.test(t)) return 'Music'
  if (/comedy|standup|stand-up|open.?mic|improv/.test(t)) return 'Comedy'
  if (/art|gallery|exhibit|museum|theater|theatre|dance|ballet|opera/.test(t)) return 'Arts & Culture'
  if (/food|drink|wine|beer|tasting|dinner|brunch|restaurant|cocktail|bar/.test(t)) return 'Food & Drink'
  if (/sport|game|race|fitness|yoga|run|hike|outdoor|climb/.test(t)) return 'Sports & Outdoors'
  if (/night|club|lounge|dj|party/.test(t)) return 'Nightlife'
  return 'Community'
}

function parseGoogleEventDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  try {
    // Handle Google Events "when" format: "Tue, Jul 29, 7:00 PM – 9:00 PM"
    // or start_date like "2026-07-29"
    // Strip trailing range (e.g., " – 9:00 PM")
    const cleaned = dateStr.replace(/\s*[–-]\s*\d+:\d+\s*(AM|PM).*/i, '').trim()

    // Try direct parse first (ISO dates like "2026-07-29")
    const d = new Date(cleaned)
    if (!isNaN(d.getTime())) return d.toISOString()

    // Try appending current year for "Tue, Jul 29, 7:00 PM" style
    const withYear = `${cleaned} ${new Date().getFullYear()}`
    const d2 = new Date(withYear)
    if (!isNaN(d2.getTime())) return d2.toISOString()
  } catch { /* */ }
  return null
}

function parseSerpPrice(
  ticketInfo: Array<{ source?: string; link?: string; price?: string }> | undefined,
): number | null {
  if (!ticketInfo?.length) return null
  for (const t of ticketInfo) {
    if (!t.price) continue
    if (t.price.toLowerCase().includes('free')) return 0
    const m = t.price.match(/\$(\d+)/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

async function fetchLiveSerpEvents(cityName: string, timeframe = 'Tonight'): Promise<EventRow[]> {
  const serpKey = process.env.SERPAPI_KEY
  if (!serpKey) return []

  const queries = getSerpQueries(timeframe, cityName)

  const results: EventRow[] = []
  const seen = new Set<string>()

  await Promise.all(
    queries.map(async (q, qi) => {
      try {
        const url =
          `https://serpapi.com/search.json?engine=google_events` +
          `&q=${encodeURIComponent(q)}&hl=en&gl=us&api_key=${serpKey}`

        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) return

        const data = await res.json()
        const events: unknown[] = data.events_results ?? []

        for (let i = 0; i < events.length; i++) {
          const e = events[i] as Record<string, unknown>
          const title = (e.title as string) ?? 'Local Event'
          const key = title.toLowerCase().slice(0, 40)
          if (seen.has(key)) continue
          seen.add(key)

          const ticketInfo = e.ticket_info as Array<{ source?: string; link?: string; price?: string }> | undefined
          const date = e.date as Record<string, string> | undefined
          const venue = e.venue as Record<string, string> | undefined
          const address = e.address as string[] | undefined

          const price = parseSerpPrice(ticketInfo)
          const isFree = price === 0 || (e.description as string ?? '').toLowerCase().includes('free')

          results.push({
            id: `live_${qi}_${i}`,
            title,
            venue_name: venue?.name ?? address?.[0] ?? null,
            date_start: parseGoogleEventDate(date?.start_date ?? date?.when),
            is_free: isFree,
            price_min: isFree ? 0 : price,
            price_max: null,
            category: inferCategory(title + ' ' + ((e.description as string) ?? '')),
            ticket_url: (ticketInfo?.[0]?.link ?? e.link ?? null) as string | null,
            image_url: (e.thumbnail ?? null) as string | null,
            description: (e.description ?? null) as string | null,
            ai_description: null,
          })
        }
      } catch (err) {
        console.error('[recommend] SerpAPI fetch error:', err)
      }
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// POST /api/recommend
// Body: { city: string, answers: string[], lat?: number, lng?: number }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      city?: string
      answers: string[]
      lat?: number
      lng?: number
    }

    const { city = '', answers, lat, lng } = body
    const hasGps = typeof lat === 'number' && typeof lng === 'number'

    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: 'answers required' }, { status: 400 })
    }

    // answers[0] is the new timeframe question
    const timeframe = (answers[0] as string) || 'Tonight'
    const { start: dateStart, end: dateEnd } = getDateRange(timeframe)

    const maxBudget = budgetMax(answers)
    const catHints  = categoryHints(answers)

    // ── 1. Live SerpAPI crawl (always when we have a city or GPS) ──
    const liveEventsPromise = (city.trim() || hasGps)
      ? fetchLiveSerpEvents(city.trim() || 'nearby', timeframe)
      : Promise.resolve([] as EventRow[])

    // ── 2. Supabase query (pre-crawled events) -
    let dbRowsPromise: Promise<EventRow[]> = Promise.resolve([])
    if (isSupabaseConfigured() && city.trim()) {
      let q = supabase
        .from('events')
        .select('*')
        .ilike('city', `%${city.trim()}%`)
        .eq('is_duplicate', false)
        .gte('date_start', dateStart.toISOString())
        .lte('date_start', dateEnd.toISOString())
        .order('date_start', { ascending: true })
        .limit(40)

      if (catHints) q = q.in('category', catHints)
      if (maxBudget !== null) q = q.or(`is_free.eq.true,price_min.lte.${maxBudget}`)

      dbRowsPromise = q.then((result: { data: EventRow[] | null }) => result.data ?? [])
    }

    // ── 3. Await both in parallel ──
    const [liveEvents, dbRows] = await Promise.all([liveEventsPromise, dbRowsPromise])

    // ── 4. Merge — live events first (fresher), then DB ──
    const dbTitles = new Set(dbRows.map(r => r.title.toLowerCase().slice(0, 40)))
    const uniqueLive = liveEvents.filter(
      e => !dbTitles.has(e.title.toLowerCase().slice(0, 40)),
    )
    let rows: EventRow[] = [...uniqueLive, ...dbRows]

    // ── 5. DB fallback if merged pool still thin ──
    if (rows.length < 3 && isSupabaseConfigured() && city.trim()) {
      const { data: fallback } = await supabase
        .from('events')
        .select('*')
        .ilike('city', `${city.trim()}%`)
        .eq('is_duplicate', false)
        .gte('date_start', dateStart.toISOString())
        .order('date_start', { ascending: true })
        .limit(40)

      const fallbackRows = (fallback ?? []) as EventRow[]
      if (fallbackRows.length > rows.length) rows = [...uniqueLive, ...fallbackRows]
    }

    if (rows.length === 0) {
      return NextResponse.json({ picks: [] })
    }

    // ── 6. Build event list for the AI prompt ──
    const locationLabel = hasGps ? `near your location (${city || 'GPS coordinates'})` : `in ${city}`

    const eventList = rows
      .map((r, i) => {
        const price = r.price_min === 0 ? 'Free' : r.price_min ? `$${r.price_min}` : 'price unknown'
        const date  = r.date_start
          ? new Date(r.date_start).toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric',
            })
          : 'TBD'
        const desc  = r.ai_description ?? r.description?.slice(0, 120) ?? ''
        const src   = r.id.startsWith('live_') ? '[live]' : '[db]'
        return `${i + 1}. ID:${r.id} ${src} | ${r.title} | ${r.venue_name ?? 'Local venue'} | ${date} | ${price} | ${r.category}${desc ? ` | ${desc}` : ''}`
      })
      .join('\n')

    const labelMap = ['When', 'Energy level', 'Group size', 'Experience type', 'Scene/crowd', 'Budget']
    const answerSummary = answers.map((a, i) => `- ${labelMap[i] ?? `Q${i + 1}`}: ${a}`).join('\n')

    const timeframeInstruction =
      timeframe === 'Tonight'      ? 'Prefer events happening TODAY or TONIGHT — prioritise the soonest options.' :
      timeframe === 'Tomorrow'     ? 'Prefer events happening TOMORROW.' :
      timeframe === 'This weekend' ? 'Prefer events happening THIS WEEKEND (Friday–Sunday).' :
                                     'Show a variety across the coming weeks — the user is calendar-planning, so spread dates out and highlight anything worth booking early.'

    const prompt = `You are a local event expert helping someone find their perfect outing.

User preferences:
${answerSummary}

Events available ${locationLabel} for ${timeframe.toLowerCase()}:
${eventList}

Pick the 3 BEST events that match this person's vibe. ${timeframeInstruction} Consider energy level, group size, experience preference, scene, and budget. Prioritise variety — don't pick 3 of the same type.

Return ONLY a valid JSON array — 
  no other text, no markdown, no explanation:
[
  {"id":"<exact event ID from the list above>","rank":1,"pitch":"<one punchy sentence, max 25 words, why this is perfect for them tonight>"},
  {"id":"<id>","rank":2,"pitch":"<...>"},
  {"id":"<id>","rank":3,"pitch":"<...>"}
]`

    const anthropicKey = process.env.ANTHROPIC_API_KEY

    // ── 7. No API key: return top 3 by position ──
    if (!anthropicKey) {
      const allById = Object.fromEntries(rows.map(r => [r.id, r]))
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
      void allById
      return NextResponse.json({ picks: top3 })
    }

    // ── 8. Call Claude Haiku ──
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!aiRes.ok) throw new Error(`Anthropic API error: ${aiRes.status}`)

    const aiData  = await aiRes.json()
    const rawText: string = aiData.content?.[0]?.text ?? '[]'

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

    // Fallback if AI returned bad IDs
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
