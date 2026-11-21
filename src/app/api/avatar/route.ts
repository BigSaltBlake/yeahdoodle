import { NextResponse } from 'next/server'
// Debug route removed — no longer needed
export async function GET() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
