import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { mapEventRow } from '@/lib/events'
import type { EventCategory, GroupType, AgeGroup, WhenFilter, YDEvent } from '@/types'

const PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Date range helpers for the 'when' filter
// ---------------------------------------------------------------------------
function getDateRange(when: WhenFilter): { start: string; end: string } | null {
  const now = new Date()

  if (when === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end   = new Date(now); end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (when === 'weekend') {
    const day = now.getDay() // 0=Sun, 1=Mon … 5=Fri, 6=Sat
    let start: Date, end: Date
    if (day === 6) {
      start = new Date(now)
      end   = new Date(now); end.setDate(now.getDate() + 1); end.setHours(23, 59, 59, 999)
    } else if (day === 0) {
      start = new Date(now)
      end   = new Date(now); end.setHours(23, 59, 59, 999)
    } else {
      const daysToFri = 5 - day
      start = new Date(now); start.setDate(now.getDate() + daysToFri); start.setHours(0, 0, 0, 0)
      end   = new Date(start); end.setDate(start.getDate() + 2); end.setHours(23, 59, 59, 999)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (when === 'week') {
    const end = new Date(now); end.setDate(now.getDate() + 7); end.setHours(23, 59, 59, 999)
    return { start: now.toISOString(), end: end.toISOString() }
  }

  return null
}

// ---------------------------------------------------------------------------
// Category inference (mirrors route.ts logic)
// ---------------------------------------------------------------------------
function inferEventCategory(text: string): EventCategory {
  const t = text.toLowerCase()
  if (/music|concert|band|jazz|rock|hip.?hop|festival|dj|live show/.test(t)) return 'Music'
  if (/comedy|standup|stand-up|improv/.test(t))                               return 'Other'
  if (/art|gallery|exhibit|museum|theater|theatre|dance|ballet|opera/.test(t)) return 'Arts & Culture'
  if (/food|drink|wine|beer|tasting|dinner|brunch|restaurant|cocktail/.test(t)) return 'Food & Drink'
  if (/hike|hiking|trail|kayak|paddle|climb|fish|camp|nature|park|outdoor|river|lake/.test(t)) return 'Outdoors'
  if (/sport|game|race|fitness|yoga|run/.test(t))                              return 'Sports'
  if (/night|club|lounge|party/.test(t))                                       return 'Nightlife'
  return 'Community'
}

// ---------------------------------------------------------------------------
// SerpAPI live-event fetch — fires when DB returns nothing
// ---------------------------------------------------------------------------
async function fetchSerpLiveEvents(
  city: string,
  when: WhenFilter,
  serperKey: string,
): Promise<YDEvent[]> {
  const whenStr =
    when === 'today'   ? 'today' :
    when === 'weekend' ? 'this weekend' :
    when === 'week'    ? 'this week' :
    ''

  // Single query per Discover search — keeps Serper.dev usage minimal
  const queries = [
    `events ${whenStr} in ${city}`.replace(/\s+/g, ' ').trim(),
  ]

  const seen    = new Set<string>()
  const results: YDEvent[] = []

  await Promise.all(
    queries.map(async (q) => {
      try {
        const res = await fetch('https://google.serper.dev/events', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q, gl: 'us', hl: 'en' }),
          cache: 'no-store',
        })
        if (!res.ok) return

        const data = await res.json()
        const events: unknown[] = data.events ?? []

        for (let i = 0; i < events.length; i++) {
          const e = events[i] as Record<string, unknown>
          const title = (e.title as string) ?? 'Local Event'
          const key   = title.toLowerCase().slice(0, 40)
          if (seen.has(key)) continue
          seen.add(key)

          const date       = e.date as Record<string, string> | undefined
          const venue      = e.venue as Record<string, string> | undefined
          const address    = e.address as string[] | undefined
          const ticketInfo = e.ticket_info as Array<{ link?: string; price?: string }> | undefined
          const priceStr   = ticketInfo?.find(t => t.price)?.price

          let dateIso = ''
          try {
            const raw = date?.start_date ?? date?.when ?? ''
            const cleaned = raw.replace(/\s*[–-]\s*\d+:\d+\s*(AM|PM).*/i, '').trim()
            const d = new Date(cleaned || new Date())
            if (!isNaN(d.getTime())) {
              if (d.getFullYear() < 2020) d.setFullYear(new Date().getFullYear())
              dateIso = d.toISOString().slice(0, 10)
            }
          } catch { /* */ }

          const isFree = priceStr
            ? priceStr.toLowerCase().includes('free') || priceStr === '$0'
            : false
          const priceMin = priceStr
            ? (() => { const m = priceStr.match(/\$(\d+)/); return m ? parseInt(m[1], 10) : undefined })()
            : undefined

          const cat = inferEventCategory(title + ' ' + ((e.description as string) ?? ''))

          results.push({
            id:               `live_${results.length}_${i}`,
            title,
            description:      (e.description as string) ?? '',
            aiDescription:    undefined,
            category:         cat,
            date:             dateIso || new Date().toISOString().slice(0, 10),
            time:             undefined,
            venueName:        venue?.name ?? address?.[0] ?? 'Local Venue',
            venueAddress:     address?.join(', ') ?? '',
            city,
            state:            undefined,
            imageUrl:         (e.thumbnail as string | undefined),
            ticketUrl:        ticketInfo?.[0]?.link ?? undefined,
            priceMin,
            priceMax:         undefined,
            isFree,
            source:           'scraped',
            groupSuitability: [],
            ageGroups:        ['all-ages'],
          } as YDEvent)
        }
      } catch (err) {
        console.error('[events API] SerpAPI fallback error:', err)
      }
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const city       = searchParams.get('city') ?? ''
  const categories = searchParams.getAll('category') as EventCategory[]
  const groups     = searchParams.getAll('group') as GroupType[]
  const ageGroups  = searchParams.getAll('age') as AgeGroup[]
  const when       = (searchParams.get('when') ?? '') as WhenFilter
  const page       = parseInt(searchParams.get('page') ?? '0', 10)

  if (!city.trim()) {
    return NextResponse.json({ events: [], total: 0 })
  }

  // Supabase not configured — go straight to SerpAPI
  if (!isSupabaseConfigured()) {
    const serpKey = process.env.SERPER_API_KEY
    if (serpKey) {
      const liveEvents = await fetchSerpLiveEvents(city.trim(), when, serpKey)
      const filtered   = categories.length > 0
        ? liveEvents.filter(e => categories.includes(e.category))
        : liveEvents
      const toReturn = filtered.length > 0 ? filtered : liveEvents
      return NextResponse.json({ events: toReturn, total: toReturn.length })
    }
    return NextResponse.json({
      events: [],
      total: 0,
      message: 'Supabase is not configured.',
    })
  }

  const offset    = page * PAGE_SIZE
  const nowIso    = new Date().toISOString()
  const dateRange = getDateRange(when)

  // Build DB query
  let query = supabase
    .from('events')
    .select('*', { count: 'exact' })
    .ilike('city', `%${city.trim()}%`)
    .eq('is_duplicate', false)
    .order('date_start', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (dateRange) {
    query = query
      .gte('date_start', dateRange.start)
      .lte('date_start', dateRange.end)
  } else {
    query = query.gte('date_start', nowIso)
  }

  if (categories.length > 0) query = query.in('category', categories)
  if (groups.length > 0)     query = query.overlaps('group_suitability', groups)
  if (ageGroups.length > 0)  query = query.overlaps('age_groups', ageGroups)

  const { data, count, error } = await query

  if (error) {
    console.error('[events API] Supabase error:', error.message)
    return NextResponse.json({ events: [], total: 0, error: error.message }, { status: 500 })
  }

  // DB has results — return them
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { events: (data ?? []).map(mapEventRow), total: count ?? 0 },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } },
    )
  }

  // ── DB returned nothing — fire SerpAPI live crawl ────────────────────────
  const serpKey = process.env.SERPER_API_KEY
  if (serpKey) {
    let liveEvents = await fetchSerpLiveEvents(city.trim(), when, serpKey)

    if (liveEvents.length > 0) {
      // Respect category filter; if it wipes everything, return unfiltered live results
      const filtered = categories.length > 0
        ? liveEvents.filter(e => categories.includes(e.category))
        : liveEvents
      liveEvents = filtered.length > 0 ? filtered : liveEvents

      return NextResponse.json(
        { events: liveEvents, total: liveEvents.length },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }

  // Absolute last resort — return empty (SerpAPI not configured or timed out)
  return NextResponse.json({ events: [], total: 0 })
}
