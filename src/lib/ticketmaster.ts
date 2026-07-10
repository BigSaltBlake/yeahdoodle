/**
 * @deprecated No longer called from the Next.js app.
 * Ticketmaster logic has moved to worker/src/sources/ticketmaster.ts.
 * This file is kept for reference only.
 */

import type { YDEvent, EventCategory, GroupType, AgeGroup } from '@/types'

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2'
const API_KEY = process.env.TICKETMASTER_API_KEY!

const SEGMENT_MAP: Record<string, EventCategory> = {
  'Music':          'Music',
  'Sports':         'Sports',
  'Arts & Theatre': 'Arts & Culture',
  'Film':           'Arts & Culture',
  'Miscellaneous':  'Community',
  'Family':         'Community',
}

interface TMEvent {
  id: string
  name: string
  dates?: { start?: { localDate?: string; localTime?: string } }
  classifications?: Array<{ segment?: { name: string }; genre?: { name: string } }>
  images?: Array<{ url: string; width: number; height: number; ratio?: string }>
  url?: string
  priceRanges?: Array<{ min: number; max: number }>
  _embedded?: { venues?: Array<{ name: string; address?: { line1: string }; city?: { name: string }; state?: { stateCode: string } }> }
  info?: string
  pleaseNote?: string
  description?: string
}

function inferGroupSuitability(event: TMEvent): GroupType[] {
  const name = (event.name ?? '').toLowerCase()
  const segment = event.classifications?.[0]?.segment?.name ?? ''
  const genre = event.classifications?.[0]?.genre?.name ?? ''
  const groups: GroupType[] = ['singles', 'couples', 'friend-groups']
  if (segment === 'Family' || genre === 'Family' || name.includes('family') || name.includes('kids')) {
    groups.push('families', 'child-friendly')
  }
  return groups
}

function inferAgeGroups(event: TMEvent): AgeGroup[] {
  const segment = event.classifications?.[0]?.segment?.name ?? ''
  const genre = event.classifications?.[0]?.genre?.name ?? ''
  const name = (event.name ?? '').toLowerCase()
  if (segment === 'Family' || genre === 'Family') return ['all-ages', 'young-kids', 'tweens', 'teens']
  if (name.includes('21+') || name.includes('21 ')) return ['21-plus']
  if (name.includes('18+')) return ['18-plus']
  return ['all-ages']
}

function inferCategoryFromName(name: string): EventCategory {
  const n = name.toLowerCase()
  if (n.includes('concert') || n.includes('music') || n.includes('band')) return 'Music'
  if (n.includes('food') || n.includes('drink') || n.includes('wine') || n.includes('beer')) return 'Food & Drink'
  if (n.includes('art') || n.includes('museum') || n.includes('comedy')) return 'Arts & Culture'
  if (n.includes('sport') || n.includes('game') || n.includes('match')) return 'Sports'
  if (n.includes('club') || n.includes('night') || n.includes('dj')) return 'Nightlife'
  if (n.includes('hike') || n.includes('outdoor') || n.includes('park')) return 'Outdoors'
  return 'Other'
}

export interface FetchEventsParams {
  city: string
  categories?: string[]
  groups?: string[]
  ageGroups?: string[]
  when?: string
  page?: number
  size?: number
}

export async function fetchEvents(params: FetchEventsParams): Promise<{ events: YDEvent[]; total: number }> {
  return { events: [], total: 0 }
}
