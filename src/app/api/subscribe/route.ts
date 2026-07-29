import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; city?: string }
    const email = (body.email ?? '').toLowerCase().trim()
    const city  = (body.city  ?? '').trim() || null

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 500 })
    }

    const sb = createClient(supabaseUrl, serviceKey)

    const { error } = await sb
      .from('email_subscribers')
      .upsert({ email, city }, { onConflict: 'email' })

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[subscribe]', (err as Error).message)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}
