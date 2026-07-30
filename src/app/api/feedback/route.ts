import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      event_id?: string
      event_title?: string
      rating?: string
      session_id?: string
      city?: string
    }

    if (!body.event_id || !['up', 'meh', 'down'].includes(body.rating ?? '')) {
      return NextResponse.json({ error: 'invalid params' }, { status: 400 })
    }

    // Graceful no-op if Supabase not configured (dev / missing env)
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase
      .from('pick_feedback')
      .insert({
        event_id:    body.event_id,
        event_title: body.event_title ?? null,
        rating:      body.rating,
        session_id:  body.session_id ?? null,
        city:        body.city ?? null,
      })

    if (error) {
      console.error('[feedback] insert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[feedback] error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
