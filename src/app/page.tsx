'use client'

import { useState, FormEvent } from 'react'
import MoodSurvey from '@/components/MoodSurvey'

export default function HomePage() {
  const [surveyOpen, setSurveyOpen] = useState(false)
  const [locModalOpen, setLocModalOpen] = useState(false)
  const [locInput,     setLocInput]     = useState('')
  const [gpsLoading,   setGpsLoading]   = useState(false)

  const handleGps = () => {
    if (!navigator.geolocation) return
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
          .then(r => r.json())
          .then(d => {
            const loc = d.address?.city || d.address?.town || d.address?.village || d.address?.county || d.display_name || ''
            setGpsLoading(false)
            setLocModalOpen(false)
            window.dispatchEvent(new CustomEvent('wb-open-with-city', { detail: { city: loc } }))
          })
          .catch(() => setGpsLoading(false))
      },
      () => setGpsLoading(false)
    )
  }

  const handleLocSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!locInput.trim()) return
    const loc = locInput.trim()
    setLocModalOpen(false)
    setLocInput('')
    window.dispatchEvent(new CustomEvent('wb-open-with-city', { detail: { city: loc } }))
  }

  return (
    <>
      {locModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setLocModalOpen(false)}
        >
          <div
            className="relative bg-white rounded-3xl shadow-2xl p-8 mx-4 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setLocModalOpen(false)}
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 text-2xl leading-none"
            >
              ✕
            </button>
            <h2 className="text-2xl font-black text-stone-900 mb-1 text-center">Let&apos;s Find Your Next Adventure</h2>
            <p className="text-sm text-stone-500 text-center mb-6">Where should Wild Bill scout for you?</p>
            <div className="flex flex-col gap-4">
              <button
                onClick={handleGps}
                disabled={gpsLoading}
                className="w-full rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold py-3 px-6 transition-all disabled:opacity-60 text-base"
              >
                {gpsLoading ? 'Locating…' : '📍 Use My Current Location'}
              </button>
              <div className="flex items-center gap-3">
                <hr className="flex-1 border-stone-200" />
                <span className="text-sm text-stone-400">or type a location</span>
                <hr className="flex-1 border-stone-200" />
              </div>
              <form onSubmit={handleLocSubmit} className="flex gap-2">
                <input
                  className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="City, zip, state, or country…"
                  value={locInput}
                  onChange={e => setLocInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-2xl bg-stone-900 hover:bg-stone-700 active:scale-95 text-white px-5 py-3 text-base font-bold transition-all"
                >
                  Go →
                </button>
              </form>
              <p className="text-xs text-stone-400 text-center">Try a zip, city, state, or even a whole country — Wild Bill will find something amazing.</p>
            </div>
          </div>
        </div>
      )}
            <MoodSurvey
        open={surveyOpen}
        onClose={() => setSurveyOpen(false)}
      />

      {/* ââ Hero ââ */}
      <section className="relative min-h-screen flex items-center justify-center bg-yd-bg overflow-hidden">
        {/* Layered background atmosphere */}
        <div className="absolute inset-0 bg-gradient-to-br from-yd-orange/15 via-transparent to-yd-navy/50 pointer-events-none" />
        <div className="absolute inset-0 dot-pattern opacity-15 pointer-events-none" />
        {/* Warm radial glow behind content */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-yd-orange/6 blur-[120px] pointer-events-none" />
        {/* Accent orbs */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-white/[0.018] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-yd-orange/5 translate-y-1/3 -translate-x-1/4 pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 text-center">

          {/* Pulse badge */}
          <div className="inline-flex items-center gap-2 bg-yd-orange/12 text-yd-orange text-xs font-semibold px-4 py-2 rounded-full mb-8 tracking-widest uppercase border border-yd-orange/25 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-yd-orange animate-pulse shrink-0" />
            Stop scrolling. Go live.
          </div>

          {/* Headline */}
          <h1 className="font-display text-6xl sm:text-7xl lg:text-8xl text-white leading-[0.92] mb-6 tracking-tight">
            Life&apos;s Happening<br />
            <span className="text-yd-orange">Out There.</span> Live It!
          </h1>

          {/* Subhead */}
          <p className="text-white/50 text-xl sm:text-2xl mb-10 max-w-sm mx-auto leading-relaxed font-light">
            Want three perfect picks near you, right now?
          </p>

          {/* Single CTA */}
          <button
            onClick={() => setLocModalOpen(true)}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('wb-yeahdoodle'))}
            className="group inline-flex items-center gap-3 bg-yd-orange hover:bg-yd-orangeHover text-white font-bold px-10 py-5 rounded-2xl text-lg transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            style={{ boxShadow: '0 0 50px rgba(255, 100, 0, 0.28)' }}
          >
            Yeah Doodle!
            <span className="group-hover:translate-x-1.5 transition-transform duration-200 text-xl">â</span>
          </button>

          {/* Reassurance */}
          <p className="text-white/20 text-sm mt-6 tracking-wide">
            ð Auto-detects your location
          </p>
        </div>

        {/* Scroll nudge */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 select-none pointer-events-none">
          <div className="w-px h-8 bg-gradient-to-b from-white/0 to-white/25" />
          <div className="w-1 h-1 rounded-full bg-white/25" />
        </div>
      </section>

      {/* ââ How it works ââ */}
      <section className="bg-yd-navy py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="font-display text-2xl text-white text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: '2 quick questions',
                body: 'How do you want to feel? What would kill the vibe? Takes 10 seconds â we handle the rest.',
              },
              {
                step: '02',
                title: 'AI finds your top 3',
                body: 'We scan local events and surface the 3 that actually match where you\'re at right now.',
              },
              {
                step: '03',
                title: 'Put the phone down.',
                body: 'Get the venue, time, and ticket link. Then go do the thing.',
              },
            ].map(item => (
              <div key={item.step} className="flex gap-4">
                <span className="font-display text-4xl text-yd-orange/30 leading-none shrink-0 select-none">{item.step}</span>
                <div>
                  <h4 className="font-semibold text-white mb-1.5">{item.title}</h4>
                  <p className="text-sm text-white/45 leading-relaxed">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ââ What you\'ll find ââ */}
      <section className="max-w-5xl mx-auto px-4 py-14">
        <h2 className="font-display text-2xl text-white text-center mb-8">What&apos;s waiting for you</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: 'ð¸', label: 'Live music you can feel in your chest' },
            { icon: 'ð®', label: 'Hidden gems the locals actually go to' },
            { icon: 'ð¨', label: 'Art, theatre, and things to talk about after' },
            { icon: 'ð', label: 'Sports, outdoor adventures, and real action' },
          ].map(v => (
            <button
              key={v.label}
              onClick={() => setSurveyOpen(true)}
              className="bg-yd-card border border-white/5 rounded-xl p-5 text-center hover:border-yd-orange/30 transition-all group cursor-pointer"
            >
              <div className="text-3xl mb-3">{v.icon}</div>
              <p className="text-sm text-white/55 group-hover:text-white/80 transition-colors leading-snug">{v.label}</p>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
