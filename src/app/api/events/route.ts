import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { mapEventRow } from '@/lib/events'
import type { EventCategory, GroupType, AgeGroup, WhenFilter } from '@/types'

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
      // Saturday: rest of this weekend (today + Sunday)
      start = new Date(now)
      end   = new Date(now); end.setDate(now.getDate() + 1); end.setHours(23, 59, 59, 999)
    } else if (day === 0) {
      // Sunday: rest of today
      start = new Date(now)
      end   = new Date(now); end.setHours(23, 59, 59, 999)
    } else {
      // Mon–Fri: upcoming Friday through Sunday
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
// GET /api/events — reads from Supabase events table
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

  // Supabase not wired up yet — return a helpful empty response
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      events: [],
      total: 0,
      message: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then run the worker to populate events.',
    })
  }

  const offset    = page * PAGE_SIZE
  const nowIso    = new Date().toISOString()
  const dateRange = getDateRange(when)

  // Build query
  let query = supabase
    .from('events')
    .select('*', { count: 'exact' })
    .ilike('city', `%${city.trim()}%`)
    .eq('is_duplicate', false)
    .order('date_start', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  // Only show future events unless 'today' starts at midnight (covers ongoing today events)
  if (dateRange) {
    query = query
      .gte('date_start', dateRange.start)
      .lte('date_start', dateRange.end)
  } else {
    // Default: anything from now forward
    query = query.gte('date_start', nowIso)
  }

  if (categories.length > 0) {
    query = query.in('category', categories)
  }

  if (groups.length > 0) {
    query = query.overlaps('group_suitability', groups)
  }

  if (ageGroups.length > 0) {
    query = query.overlaps('age_groups', ageGroups)
  }

  const { data, count, error } = await query

  if (error) {
    console.error('[events API] Supabase error:', error.message)
    return NextResponse.json({ events: [], total: 0, error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { events: (data ?? []).map(mapEventRow), total: count ?? 0 },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } }
  )
}
