import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { EventCategory, GroupType, AgeGroup, WhenFilter } from '@/types'

const PAGE_SIZE = 20

function getDateRange(when: WhenFilter): { start: string; end: string } | null {
  const now = new Date()

  if (when === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end   = new Date(now); end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  if (when === 'weekend') {
    const day = now.getDay()
    const daysToFri = (5 - day + 7) % 7 || (day === 5 ? 0 : 7)
    const fri = new Date(now); fri.setDate(now.getDate() + daysToFri); fri.setHours(0, 0, 0, 0)
    const sun = new Date(fri); sun.setDate(fri.getDate() + 2); sun.setHours(23, 59, 59, 999)
    return { start: fri.toISOString(), end: sun.toISOString() }
  }

  if (when === 'week') {
    const end = new Date(now); end.setDate(now.getDate() + 7); end.setHours(23, 59, 59, 999)
    return { start: now.toISOString(), end: end.toISOString() }
  }

  return null
}

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

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      events: [],
      total: 0,
      message: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.',
    })
  }

  const offset    = page * PAGE_SIZE
  const nowIso    = new Date().toISOString()
  const dateRange = getDateRange(when)

  let query = supabase
    .from('events')
    .select('*', { count: 'exact' })
    .ilike('city', `%${city.trim()}%`)
    .order('date_start', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (dateRange) {
    query = query
      .gte('date_start', dateRange.start)
      .lte('date_start', dateRange.end)
  } else {
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
    { events: data ?? [], total: count ?? 0 },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } }
  )
}
