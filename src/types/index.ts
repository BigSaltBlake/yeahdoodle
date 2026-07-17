export interface YDEvent {
  id: string
  title: string
  description: string
  aiDescription?: string
  category: EventCategory
  subcategory?: string
  date: string        // ISO date string
  time?: string       // "8:00 PM"
  venueName: string
  venueAddress?: string
  city: string
  state?: string
  imageUrl?: string
  ticketUrl?: string
  priceMin?: number
  priceMax?: number
  isFree: boolean
  source: 'ticketmaster' | 'scraped' | 'manual'
  groupSuitability: GroupType[]
  ageGroups: AgeGroup[]
}

export type EventCategory =
  | 'Music'
  | 'Food & Drink'
  | 'Arts & Culture'
  | 'Sports'
  | 'Nightlife'
  | 'Outdoors'
  | 'Community'
  | 'Other'

export type GroupType =
  | 'singles'
  | 'couples'
  | 'friend-groups'
  | 'families'
  | 'child-friendly'

export type AgeGroup =
  | 'all-ages'
  | 'toddlers'      // 0-3
  | 'young-kids'    // 4-8
  | 'tweens'        // 9-12
  | 'teens'         // 13-17
  | '18-plus'
  | '21-plus'

export type WhenFilter = 'today' | 'weekend' | 'week' | ''

export interface FilterState {
  city: string
  categories: EventCategory[]
  groups: GroupType[]
  ageGroups: AgeGroup[]
  when: WhenFilter
  page: number
}

// Anonymous user profile stored in localStorage
export interface LocalProfile {
  categoryScores: Record<string, number>   // category → click/save count
  groupScores: Record<string, number>      // group type → inferred score
  cityHistory: string[]                    // searched cities, most recent first
  savedEventIds: string[]                  // saved event IDs
  interactionCount: number                 // total interactions tracked
  vibeSetup: boolean                       // did user complete the vibe modal?
  vibeCategories: EventCategory[]          // explicit survey choices
  vibeGroup: GroupType | null              // explicit survey group choice
  lastSeen: number                         // unix timestamp
}

export interface VibeData {
  topCategories: EventCategory[]
  topGroups: GroupType[]
  preferredCity: string
}
