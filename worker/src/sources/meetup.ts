import crypto from 'crypto'
import type { Db } from '../lib/db'

const MEETUP_KEY = process.env.MEETUP_KEY ?? ''
const BASE_URL = 'https://api.meetup.com'

interface MeetupVenue {
  id?: number
  name?: string
  address_1?: string
  city?: string
  state?: string
  country?: string
  lat?: number
  lon?: number
}

interface MeetupGroup {
  id?: number
  name?: string
  urlname?: string
  city?: string
  state?: string
  category?: { name?: string }
}

interface MeetupPhoto {
  id?: number
  photo_link?: string
  highres_link?: string
  thumb_link?: string
}

interface MeetupEvent {
  id: string
  name: string
  time: number
  local_date?: string
  local_time?: string
  description?: string
  link: string
  venue?: MeetupVenue
  group?: MeetupGroup
  featured_photo?: MeetupPhoto
  rsvp_limit?: number
  yes_rsvp_count?: number
  status?: string
}

interface MeetupResponse {
  events?: MeetupEvent[]
  results?: MeetupEvent[]
}

function inferCategory(name: string, desc?: string, groupCat?: string): string {
  const t = `${name} ${desc ?? ''} ${groupCat ?? ''}`.toLowerCase()
  if (/tech|code|software|dev|startup|hack|data|ai|ml|engineer/.test(t)) return 'Business'
  if (/hike|run|bike|yoga|fitness|sport|outdoor|climb|trail|walk/.test(t)) return 'Sports'
  if (/art|craft|paint|knit|sew|photo|creative|maker/.test(t)) return 'Arts'
  if (/food|cook|wine|beer|tasting|culinary|bake/.test(t)) return 'Food & Drink'
  if (/book|read|writ|literary|poetry/.test(t)) return 'Education'
  if (/music|jam|sing|concert|band/.test(t)) return 'Music'
  if (/family|kid|parent|baby|children/.test(t)) return 'Family'
  if (/network|business|professional|entrepreneur/.test(t)) return 'Business'
  if (/language|learn|class|workshop|seminar|course/.test(t)) return 'Education'
  if (/game|board|trivia|quiz|esport/.test(t)) return 'Entertainment'
  return 'Community'
}

function stripHtml(s: string | undefined): string | null {
  if (!s) return null
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) || null
}
function buildDateStr(e: MeetupEvent): string {
  if (e.time) return new Date(e.time).toISOString()
  if (e.local_date) {
    const dt = e.local_time ? `${e.local_date}T${e.local_time}:00` : `${e.local_date}T00:00:00`
    const d = new Date(dt); if (!isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function mapToRow(e: MeetupEvent, city: string) {
  const title = e.name ?? 'Untitled Meetup'
  const venueName = e.venue?.name ?? null
  const dateStr = buildDateStr(e)
  const description = stripHtml(e.description)
  const groupCat = e.group?.category?.name
  const dedupeKey = require('crypto').createHash('sha1').update(`meetup|${title.toLowerCase().trim()}|${(venueName ?? '').toLowerCase().trim()}|${dateStr.slice(0,10)}`).digest('hex')
  return {
    title, date_start: dateStr, venue_name: venueName,
    city: e.venue?.city ?? e.group?.city ?? city,
    category: inferCategory(title, description ?? '', groupCat),
    description, ai_description: null as string | null,
    image_url: e.featured_photo?.highres_link ?? e.featured_photo?.photo_link ?? null,
    ticket_url: e.link ?? null, source: 'meetup',
    dedupe_key: dedupeKey, is_duplicate: false
  }
}

async function fetchEventsForCity(city: string): Promise<MeetupEvent[]> {
  const params = new URLSearchParams({
    text: city, fields: 'featured_photo,group_category', page: '50',
    only: 'id,name,time,local_date,local_time,description,link,venue,group,featured_photo,status'
  })
  if (MEETUP_KEY) params.set('key', MEETUP_KEY)
  try {
    const res = await fetch(`${BASE_URL}/find/upcoming_events?${params}`, {
      headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) { console.warn(`[meetup] HTTP ${res.status} for ${city}`); return [] }
    const data: MeetupResponse = await res.json()
    const events = data.events ?? data.results ?? []
    const now = Date.now()
    return events.filter(e => e.status !== 'cancelled' && e.time > now)
  } catch (err) { console.error(`[meetup] Failed for ${city}:`, err); return [] }
}

export async function syncMeetup(db: Db, cities: string[]): Promise<void> {
  let total = 0
  for (const city of cities) {
    try {
      const events = await fetchEventsForCity(city)
      if (events.length === 0) { console.log(`[meetup] ${city}: 0 events(may need MEETUP_KEY)`); continue }
      const rows = events.map(e => mapToRow(e, city))
      const { error } = await db.from('events').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      if (error) { console.error(`[meetup] Upsert error for ${city}:`, error.message) }
      else { console.log(`[meetup] ${city}: +${rows.length} events`); total += rows.length }
    } catch (err) { console.error(`[meetup] Failed for ${city}:`, err) }
  }
  console.log(`[meetup] Done â ${total} total events upserted`)
}
