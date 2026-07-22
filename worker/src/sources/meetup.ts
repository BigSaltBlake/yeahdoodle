/**
 * Meetup.com API → Supabase sync
 *
 * Covers grassroots community events: tech meetups, hiking groups,
 * book clubs, neighborhood gatherings, hobby groups.
 *
 * Uses Meetup's public find/upcoming_events endpoint.
 * Optional: set MEETUP_KEY for higher rate limits (https://www.meetup.com/api/)
 */

import crypto from 'crypto'
import type { Db } from '../lib/db'

const MEETUP_KEY = process.env.MEETUP_KEY ?? ''
const BASE_URL = 'https://api.meetup.com'

interface MeetupVenue {
  id?: number; name?: string; address_1?: string
  city?: string; state?: string; country?: string
  lat?: number; lon?: number
}
interface MeetupGroup {
  id?: number; name?: string; urlname?: string
  city?: string; state?: string; category?: { name?: string }
}
interface MeetupPhoto {
  id?: number; photo_link?: string; highres_link?: string; thumb_link?: string
}
interface MeetupEvent {
  id: string; name: string; time: number
  local_date?: string; local_time?: string; description?: string; link: string
  venue?: MeetupVenue; group?: MeetupGroup; featured_photo?: MeetupPhoto
  rsvp_limit?: number; yes_rsvp_count?: number; status?: string
}
interface MeetupResponse { events?: MeetupEvent[]; results?: MeetupEvent[] }

function inferCategory(name: string, description?: string, groupCategory?: string): string {
  const text = `${name} ${description ?? ''} ${groupCategory ?? ''}`.toLowerCase()
  if (/tech|code|software|dev|startup|hack|data|ai|ml|engineer/.test(text)) return 'Business'
  if (/hike|run|bike|yoga|fitness|sport|outdoor|climb|trail|walk/.test(text)) return 'Sports'
  if (/art|craft|paint|knit|sew|photo|creative|maker/.test(text)) return 'Arts'
  if (/food|cook|wine|beer|tasting|culinary|bake/.test(text)) return 'Food & Drink'
  if (/book|read|writ|literary|poetry/.test(text)) return 'Education'
  if (/music|jam|sing|concert|band/.test(text)) return 'Music'
  if (/family|kid|parent|baby|children/.test(text)) return 'Family'
  if (/network|business|professional|entrepreneur/.test(text)) return 'Business'
  if (/language|learn|class|workshop|seminar|course/.test(text)) return 'Education'
  if (/game|board|trivia|quiz|esport/.test(text)) return 'Entertainment'
  return 'Community'
}

function stripHtml(html?: string): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, ' ').replace(/<p>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return text.slice(0, 600) || null
}

function buildDateStr(event: MeetupEvent): string {
  if (event.time) return new Date(event.time).toISOString()
  if (event.local_date) {
    const dt = event.local_time ? `${event.local_date}T${event.local_time}:00` : `${event.local_date}T00:00:00`
    const d = new Date(dt)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function mapToRow(event: MeetupEvent, city: string) {
  const title = event.name ?? 'Untitled Meetup'
  const venueName = event.venue?.name ?? null
  const dateStr = buildDateStr(event)
  const description = stripHtml(event.description)
  const groupCategory = event.group?.category?.name

  const dedupeKey = crypto.createHash('sha1')
    .update(`meetup|${title.toLowerCase().trim()}|${(venueName ?? '').toLowerCase().trim()}|${dateStr.slice(0, 10)}`)
    .digest('hex')

  const imageUrl = event.featured_photo?.highres_link ?? event.featured_photo?.photo_link ?? null

  // Meetup venues provide lat/lon — stored for GPS radius search
  const lat = event.venue?.lat ?? null
  const lng = event.venue?.lon ?? null

  return {
    title, date_start: dateStr, venue_name: venueName,
    city: event.venue?.city ?? event.group?.city ?? city,
    lat, lng,
    category: inferCategory(title, description ?? '', groupCategory),
    description, ai_description: null as string | null,
    image_url: imageUrl, ticket_url: event.link ?? null,
    source: 'meetup', dedupe_key: dedupeKey, is_duplicate: false,
  }
}

async function fetchEventsForCity(city: string): Promise<MeetupEvent[]> {
  const params = new URLSearchParams({
    text: city, fields: 'featured_photo,group_category', page: '50',
    only: 'id,name,time,local_date,local_time,description,link,venue,group,featured_photo,status',
  })
  if (MEETUP_KEY) params.set('key', MEETUP_KEY)

  try {
    const res = await fetch(`${BASE_URL}/find/upcoming_events?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn(`[meetup] HTTP ${res.status} for ${city}`); return [] }
    const data: MeetupResponse = await res.json()
    const events = data.events ?? data.results ?? []
    const now = Date.now()
    return events.filter(e => e.status !== 'cancelled' && e.time > now)
  } catch (err) {
    console.error(`[meetup] Fetch failed for ${city}:`, err); return []
  }
}

export async function syncMeetup(db: Db, cities: string[]): Promise<void> {
  let total = 0
  for (const city of cities) {
    try {
      const events = await fetchEventsForCity(city)
      if (events.length === 0) {
        console.log(`[meetup] ${city}: 0 events (may need MEETUP_KEY for better results)`); continue
      }
      const rows = events.map(e => mapToRow(e, city))
      const { error } = await db.from('events').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      if (error) console.error(`[meetup] Upsert error for ${city}:`, error.message)
      else { console.log(`[meetup] ${city}: +${rows.length} events`); total += rows.length }
    } catch (err) { console.error(`[meetup] Failed for ${city}:`, err) }
  }
  console.log(`[meetup] Done — ${total} total events upserted`)
}
