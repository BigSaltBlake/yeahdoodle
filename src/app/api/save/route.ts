import { NextRequest, NextResponse } from 'next/server'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      event_id?: string
      event_title?: string
      event_data?: Record<string, unknown>
      intent?: string
      session_id?: string
      city?: string
    }
    if (!body.event_id || !['save_for_later', 'definitely_going'].includes(body.intent ?? '')) {
      return NextResponse.json({ error: 'invalid params' }, { status: 400 })
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ saved: true })
    }
    await supabase.from('saved_events').delete().eq('event_id', body.event_id).eq('session_id', body.session_id ?? '')
    const { error } = await supabase.from('saved_events').insert({
      event_id:    body.event_id,
      event_title: body.event_title ?? null,
      event_data:  body.event_data ?? null,
      intent:      body.intent,
      session_id:  body.session_id ?? null,
      city:        body.city ?? null,
    })
    if (error) {
      console.error('[save] insert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ saved: true })
  } catch (err) {
    console.error('[save] error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { event_id?: string; session_id?: string }
    if (!body.event_id) {
      return NextResponse.json({ error: 'missing event_id' }, { status: 400 })
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ saved: false })
    }
    await supabase.from('saved_events').delete().eq('event_id', body.event_id).eq('session_id', body.session_id ?? '')
    return NextResponse.json({ saved: false })
  } catch (err) {
    console.error('[save] delete error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
