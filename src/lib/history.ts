'use client'

import type { LocalProfile, EventCategory, GroupType, VibeData } from '@/types'

const PROFILE_KEY = 'yd_profile'

const DEFAULT_PROFILE: LocalProfile = {
  categoryScores: {},
  groupScores: {},
  cityHistory: [],
  savedEventIds: [],
  interactionCount: 0,
  vibeSetup: false,
  lastSeen: Date.now(),
}

export function getProfile(): LocalProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return { ...DEFAULT_PROFILE }
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

function saveProfile(profile: LocalProfile): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // storage full or unavailable -- silently skip
  }
}

export function trackCategoryClick(category: string): void {
  const profile = getProfile()
  profile.categoryScores[category] = (profile.categoryScores[category] ?? 0) + 1
  profile.interactionCount += 1
  profile.lastSeen = Date.now()
  saveProfile(profile)
}

export function trackCitySearch(city: string): void {
  const profile = getProfile()
  profile.cityHistory = [city, ...profile.cityHistory.filter(c => c !== city)].slice(0, 10)
  profile.interactionCount += 1
  profile.lastSeen = Date.now()
  saveProfile(profile)
}

export function trackEventView(eventId: string, category: string, groups: string[]): void {
  const profile = getProfile()
  profile.categoryScores[category] = (profile.categoryScores[category] ?? 0) + 0.5
  groups.forEach(g => {
    profile.groupScores[g] = (profile.groupScores[g] ?? 0) + 0.5
  })
  profile.interactionCount += 1
  profile.lastSeen = Date.now()
  saveProfile(profile)
}

export function saveEvent(eventId: string, category: string, groups: string[]): void {
  const profile = getProfile()
  if (!profile.savedEventIds.includes(eventId)) {
    profile.savedEventIds = [eventId, ...profile.savedEventIds]
  }
  // Saving is a strong signal -- weight it 3x
  profile.categoryScores[category] = (profile.categoryScores[category] ?? 0) + 3
  groups.forEach(g => {
    profile.groupScores[g] = (profile.groupScores[g] ?? 0) + 3
  })
  profile.interactionCount += 1
  profile.lastSeen = Date.now()
  saveProfile(profile)
}

export function unsaveEvent(eventId: string): void {
  const profile = getProfile()
  profile.savedEventIds = profile.savedEventIds.filter(id => id !== eventId)
  saveProfile(profile)
}

export function isEventSaved(eventId: string): boolean {
  const profile = getProfile()
  return profile.savedEventIds.includes(eventId)
}

export function getSavedEventIds(): string[] {
  return getProfile().savedEventIds
}

export function markVibeSetup(): void {
  const profile = getProfile()
  profile.vibeSetup = true
  saveProfile(profile)
}

/** Derive top interests from accumulated scores */
export function deriveVibe(): VibeData {
  const profile = getProfile()

  const topCategories = Object.entries(profile.categoryScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat as EventCategory)

  const topGroups = Object.entries(profile.groupScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g as GroupType)

  const preferredCity = profile.cityHistory[0] ?? ''

  return { topCategories, topGroups, preferredCity }
}

/**
 * Should we show the vibe/account prompt?
 * Trigger when the user has shown meaningful engagement but hasn't set up a vibe yet.
 */
export function shouldPromptVibe(): boolean {
  const profile = getProfile()
  if (profile.vibeSetup) return false
  // Trigger after: 2+ saves, OR 3+ category interactions, OR 5+ total interactions
  const saveCount = profile.savedEventIds.length
  const categoryInteractions = Object.values(profile.categoryScores).reduce((a, b) => a + b, 0)
  return saveCount >= 2 || categoryInteractions >= 3 || profile.interactionCount >= 5
}

/** Wipe everything -- the "Fresh Slate" action */
export function wipeHistory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PROFILE_KEY)
}
