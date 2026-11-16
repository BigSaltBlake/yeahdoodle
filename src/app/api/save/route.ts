import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ---------------------------------------------------------------------------
// Build a per-request Supabase server client that reads the user session from
// cookies — this lets us populate user_id on saves when the user is signed in.
// ---------------------------------------------------------------------------
function makeSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component context — safe to ignore
          }
        },
      },
    },
  )
}

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

    const supabase = makeSupabase()

    // Determine whether the request comes from an authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id ?? null

    // Remove any prior save for this event (by session and/or user)
    if (userId) {
      await supabase.from('saved_events').delete()
        .eq('event_id', body.event_id)
        .eq('user_id', userId)
    }
    await supabase.from('saved_events').delete()
      .eq('event_id', body.event_id)
      .eq('session_id', body.session_id ?? '')

    const { error } = await supabase.from('saved_events').insert({
      event_id:    body.event_id,
      event_title: body.event_title ?? null,
      event_data:  body.event_data ?? null,
      intent:      body.intent,
      session_id:  body.session_id ?? null,
      user_id:     userId,
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

    const supabase = makeSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id ?? null

    if (userId) {
      await supabase.from('saved_events').delete()
        .eq('event_id', body.event_id)
        .eq('user_id', userId)
    }
    await supabase.from('saved_events').delete()
      .eq('event_id', body.event_id)
      .eq('session_id', body.session_id ?? '')

    return NextResponse.json({ saved: false })
  } catch (err) {
    console.error('[save] delete error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
