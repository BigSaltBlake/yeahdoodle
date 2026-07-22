'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense } from 'react'
import FilterSidebar from '@/components/FilterSidebar'
import EventCard from '@/components/EventCard'
import EventModal from '@/components/EventModal'
import VibeModal from '@/components/VibeModal'
import { trackCitySearch, shouldPromptVibe, getVibePreferences, getProfile } from '@/lib/history'
import type { YDEvent, EventCategory, GroupType, AgeGroup, WhenFilter } from '@/types'

const RADIUS_OPTIONS = [1, 2, 5, 10, 25]

function DiscoverContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // City state
  const [cityInput, setCityInput] = useState(searchParams.get('city') ?? '')
  const [activeCity, setActiveCity] = useState(searchParams.get('city') ?? '')
  const [locating, setLocating] = useState(false)

  // GPS state
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)
  const [radius, setRadius] = useState(5) // miles

  // Filter state
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [groups, setGroups] = useState<GroupType[]>([])
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([])
  const [when, setWhen] = useState<WhenFilter>('')

  // Data + UI state
  const [events, setEvents] = useState<YDEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [modalEvent, setModalEvent] = useState<YDEvent | null>(null)
  const [vibeOpen, setVibeOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const fetchRef = useRef(0)
  const vibePromptedRef = useRef(false)

  useEffect(() => {
    if (!searchParams.get('city') && typeof navigator !== 'undefined' && navigator.geolocation) {
      handleLocate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const { categories: vibeCats, group: vibeGroup } = getVibePreferences()
    if (vibeCats.length > 0 && categories.length === 0) setCategories(vibeCats)
    if (vibeGroup && groups.length === 0) setGroups([vibeGroup])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (events.length > 0 && !vibePromptedRef.current && !getProfile().vibeSetup) {
      vibePromptedRef.current = true
      const timer = setTimeout(() => setVibeOpen(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [events.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLocate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      )
      const { latitude, longitude } = pos.coords
      setUserLat(latitude)
      setUserLng(longitude)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          { headers: { 'User-Agent': 'YeahDoodle/1.0' } }
        )
        const data = await res.json()
        const city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || ''
        if (city) {
          setCityInput(city)
          setActiveCity(city)
          trackCitySearch(city)
          router.replace(`/discover?city=${encodeURIComponent(city)}`, { scroll: false })
        }
      } catch { /* reverse geocode failed — GPS coords still set */ }
    } catch { /* user denied */ } finally {
      setLocating(false)
    }
  }
  const fetchEvents = useCallback(async (
    city: string, cats: EventCategory[], grps: GroupType[],
    ages: AgeGroup[], whn: WhenFilter, pg: number,
    lat?: number | null, lng?: number | null, rad?: number,
  ) => {
    if (!city.trim() && lat == null) return
    const fetchId = ++fetchRef.current
    setLoading(true); setError(null)

    const url = new URL('/api/events', window.location.origin)
    if (city.trim()) url.searchParams.set('city', city)
    if (lat != null && lng != null) {
      url.searchParams.set('lat', String(lat))
      url.searchParams.set('lng', String(lng))
      url.searchParams.set('radius', String(rad ?? 5))
    }
    url.searchParams.set('page', String(pg))
    if (whn) url.searchParams.set('when', whn)
    cats.forEach(c => url.searchParams.append('category', c))
    grps.forEach(g => url.searchParams.append('group', g))
    ages.forEach(a => url.searchParams.append('age', a))

    try {
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load events')
      const data = await res.json()
      if (fetchId !== fetchRef.current) return
      setEvents(pg === 0 ? data.events : prev => [...prev, ...data.events])
      setTotal(data.total ?? 0)
    } catch {
      if (fetchId === fetchRef.current) setError("Couldn't load events. Check your connection.")
    } finally {
      if (fetchId === fetchRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    fetchEvents(activeCity, categories, groups, ageGroups, when, 0, userLat, userLng, radius)
  }, [activeCity, categories, groups, ageGroups, when, userLat, userLng, radius, fetchEvents])

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const c = cityInput.trim()
    if (!c || c === activeCity) return
    setUserLat(null); setUserLng(null)
    trackCitySearch(c); setActiveCity(c); setPage(0)
    router.replace(`/discover?city=${encodeURIComponent(c)}`, { scroll: false })
    if (shouldPromptVibe()) setVibeOpen(true)
  }

  function handleVibePrompt() { if (shouldPromptVibe()) setVibeOpen(true) }

  function handleLoadMore() {
    const next = page + 1; setPage(next)
    fetchEvents(activeCity, categories, groups, ageGroups, when, next, userLat, userLng, radius)
  }

  function handleReset() { setCategories([]); setGroups([]); setAgeGroups([]); setWhen('') }

  const hasMore = events.length < total && !loading
  const gpsActive = userLat != null && userLng != null
  const pageTitle = activeCity
    ? gpsActive ? `Events near ${activeCity} · ${radius}mi` : `Events in ${activeCity}`
    : gpsActive ? `Events near you · ${radius}mi` : 'Discover Events'

  return (
    <>
      <EventModal event={modalEvent} onClose={() => setModalEvent(null)} onVibePrompt={handleVibePrompt} />
      <VibeModal open={vibeOpen} onClose={() => setVibeOpen(false)} />

      <div className="bg-yd-navy border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-white">{pageTitle}</h1>
              {total > 0 && <p className="text-sm text-white/40 mt-0.5">{total.toLocaleString()} events found</p>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative">
                  <button type="button" onClick={handleLocate} disabled={locating} title="Use my location"
                    className={`absolute left-2 top-1/2 -translate-y-1/2 disabled:opacity-50 transition-colors text-sm px-1 py-1 ${gpsActive ? 'text-yd-orange' : 'text-white/40 hover:text-yd-orange'}`}>
                    {locating ? '⏳' : '📍'}
                  </button>
                  <input value={cityInput} onChange={e => setCityInput(e.target.value)}
                    placeholder={locating ? 'Detecting...' : 'City...'}
                    className="pl-8 pr-4 py-2.5 bg-yd-card border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-yd-orange transition-colors w-44" />
                </div>
                <button type="submit" className="bg-yd-orange hover:bg-yd-orangeHover text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">Go</button>
              </form>
              {gpsActive && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-white/30">Radius:</span>
                  {[1, 2, 5, 10, 25].map(r => (
                    <button key={r} type="button" onClick={() => setRadius(r)}
                      className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${radius === r ? 'bg-yd-orange text-white font-semibold' : 'bg-yd-card border border-white/10 text-white/40 hover:text-white/70'}`}>
                      {r}mi
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <button className="sm:hidden mb-4 flex items-center gap-2 text-sm text-white/60 hover:text-white border border-white/10 rounded-xl px-4 py-2.5 transition-colors"
          onClick={() => setSidebarOpen(!sidebarOpen)}>
          <span>⚙️</span> Filters
          {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
            <span className="bg-yd-orange text-white text-xs rounded-full w-5 h-5 flex items-center justify-center ml-1">
              {categories.length + groups.length + ageGroups.length + (when ? 1 : 0)}
            </span>
          )}
        </button>
        <div className="flex gap-8">
          <div className={`${sidebarOpen ? 'block' : 'hidden'} sm:block`}>
            {getProfile().vibeSetup && getVibePreferences().categories.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-white/40 mb-3 bg-yd-orange/5 border border-yd-orange/15 rounded-lg px-3 py-2">
                <span>✨</span><span className="text-white/50">Personalized for you</span>
                <button onClick={() => setVibeOpen(true)} className="ml-auto text-yd-orange hover:underline">Edit vibe</button>
              </div>
            )}
            <FilterSidebar categories={categories} groups={groups} ageGroups={ageGroups} when={when}
              onCategories={setCategories} onGroups={setGroups} onAgeGroups={setAgeGroups} onWhen={setWhen} onReset={handleReset} />
          </div>
          <div className="flex-1 min-w-0">
            {!activeCity && !gpsActive && (
              <div className="text-center py-20">
                {locating ? (
                  <><div className="text-5xl mb-4 animate-pulse">📍</div>
                  <h2 className="font-display text-xl text-white mb-2">Finding your location…</h2>
                  <p className="text-white/50 text-sm">Allow location access to see events near you.</p></>
                ) : (
                  <><div className="text-5xl mb-4">🗺️</div>
                  <h2 className="font-display text-xl text-white mb-2">What&apos;s happening near you?</h2>
                  <p className="text-white/50 text-sm mb-6">Allow location access or search a city to find events.</p>
                  <button onClick={handleLocate} className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-flex items-center gap-2 mb-4">
                    📍 Use my location
                  </button>
                  <p className="text-white/30 text-xs">or type a city in the search box above</p></>
                )}
              </div>
            )}
            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm mb-6">{error}</div>}
            {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {when && <span className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                  {when === 'today' ? 'Today' : when === 'weekend' ? 'This Weekend' : 'This Week'}
                  <button onClick={() => setWhen('')} className="ml-0.5 hover:text-white">×</button>
                </span>}
                {categories.map(c => <span key={c} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                  {c}<button onClick={() => setCategories(categories.filter(x => x !== c))} className="ml-0.5 hover:text-white">×</button>
                </span>)}
                {groups.map(g => <span key={g} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                  {g.replace('-', ' ')}<button onClick={() => setGroups(groups.filter(x => x !== g))} className="ml-0.5 hover:text-white">×</button>
                </span>)}
                {ageGroups.map(a => <span key={a} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                  {a.replace('-', ' ')}<button onClick={() => setAgeGroups(ageGroups.filter(x => x !== a))} className="ml-0.5 hover:text-white">×</button>
                </span>)}
              </div>
            )}
            {loading && events.length === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-yd-card rounded-xl overflow-hidden animate-pulse">
                    <div className="h-44 bg-yd-card2" />
                    <div className="p-4 space-y-2"><div className="h-4 bg-yd-card2 rounded w-3/4" /><div className="h-3 bg-yd-card2 rounded w-1/2" /><div className="h-3 bg-yd-card2 rounded w-1/3" /></div>
                  </div>
                ))}
              </div>
            )}
            {events.length > 0 && (
              <>
                {gpsActive && <p className="text-xs text-white/30 mb-4 flex items-center gap-1.5"><span className="text-yd-orange">📍</span>Showing events within {radius} mile{radius !== 1 ? 's' : ''} of your location</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {events.map(event => <EventCard key={event.id} event={event} onOpenDetail={setModalEvent} onVibePrompt={handleVibePrompt} />)}
                </div>
                {hasMore && (
                  <div className="text-center mt-8">
                    <button onClick={handleLoadMore} disabled={loading}
                      className="bg-yd-card border border-white/10 hover:border-white/20 text-white/70 hover:text-white text-sm px-8 py-3 rounded-xl transition-colors disabled:opacity-50">
                      {loading ? 'Loading...' : 'Load more events'}
                    </button>
                  </div>
                )}
              </>
            )}
            {!loading && (activeCity || gpsActive) && events.length === 0 && !error && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">🎭</div>
                <h2 className="font-display text-xl text-white mb-2">
                  {gpsActive ? `Nothing found within ${radius} miles` : `Nothing turned up for ${activeCity}`}
                </h2>
                <p className="text-white/50 text-sm mb-4">
                  {gpsActive ? 'Try increasing the radius, or check back as we add more events daily.'
                    : (categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0
                      ? 'Try removing some filters, or check back as we add more events daily.'
                      : "We may not have synced this city yet — check back soon, or try a nearby major city."}
                </p>
                {gpsActive ? (
                  <div className="flex flex-wrap justify-center gap-2 mb-4">
                    {[2, 5, 10, 25].filter(r => r > radius).slice(0, 3).map(r => (
                      <button key={r} onClick={() => setRadius(r)} className="text-xs bg-yd-card border border-white/10 hover:border-yd-orange/40 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors">Try {r}mi</button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2 mb-6">
                    {['New York', 'Los Angeles', 'Chicago', 'Austin', 'Nashville', 'Denver'].map(c => (
                      <button key={c} onClick={() => { setUserLat(null); setUserLng(null); setCityInput(c); setActiveCity(c); trackCitySearch(c); router.replace(`/discover?city=${encodeURIComponent(c)}`, { scroll: false }) }}
                        className="text-xs bg-yd-card border border-white/10 hover:border-yd-orange/40 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors">{c}</button>
                    ))}
                  </div>
                )}
                {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
                  <button onClick={handleReset} className="text-yd-orange hover:underline text-sm font-medium">Clear all filters</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-32 text-white/40 text-sm">Loading...</div>}>
      <DiscoverContent />
    </Suspense>
  )
}
