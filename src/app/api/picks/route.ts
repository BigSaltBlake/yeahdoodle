import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { city = '', ids = [] } = await req.json() as { city?: string; ids?: string[] }
    if (!ids.length) return NextResponse.json({ picks: [] })
    const dbIds = ids.filter((id: string) => !id.startsWith('live_'))
    if (!dbIds.length || !isSupabaseConfigured()) return NextResponse.json({ picks: [] })
    const { data, error } = await supabase.from('events').select('*').in('id', dbIds)
    if (error || !data?.length) return NextResponse.json({ picks: [] })
    const byId = Object.fromEntries(data.map(r => [r.id, r]))
    const picks = dbIds.map((id, i) => {
      const r = byId[id]
      if (!r) return null
      return {
        id: r.id, rank: i + 1,
        pitch: r.ai_description?.slice(0, 120) ?? r.description?.slice(0, 120) ?? 'A great local event.',
        title: r.title, venue: r.venue_name ?? '',
        dateFormatted: r.date_start ? new Date(r.date_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBD',
        priceFormatted: r.is_free || r.price_min === 0 ? 'Free' : r.price_min ? '$' + Math.round(r.price_min) : 'Price TBD',
        ticketUrl: r.ticket_url ?? null, imageUrl: r.image_url ?? null, category: r.category ?? 'Community',
      }
    }).filter(Boolean)
    void city
    return NextResponse.json({ picks })
  } catch (err) {
    console.error('[picks]', (err as Error).message)
    return NextResponse.json({ picks: [] }, { status: 500 })
  }
}