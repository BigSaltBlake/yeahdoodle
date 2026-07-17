'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getProfile, trackCitySearch, shouldPromptVibe } from '@/lib/history'
import VibeModal from '@/components/VibeModal'

const POPULAR_CITIES = ['Austin', 'Nashville', 'Denver', 'Chicago', 'New Orleans', 'Portland', 'Miami', 'Seattle']

const VIBES = [
  { icon: '🎸', label: 'Live music you can feel in your chest' },
  { icon: '🌮', label: 'Hidden gems the locals actually go to' },
  { icon: '🎨', label: 'Art, theatre, and things to talk about after' },
  { icon: '🏆', label: 'Sports, outdoor adventures, and real action' },
]

export default function HomePage() {
  const router = useRouter()
  const [city, setCity] = useState('')
  const [recentCities, setRecentCities] = useState<string[]>([])
  const [vibeOpen, setVibeOpen] = useState(false)
  const [locating, setLocating] = useState(false)

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
      const detected =
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.county ||
        ''
      if (detected) {
        trackCitySearch(detected)
        router.push(`/discover?city=${encodeURIComponent(detected)}`)
      }
    } catch {
      // User denied or timed out — silently fall back
    } finally {
      setLocating(false)
    }
  }

  useEffect(() => {
    const profile = getProfile()
    setRecentCities(profile.cityHistory.slice(0, 4))
    // Show vibe prompt on return visits if they have history
    if (profile.interactionCount > 0 && shouldPromptVibe()) {
      setTimeout(() => setVibeOpen(true), 2000)
    }
  }, [])

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    const c = city.trim()
    if (!c) return
    trackCitySearch(c)
    router.push(`/discover?city=${encodeURIComponent(c)}`)
  }

  function handleCityClick(c: string) {
    trackCitySearch(c)
    router.push(`/discover?city=${encodeURIComponent(c)}`)
  }

  const suggestedCities = recentCities.length > 0
    ? recentCities
    : POPULAR_CITIES.slice(0, 5)

  return (
    <>
      <VibeModal open={vibeOpen} onClose={() => setVibeOpen(false)} />

      {/* Hero */}
      <section className="relative bg-yd-orange overflow-hidden">
        {/* Dot pattern */}
        <div className="absolute inset-0 dot-pattern opacity-40 pointer-events-none" />

        {/* Decorative circles */}
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-black/10 pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-4 py-16 sm:py-24 text-center">
          <div className="inline-block bg-white/15 text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-5 backdrop-blur-sm">
            🔥 Discover events happening right now
          </div>

          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl text-white leading-none mb-4">
            Find Your<br />Next Adventure
          </h1>

          <p className="text-white/80 text-lg sm:text-xl mb-10 max-w-xl mx-auto leading-relaxed">
            Real local events. Hidden gems. Picks that actually match your vibe.
          </p>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl mx-auto">
            <div className="flex-1 relative">
              <button
                type="button"
                onClick={handleLocate}
                disabled={locating}
                title="Use my location"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-yd-orange hover:text-yd-orangeHover disabled:opacity-50 transition-colors px-1"
              >
                {locating ? '⏳' : '📍'}
              </button>
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder={locating ? 'Detecting your location...' : 'Enter a city...'}
                className="w-full pl-10 pr-4 py-4 rounded-xl bg-white text-yd-navy placeholder-yd-navy/40 font-medium text-base focus:outline-none focus:ring-2 focus:ring-white/50"
              />
            </div>
            <button
              type="submit"
              className="bg-yd-bg hover:bg-yd-navy text-white px-6 py-4 rounded-xl font-semibold text-base transition-colors shrink-0"
            >
              Search
            </button>
          </form>

          {/* City chips */}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            <span className="text-white/60 text-sm self-center">
              {recentCities.length > 0 ? 'Recent:' : 'Popular:'}
            </span>
            {suggestedCities.map(c => (
              <button
                key={c}
                onClick={() => handleCityClick(c)}
                className="bg-white/15 hover:bg-white/25 text-white text-sm px-3.5 py-1.5 rounded-full transition-colors border border-white/20 backdrop-blur-sm"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* What you'll find */}
      <section className="max-w-7xl mx-auto px-4 py-14">
        <h2 className="font-display text-2xl text-white text-center mb-8">What&apos;s waiting for you</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {VIBES.map(v => (
            <div
              key={v.label}
              className="bg-yd-card border border-white/5 rounded-xl p-5 text-center hover:border-yd-orange/30 transition-colors group cursor-pointer"
            >
              <div className="text-3xl mb-3">{v.icon}</div>
              <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors leading-snug">{v.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Vibe teaser — prompts account/survey if no vibe set yet */}
      <section className="max-w-7xl mx-auto px-4 pb-14">
        <div className="relative bg-yd-card rounded-2xl p-8 sm:p-10 flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden border border-white/5">
          {/* Background glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-yd-orange/10 to-transparent pointer-events-none" />
          <div className="relative">
            <h3 className="font-display text-2xl text-white mb-2">Unlock your personalized picks</h3>
            <p className="text-white/50 text-sm max-w-sm leading-relaxed">
              Tell us your scene and we&apos;ll surface events that actually fit — not just whatever&apos;s popular.
            </p>
          </div>
          <button
            onClick={() => setVibeOpen(true)}
            className="relative shrink-0 bg-yd-yellow hover:bg-yd-yellowHover text-yd-bg font-bold px-6 py-3.5 rounded-xl transition-colors text-sm"
          >
            Set Your Vibe →
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-yd-navy py-14">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="font-display text-2xl text-white text-center mb-10">How YeahDoodle works</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { step: '01', title: 'Search your city', body: 'Type any city and see what\'s happening — from tonight to next week.' },
              { step: '02', title: 'Filter your vibe', body: 'Narrow by category, who you\'re going with, age groups, and when.' },
              { step: '03', title: 'Go do the thing', body: 'Save events you love, share with your crew, and show up.' },
            ].map(item => (
              <div key={item.step} className="flex gap-4">
                <span className="font-display text-4xl text-yd-orange/30 leading-none shrink-0">{item.step}</span>
                <div>
                  <h4 className="font-semibold text-white mb-1">{item.title}</h4>
                  <p className="text-sm text-white/50 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
