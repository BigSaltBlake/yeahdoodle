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

function DiscoverContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // City state
  const [cityInput, setCityInput] = useState(searchParams.get('city') ?? '')
  const [activeCity, setActiveCity] = useState(searchParams.get('city') ?? '')
  const [locating, setLocating] = useState(false)

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
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile

  const fetchRef = useRef(0)
  const vibePromptedRef = useRef(false) // show vibe modal once on first successful load

  // Auto-detect location on first load if no city in URL
  useEffect(() => {
    if (!searchParams.get('city') && typeof navigator !== 'undefined' && navigator.geolocation) {
      handleLocate()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-populate filters from survey vibe on first load (only if no filters already active)
  useEffect(() => {
    const { categories: vibeCats, group: vibeGroup } = getVibePreferences()
    if (vibeCats.length > 0 && categories.length === 0) {
      setCategories(vibeCats)
    }
    if (vibeGroup && groups.length === 0) {
      setGroups([vibeGroup])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Show vibe modal 2s after first successful event load for brand-new users
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
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'YeahDoodle/1.0' } }
      )
      const data = await res.json()
      const city =
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.county ||
        ''
      if (city) {
        setCityInput(city)
        setActiveCity(city)
        trackCitySearch(city)
        router.replace(`/discover?city=${encodeURIComponent(city)}`, { scroll: false })
      }
    } catch {
      // User denied or timed out — silently fall back to manual search
    } finally {
      setLocating(false)
    }
  }

  const fetchEvents = useCallback(async (
    city: string, cats: EventCategory[], grps: GroupType[],
    ages: AgeGroup[], whn: WhenFilter, pg: number
  ) => {
    if (!city.trim()) return
    const fetchId = ++fetchRef.current
    setLoading(true)
    setError(null)

    const url = new URL('/api/events', window.location.origin)
    url.searchParams.set('city', city)
    url.searchParams.set('page', String(pg))
    if (whn) url.searchParams.set('when', whn)
    cats.forEach(c => url.searchParams.append('category', c))
    grps.forEach(g => url.searchParams.append('group', g))
    ages.forEach(a => url.searchParams.append('age', a))

    try {
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load events')
      const data = await res.json()
      if (fetchId !== fetchRef.current) return // stale
      setEvents(pg === 0 ? data.events : prev => [...prev, ...data.events])
      setTotal(data.total ?? 0)
    } catch {
      if (fetchId === fetchRef.current) setError('Couldn\'t load events. Check your connection.')
    } finally {
      if (fetchId === fetchRef.current) setLoading(false)
    }
  }, [])

  // Fetch on filter/city change
  useEffect(() => {
    setPage(0)
    fetchEvents(activeCity, categories, groups, ageGroups, when, 0)
  }, [activeCity, categories, groups, ageGroups, when, fetchEvents])

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const c = cityInput.trim()
    if (!c || c === activeCity) return
    trackCitySearch(c)
    setActiveCity(c)
    setPage(0)
    router.replace(`/discover?city=${encodeURIComponent(c)}`, { scroll: false })
    if (shouldPromptVibe()) setVibeOpen(true)
  }

  function handleVibePrompt() {
    if (shouldPromptVibe()) setVibeOpen(true)
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchEvents(activeCity, categories, groups, ageGroups, when, next)
  }

  function handleReset() {
    setCategories([])
    setGroups([])
    setAgeGroups([])
    setWhen('')
  }

  const hasMore = events.length < total && !loading

  return (
    <>
      <EventModal event={modalEvent} onClose={() => setModalEvent(null)} onVibePrompt={handleVibePrompt} />
      <VibeModal open={vibeOpen} onClose={() => setVibeOpen(false)} />

      {/* Page header */}
      <div className="bg-yd-navy border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-white">
                {activeCity ? `Events in ${activeCity}` : 'Discover Events'}
              </h1>
              {total > 0 && (
                <p className="text-sm text-white/40 mt-0.5">
                  {total.toLocaleString()} events found
                </p>
              )}
            </div>

            {/* City search */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={handleLocate}
                  disabled={locating}
                  title="Use my location"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-yd-orange disabled:opacity-50 transition-colors text-sm px-1 py-1"
                >
                  {locating ? '\u23F3' : '\uD83D\uDCCD'}
                </button>
                <input
                  value={cityInput}
                  onChange={e => setCityInput(e.target.value)}
                  placeholder={locating ? 'Detecting...' : 'City...'}
                  className="pl-8 pr-4 py-2.5 bg-yd-card border border-white/10 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-yd-orange transition-colors w-44"
                />
              </div>
              <button
                type="submit"
                className="bg-yd-orange hover:bg-yd-orangeHover text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                Go
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Mobile filter toggle */}
        <button
          className="sm:hidden mb-4 flex items-center gap-2 text-sm text-white/60 hover:text-white border border-white/10 rounded-xl px-4 py-2.5 transition-colors"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <span>\u2699\uFE0F</span>
          Filters
          {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
            <span className="bg-yd-orange text-white text-xs rounded-full w-5 h-5 flex items-center justify-center ml-1">
              {categories.length + groups.length + ageGroups.length + (when ? 1 : 0)}
            </span>
          )}
        </button>

        <div className="flex gap-8">
          {/* Sidebar */}
          <div className={`${sidebarOpen ? 'block' : 'hidden'} sm:block`}>
            {/* Personalized indicator */}
            {getProfile().vibeSetup && getVibePreferences().categories.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-white/40 mb-3 bg-yd-orange/5 border border-yd-orange/15 rounded-lg px-3 py-2">
                <span>\u2728</span>
                <span className="text-white/50">Personalized for you</span>
                <button
                  onClick={() => setVibeOpen(true)}
                  className="ml-auto text-yd-orange hover:underline"
                >
                  Edit vibe
                </button>
              </div>
            )}
            <FilterSidebar
              categories={categories}
              groups={groups}
              ageGroups={ageGroups}
              when={when}
              onCategories={setCategories}
              onGroups={setGroups}
              onAgeGroups={setAgeGroups}
              onWhen={setWhen}
              onReset={handleReset}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* No city prompt */}
            {!activeCity && (
              <div className="text-center py-20">
                {locating ? (
                  <>
                    <div className="text-5xl mb-4 animate-pulse">\uD83D\uDCCD</div>
                    <h2 className="font-display text-xl text-white mb-2">Finding your location\u2026</h2>
                    <p className="text-white/50 text-sm">Allow location access to see events near you.</p>
                  </>
                ) : (
                  <>
                    <div className="text-5xl mb-4">\uD83D\uDDFA\uFE0F</div>
                    <h2 className="font-display text-xl text-white mb-2">What&apos;s happening near you?</h2>
                    <p className="text-white/50 text-sm mb-6">Allow location access or search a city to find events.</p>
                    <button
                      onClick={handleLocate}
                      className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-flex items-center gap-2 mb-4"
                    >
                      \uD83D\uDCCD Use my location
                    </button>
                    <p className="text-white/30 text-xs">or type a city in the search box above</p>
                  </>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm mb-6">
                {error}
              </div>
            )}

            {/* Active filter chips */}
            {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {when && (
                  <span className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                    {when === 'today' ? 'Today' : when === 'weekend' ? 'This Weekend' : 'This Week'}
                    <button onClick={() => setWhen('')} className="ml-0.5 hover:text-white">\u00D7</button>
                  </span>
                )}
                {categories.map(c => (
                  <span key={c} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                    {c}
                    <button onClick={() => setCategories(categories.filter(x => x !== c))} className="ml-0.5 hover:text-white">\u00D7</button>
                  </span>
                ))}
                {groups.map(g => (
                  <span key={g} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                    {g.replace('-', ' ')}
                    <button onClick={() => setGroups(groups.filter(x => x !== g))} className="ml-0.5 hover:text-white">\u00D7</button>
                  </span>
                ))}
                {ageGroups.map(a => (
                  <span key={a} className="flex items-center gap-1.5 bg-yd-orange/15 text-yd-orange text-xs px-3 py-1.5 rounded-full border border-yd-orange/30">
                    {a.replace('-', ' ')}
                    <button onClick={() => setAgeGroups(ageGroups.filter(x => x !== a))} className="ml-0.5 hover:text-white">\u00D7</button>
                  </span>
                ))}
              </div>
            )}

            {/* Loading skeleton */}
            {loading && events.length === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-yd-card rounded-xl overflow-hidden animate-pulse">
                    <div className="h-44 bg-yd-card2" />
                    <div className="p-4 space-y-2">
                      <div className="h-4 bg-yd-card2 rounded w-3/4" />
                      <div className="h-3 bg-yd-card2 rounded w-1/2" />
                      <div className="h-3 bg-yd-card2 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Events grid */}
            {events.length > 0 && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {events.map(event => (
                    <EventCard
                      key={event.id}
                      event={event}
                      onOpenDetail={setModalEvent}
                      onVibePrompt={handleVibePrompt}
                    />
                  ))}
                </div>

                {/* Load more */}
                {hasMore && (
                  <div className="text-center mt-8">
                    <button
                      onClick={handleLoadMore}
                      disabled={loading}
                      className="bg-yd-card border border-white/10 hover:border-white/20 text-white/70 hover:text-white text-sm px-8 py-3 rounded-xl transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Loading...' : `Load more events`}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* No results */}
            {!loading && activeCity && events.length === 0 && !error && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">\uD83C\uDFAD</div>
                <h2 className="font-display text-xl text-white mb-2">Nothing turned up for {activeCity}</h2>
                <p className="text-white/50 text-sm mb-4">
                  {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0
                    ? 'Try removing some filters, or check back as we add more events daily.'
                    : "We may not have synced this city yet \u2014 check back soon, or try a nearby major city."}
                </p>
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  {['New York', 'Los Angeles', 'Chicago', 'Austin', 'Nashville', 'Denver'].map(c => (
                    <button
                      key={c}
                      onClick={() => { setCityInput(c); setActiveCity(c); trackCitySearch(c); router.replace(`/discover?city=${encodeURIComponent(c)}`, { scroll: false }) }}
                      className="text-xs bg-yd-card border border-white/10 hover:border-yd-orange/40 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {(categories.length + groups.length + ageGroups.length + (when ? 1 : 0)) > 0 && (
                  <button onClick={handleReset} className="text-yd-orange hover:underline text-sm font-medium">
                    Clear all filters
                  </button>
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
    <Suspense fallback={
      <div className="flex items-center justify-center py-32 text-white/40 text-sm">
        Loading...
      </div>
    }>
      <DiscoverContent />
    </Suspense>
  )
}
