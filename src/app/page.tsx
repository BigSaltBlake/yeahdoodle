'use client'

import { useState, useEffect, useCallback } from 'react'
import MoodSurvey from '@/components/MoodSurvey'

type SlideMode =
  | 'date-night' | 'first-date' | 'couple'
  | 'fomo' | 'tonight' | 'weekend' | 'general'
  | 'bored' | 'local' | 'music' | 'foodie'
  | 'outdoor' | 'group' | 'spontaneous' | 'legendary'

interface Slide {
  id: SlideMode
  badge: string
  headline: string
  emphasis: string
  post?: string
  subhead: string
}

const SLIDES: Slide[] = [
  {
    id: 'date-night',
    badge: 'Date Night Scout',
    headline: 'The Perfect',
    emphasis: 'Date Night.',
    post: ' Tonight.',
    subhead: '5 questions. 3 hand-picked date night spots near you.',
  },
  {
    id: 'first-date',
    badge: 'First Date Scout',
    headline: 'A First Date That',
    emphasis: 'Actually Lands.',
    subhead: 'We help you nail the impression.',
  },
  {
    id: 'fomo',
    badge: 'FOMO Fighter',
    headline: 'Something Amazing Is',
    emphasis: 'Near You Right Now.',
    subhead: "Find it before it’s gone.",
  },
  {
    id: 'tonight',
    badge: 'Tonight Mode',
    headline: 'No Plans?',
    emphasis: "Let’s Fix That.",
    subhead: 'We find the move. You show up.',
  },
  {
    id: 'couple',
    badge: "Couple’s Scout",
    headline: 'You Two Deserve',
    emphasis: 'a Better Plan.',
    subhead: 'Thoughtful picks for date night, every time.',
  },
  {
    id: 'general',
    badge: 'Stop Scrolling. Go Live.',
    headline: "Life’s Happening",
    emphasis: 'Out There.',
    post: ' Live It!',
    subhead: 'Find your next move in seconds.',
  },
  {
    id: 'bored',
    badge: 'Boredom Killer',
    headline: 'Stop Scrolling.',
    emphasis: 'Start Going.',
    subhead: 'Yeah Doodle finds you something real.',
  },
  {
    id: 'weekend',
    badge: 'Weekend Planner',
    headline: 'Make This Weekend',
    emphasis: 'Actually Worth It.',
    subhead: '3 picks. Pick one. Go.',
  },
  {
    id: 'music',
    badge: 'Live Music Scout',
    headline: 'Live Music Is Happening',
    emphasis: 'Near You Tonight.',
    subhead: 'Find your next show in seconds.',
  },
  {
    id: 'local',
    badge: 'Local Scout',
    headline: 'You Live Here.',
    emphasis: 'Stop Missing the Good Stuff.',
    subhead: "Discover what’s actually happening near you.",
  },
  {
    id: 'foodie',
    badge: 'Foodie Scout',
    headline: 'Hungry for',
    emphasis: 'Something New?',
    subhead: 'Beyond the usual spots. We find the gems.',
  },
  {
    id: 'outdoor',
    badge: 'Adventure Scout',
    headline: 'Adventure Is',
    emphasis: '20 Minutes Away.',
    subhead: "Get outside before the day’s gone.",
  },
  {
    id: 'group',
    badge: 'Group Planner',
    headline: 'Your Crew',
    emphasis: 'Needs a Plan.',
    subhead: 'We find something everyone can agree on.',
  },
  {
    id: 'spontaneous',
    badge: 'Spontaneity Engine',
    headline: 'Nowhere to Be?',
    emphasis: 'Somewhere to Go.',
    subhead: 'What kind of night do you want?',
  },
  {
    id: 'legendary',
    badge: 'Legend Builder',
    headline: 'Tonight Could Be',
    emphasis: 'Legendary.',
    subhead: "Let’s find out what that looks like.",
  },
]

export default function HomePage() {
  const [surveyOpen, setSurveyOpen] = useState(false)
  const [surveyMode, setSurveyMode] = useState<SlideMode>('general')
  const [idx, setIdx] = useState(0)
  const [fading, setFading] = useState(false)

  const goTo = useCallback((next: number) => {
    setFading(true)
    setTimeout(() => {
      setIdx(next)
      setFading(false)
    }, 280)
  }, [])

  useEffect(() => {
    if (surveyOpen) return
    const t = setInterval(() => {
      goTo((idx + 1) % SLIDES.length)
    }, 4500)
    return () => clearInterval(t)
  }, [idx, surveyOpen, goTo])

  const slide = SLIDES[idx]

  function openSurvey() {
    setSurveyMode(slide.id)
    setSurveyOpen(true)
  }

  return (
    <>
      <MoodSurvey
        open={surveyOpen}
        onClose={() => setSurveyOpen(false)}
        mode={surveyMode}
      />

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center justify-center bg-yd-bg overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-yd-orange/15 via-transparent to-yd-navy/50 pointer-events-none" />
        <div className="absolute inset-0 dot-pattern opacity-15 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-yd-orange/6 blur-[120px] pointer-events-none" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-white/[0.018] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full bg-yd-orange/5 translate-y-1/3 -translate-x-1/4 pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 text-center">

          <div style={{ opacity: fading ? 0 : 1, transition: 'opacity 0.28s ease' }}>
            <div className="inline-flex items-center gap-2 bg-yd-orange/12 text-yd-orange text-xs font-semibold px-4 py-2 rounded-full mb-8 tracking-widest uppercase border border-yd-orange/25 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-yd-orange animate-pulse shrink-0" />
              {slide.badge}
            </div>

            <h1 className="font-display text-4xl sm:text-6xl lg:text-8xl text-white leading-[0.92] mb-6 tracking-tight">
              {slide.headline}<br />
              <span className="text-yd-orange">{slide.emphasis}</span>
              {slide.post && <span>{slide.post}</span>}
            </h1>

            <p className="text-white/50 text-xl sm:text-2xl mb-10 max-w-sm mx-auto leading-relaxed font-light">
              {slide.subhead}
            </p>
          </div>

          <button
            onClick={openSurvey}
            onMouseEnter={() => window.dispatchEvent(new CustomEvent('wb-yeahdoodle'))}
            className="group inline-flex items-center gap-3 bg-yd-orange hover:bg-yd-orangeHover text-white font-bold px-10 py-5 rounded-2xl text-lg transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            style={{ boxShadow: '0 0 50px rgba(255, 100, 0, 0.28)' }}
          >
            Yeah Doodle!
            <span className="group-hover:translate-x-1.5 transition-transform duration-200 text-xl">&rarr;</span>
          </button>

          <div className="flex items-center justify-center gap-1.5 mt-8">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => goTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`rounded-full transition-all duration-300 ${
                  i === idx
                    ? 'w-5 h-1.5 bg-yd-orange'
                    : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'
                }`}
              />
            ))}
          </div>

          <p className="text-white/20 text-sm mt-4 tracking-wide">
            � Auto-detects your location &middot; Hand-curated picks
          </p>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 select-none pointer-events-none">
          <div className="w-px h-8 bg-gradient-to-b from-white/0 to-white/25" />
          <div className="w-1 h-1 rounded-full bg-white/25" />
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="bg-yd-navy py-16">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="font-display text-2xl text-white text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'A few quick questions',
                body: 'Tell us what you’re after. 2–5 questions tailored to your vibe — takes under a minute.',
              },
              {
                step: '02',
                title: 'AI finds your top 3',
                body: 'We scan hand-curated spots and live events to surface the 3 picks that actually fit your night.',
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

      {/* ── What you'll find ── */}
      <section className="max-w-5xl mx-auto px-4 py-14">
        <h2 className="font-display text-2xl text-white text-center mb-8">What&apos;s waiting for you</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: '🍷', label: 'Romantic dinners and hidden local gems', mode: 'date-night' as SlideMode },
            { icon: '🔥', label: 'The hottest events everyone will be talking about', mode: 'fomo' as SlideMode },
            { icon: '🎭', label: 'Live shows worth getting dressed up for', mode: 'music' as SlideMode },
            { icon: '✨', label: 'Unique experiences you’ll actually remember', mode: 'legendary' as SlideMode },
          ].map(v => (
            <button
              key={v.label}
              onClick={() => { setSurveyMode(v.mode); setSurveyOpen(true) }}
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
