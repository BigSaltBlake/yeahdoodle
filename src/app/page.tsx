'use client'

import { useState } from 'react'
import MoodSurvey from '@/components/MoodSurvey'

export default function HomePage() {
  const [surveyOpen, setSurveyOpen] = useState(false)

  return (
    <>
      <MoodSurvey
        open={surveyOpen}
        onClose={() => setSurveyOpen(false)}
      />

      {/* ── Hero ── */}
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
            What&apos;s the<br />
            <span className="text-yd-orange">move</span> tonight?
          </h1>

          {/* Subhead */}
          <p className="text-white/50 text-xl sm:text-2xl mb-10 max-w-xs mx-auto leading-relaxed font-light">
            2 questions. Your 3 best picks. Near you, right now.
          </p>

          {/* Single CTA */}
          <button
            onClick={() => setSurveyOpen(true)}
            className="group inline-flex items-center gap-3 bg-yd-orange hover:bg-yd-orangeHover text-white font-bold px-10 py-5 rounded-2xl text-lg transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]"
            style={{ boxShadow: '0 0 50px rgba(255, 100, 0, 0.28)' }}
          >
            YeahDoodle! Let&apos;s go
            <span className="group-hover:translate-x-1.5 transition-transform duration-200 text-xl">→</span>
          </button>

          {/* Reassurance */}
          <p className="text-white/20 text-sm mt-6 tracking-wide">
            📍 Auto-detects your location
          </p>
        </div>

        {/* Scroll nudge */}
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
                title: '2 quick questions',
                body: 'How do you want to feel? What would kill the vibe? Takes 10 seconds — we handle the rest.',
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

      {/* ── What you\'ll find ── */}
      <section className="max-w-5xl mx-auto px-4 py-14">
        <h2 className="font-display text-2xl text-white text-center mb-8">What&apos;s waiting for you</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: '🎸', label: 'Live music you can feel in your chest' },
            { icon: '🌮', label: 'Hidden gems the locals actually go to' },
            { icon: '🎨', label: 'Art, theatre, and things to talk about after' },
            { icon: '🏆', label: 'Sports, outdoor adventures, and real action' },
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
