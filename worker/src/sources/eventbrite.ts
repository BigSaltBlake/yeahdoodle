/**
 * Eventbrite API v3 -> Supabase sync
 *
 * Covers categories that Ticketmaster + SeatGeek miss:
 * Food & Drink, Community, Health/Wellness, Networking, Family.
 *
 * Auth: Bearer token in Authorization header.
 * Set env var: EVENTBRITE_TOKEN
 *
 * Rate limit: generous on standard plans (~100 req/min).
 * Docs: https://www.eventbrite.com/platform/api#/
 */

import axios from 'axios'
import type { Db } from '../lib/db'

const EB_BASE = 'https://www.eventbriteapi.com/v3'

// ---------------------------------------------------------------------------
// Eventbrite category IDs -> YD categories
// ---------------------------------------------------------------------------
const EB_CATEGORY_TO_YD: Record<string, string> = {
  '103': 'Music',
  '110': 'Food & Drink',
  '105': 'Arts & Culture',
  '104': 'Arts & Culture',
  '108': 'Sports',
  '107': 'Community',
  '113': 'Community',
  '117': 'Community',
  '121': 'Nightlife',
  '115': 'Outdoors',
  '109': 'Outdoors',
  '102': 'Community',
  '101': 'Community',
}

// ---------------------------------------------------------------------------
// Type definitions for Eventbrite API response
// ---------------------------------------------------------------------------
interface EBAddress {
  address_1?: string
  city?: string
  region?: string
  latitude?: string
  longitude?: string
}

interface EBVenue {
  name: string | null
  address: EBAddress | null
}

interface EBTicketPrice {
  value: number
  currency: string
}

interface EBTicketAvailability {
  minimum_ticket_price?: EBTicketPrice | null
  maximum_ticket_price?: EBTicketPrice | null
  is_free: boolean
}

interface EBEvent {
  id: string
  name: { text: string }
  description: { text: string | null } | null
  start: { local: string; utc: string }
  end: { local: string; utc: string } | null
  url: string
  logo?: { url: string } | null
  category_id: string | null
  subcategory_id: string | null
  format_id: string | null
  is_free: boolean
  venue: EBVenue | null
  ticket_availability?: EBTicketAvailability | null
}

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------
function inferCategory(event: EBEvent): string {
  if (event.category_id && EB_CATEGORY_TO_YD[event.category_id]) {
    return EB_CATEGORY_TO_YD[event.category_id]
  }
  const n = (event.name?.text ?? '').toLowerCase()
  if (n.includes('food') || n.includes('wine') || n.includes('beer') || n.includes('tast') || n.includes('brunch') || n.includes('cocktail') || n.includes('brewery') || n.includes('winery') || n.includes('whiskey') || n.includes('bourbon') || n.includes('culinary') || n.includes('distillery')) return 'Food & Drink'
  if (n.includes('hike') || n.includes('outdoor') || n.includes('trail') || n.includes('kayak') || n.includes('camp') || n.includes('5k') || n.includes('10k') || n.includes('marathon') || n.includes('cycling')) return 'Outdoors'
  if (n.includes('nightclub') || n.includes(' dj ') || n.includes('rave') || n.includes('edm') || n.includes('afterparty') || n.includes('club night') || n.includes('techno')) return 'Nightlife'
  if (n.includes('concert') || n.includes('live music') || n.includes('band')) return 'Music'
  if (n.includes('art') || n.includes('gallery') || n.includes('theatre') || n.includes('theater') || n.includes('comedy') || n.includes('improv') || n.includes('film') || n.includes('standup')) return 'Arts & Culture'
  if (n.includes('game') || n.includes('match') || n.includes('tournament') || n.includes('race') || n.includes('sport') || n.includes('fitness') || n.includes('yoga') || n.includes('workout')) return 'Sports'
  if (n.includes('community') || n.includes('meetup') || n.includes('networking') || n.includes('workshop') || n.includes('class') || n.includes('seminar') || n.includes('talk') || n.includes('conference')) return 'Community'
  return 'Other'
}

function inferGroupSuitability(event: EBEvent): string[] {
  const n = (event.name?.text ?? '').toLowerCase()
  const d = (event.description?.text ?? '').toLowerCase()
  const groups = ['singles', 'couples', 'friend-groups']
  if (n.includes('family') || n.includes('kid') || n.includes('children') || d.includes('family-friendly') || d.includes('all ages')) {
    groups.push('families', 'child-friendly')
  }
  return groups
}

function inferAgeGroups(event: EBEvent): string[] {
  const n = (event.name?.text ?? '').toLowerCase()
  if (n.includes('21+') || n.includes('21 plus') || n.includes('21 &')) return ['21-plus']
  if (n.includes('18+') || n.includes('18 plus')) return ['18-plus']
  if (n.includes('family') || n.includes('kid') || n.includes('children') || n.includes('all ages')) {
    return ['all-ages', 'young-kids', 'tweens', 'teens']
  }
  return ['all-ages']
}

// ---------------------------------------------------------------------------
// Map a raw Eventbrite event to our Supabase events table row
// ---------------------------------------------------------------------------
function mapToRow(raw: EBEvent, cityFallback: string) {
  const v = raw.venue
  const priceMin = raw.ticket_availability?.minimum_ticket_price?.value ?? null
  const priceMax = raw.ticket_availability?.maximum_ticket_price?.value ?? null
  const isFree   = raw.is_free || raw.ticket_availability?.is_free === true || priceMin === 0

  return {
    external_id:       raw.id,
    source:            'eventbrite',
    title:             raw.name?.text ?? '',
    description:       raw.description?.text?.slice(0, 1000) ?? null,
    ai_description:    null,
    category:          inferCategory(raw),
    date_start:        raw.start?.local ?? raw.start?.utc ?? null,
    date_end:          raw.end?.local ?? null,
    venue_name:        v?.name ?? null,
    venue_address:     v?.address?.address_1 ?? null,
    city:              v?.address?.city ?? cityFallback,
    state:             v?.address?.region ?? null,
    lat:               v?.address?.latitude  ? parseFloat(v.address.latitude)  : null,
    lng:               v?.address?.longitude ? parseFloat(v.address.longitude) : null,
    image_url:         raw.logo?.url ?? null,
    ticket_url:        raw.url ?? null,
    price_min:         isFree ? 0 : priceMin,
    price_max:         priceMax,
    is_free:           isFree,
    group_suitability: inferGroupSuitability(raw),
    age_groups:        inferAgeGroups(raw),
    dedupe_key:        v?.name && raw.start?.local && (v?.address?.city ?? cityFallback)
                         ? `${(v.name ?? '').toLowerCase().trim()}|${raw.start.local.slice(0, 10)}|${(v?.address?.city ?? cityFallback).toLowerCase().trim()}`
                         : null,
    updated_at:        new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Sleep helper for rate limiting
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Fetch one page of events for a city
// ---------------------------------------------------------------------------
async function fetchPage(
  city: string,
  page: number,
  token: string,
): Promise<{ events: EBEvent[]; hasMore: boolean }> {
  const now    = new Date()
  const future = new Date(now)
  future.setDate(future.getDate() + 30)

  const res = await axios.get(`${EB_BASE}/events/search/`, {
    headers: { Authorization: `Bearer ${token}` },
    params:  {
      'location.address':       city,
      'location.within':        '25mi',
      'start_date.range_start': now.toISOString().slice(0, 19) + 'Z',
      'start_date.range_end':   future.toISOString().slice(0, 19) + 'Z',
      expand:                   'venue,ticket_availability',
      page_size:                50,
      page,
      sort_by:                  'date',
    },
  })

  const data = res.data
  return {
    events:  data.events ?? [],
    hasMore: data.pagination?.has_more_items ?? false,
  }
}

// ---------------------------------------------------------------------------
// Main sync function — call this from the scheduler
// ---------------------------------------------------------------------------
export async function syncEventbrite(db: Db, cities: string[]): Promise<void> {
  const token = process.env.EVENTBRITE_TOKEN

  if (!token) {
    console.log('[EB] EVENTBRITE_TOKEN not set — skipping Eventbrite sync')
    return
  }

  let totalUpserted = 0
  let totalErrors   = 0

  for (const city of cities) {
    console.log(`[EB] Syncing ${city}...`)
    try {
      const MAX_PAGES = 3
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { events, hasMore } = await fetchPage(city, page, token)
        if (!events.length) break

        const rows = events.map(e => mapToRow(e, city))

        const { error } = await db
          .from('events')
          .upsert(rows, { onConflict: 'external_id,source', ignoreDuplicates: false })

        if (error) {
          console.error(`[EB] Upsert error for ${city} page ${page}:`, error.message)
          totalErrors++
        } else {
          totalUpserted += rows.length
          console.log(`[EB]   page ${page}: +${rows.length} (${totalUpserted} total)`)
        }

        if (!hasMore || page >= MAX_PAGES) break
        await sleep(500)
      }
    } catch (err) {
      console.error(`[EB] Error syncing ${city}:`, (err as Error).message)
      totalErrors++
    }
    await sleep(700)
  }

  console.log(`[EB] Sync complete. ${totalUpserted} events upserted, ${totalErrors} errors.`)
}
