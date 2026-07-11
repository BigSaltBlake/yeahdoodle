/**
 * Shared helpers for mapping raw Supabase event rows to the YDEvent shape.
 */

import type { YDEvent, EventCategory, GroupType, AgeGroup } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEventRow(row: any): YDEvent {
  const dateStart: string = row.date_start ?? ''
  let date = ''
  let time: string | undefined

  if (dateStart) {
    const d = new Date(dateStart)
    date = d.toISOString().slice(0, 10)
    const h = d.getHours()
    const m = d.getMinutes()
    if (h !== 0 || m !== 0) {
      time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }

  return {
    id:               row.id,
    title:            row.title ?? '',
    description:      row.ai_description ?? row.description ?? '',
    aiDescription:    row.ai_description ?? undefined,
    category:         (row.category ?? 'Other') as EventCategory,
    date,
    time,
    venueName:        row.venue_name ?? '',
    venueAddress:     row.venue_address ?? undefined,
    city:             row.city ?? '',
    state:            row.state ?? undefined,
    imageUrl:         row.image_url ?? undefined,
    ticketUrl:        row.ticket_url ?? undefined,
    priceMin:         row.price_min ?? undefined,
    priceMax:         row.price_max ?? undefined,
    isFree:           row.is_free ?? (!row.price_min),
    source:           row.source ?? 'manual',
    groupSuitability: (row.group_suitability ?? []) as GroupType[],
    ageGroups:        (row.age_groups ?? ['all-ages']) as AgeGroup[],
  }
}
