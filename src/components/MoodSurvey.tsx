'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import CategoryPlaceholder from './CategoryPlaceholder'
import { capture } from '@/lib/analytics'

interface Pick {
  id: string
  rank: number
  pitch: string
  title: string
  venue: string
  dateFormatted: string
  priceFormatted: string
  ticketUrl: string | null
  imageUrl: string | null
  category: string
}

interface Props {
  open: boolean
  onClose: () => void
  initialCity?: string
}

const QUESTIONS = [
  {
    question: "What's your energy tonight?",
    subtitle: 'How adventurous are you feeling?',
    options: [
      { label: 'Easy & familiar', desc: "Take me somewhere I know I'll enjoy", emoji: '🎯', quality: 'Safe bet' },
      { label: 'Mix it up a bit', desc: 'Push me slightly outside my comfort zone', emoji: '⚡', quality: 'Adventurous' },
      { label: 'Full send', desc: 'Make it a story worth telling tomorrow', emoji: '🚀', quality: 'Wild card' },
    ],
  },
  {
    question: "Who's your crew tonight?",
    subtitle: '',
    options: [
      { label: 'Solo or date night', desc: 'Just me, or me and one other', emoji: '👤', quality: 'Intimate' },
      { label: 'Small group', desc: 'A few close friends or fam', emoji: '👯', quality: 'Social' },
      { label: 'The whole squad', desc: "Big group energy, everyone's coming", emoji: '🎉', quality: 'Party mode' },
    ],
  },
  {
    question: 'What sounds good right now?',
    subtitle: 'Go with your gut',
    options: [
      { label: 'Live music or show', desc: 'Something to watch and feel', emoji: '🎵', quality: 'Entertainment' },
      { label: 'Food & drinks', desc: 'Good eats, good drinks, good company', emoji: '🍽️', quality: 'Chill' },
      { label: 'One-of-a-kind experience', desc: "Something I've never done before", emoji: '✨', quality: 'Unique' },
    ],
  },
  {
    question: "What's the scene?",
    subtitle: 'Pick the vibe that fits',
    options: [
      { label: 'Small & intimate', desc: 'Real atmosphere, you can actually talk', emoji: '🏡', quality: 'Cozy' },
      { label: 'Buzzing & social', desc: 'Medium energy, meeting-people kind of night', emoji: '🍻', quality: 'Social' },
      { label: 'Big & electric', desc: "Massive crowd, everyone's there for it", emoji: '🏟️', quality: 'Epic' },
    ],
  },
  {
    question: 'Budget tonight?',
    subtitle: '',
    options: [
      { label: 'Free–$25', desc: 'Free fun is real fun', emoji: '💚', quality: 'Good' },
      { label: '$25–$75', desc: 'Happy to spend on a good night', emoji: '💛', quality: 'Better' },
      { label: "Sky's the limit", desc: 'The experience is what matters', emoji: '💜', quality: 'Best' },
    ],
  },
]

const LOADING_MESSAGES = [
  'Scanning events near you...',
  'Matching your vibe...',
  'Finding hidden gems...',
  'Picking your top 3...',
]

const MEDALS = ['🥇', '🥈', '🥉']

type Phase = 'locating' | 'city' | 'question' | 'loading' | 'results' | 'empty'

export default function MoodSurvey({ open, onClose, initialCity = '' }: Props) {
  const [city, setCity]     = useState(initialCity)
  const [lat, setLat]       = useState<number | null>(null)
  const [lng, setLng]       = useState<number | null>(null)
  const [phase, setPhase]   = useState<Phase>(initialCity ? 'question' : 'locating')
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [picks, setPicks]   = useState<Pick[]>([])
  const [animating, setAnimating] = useState(false)
  const [copied, setCopied] = useState(false)
  const cancelGps = useRef(false)

  // GPS detection + reset on open/close
  useEffect(() => {
    if (!open) {
      cancelGps.current = true
      const t = setTimeout(() => {
        cancelGps.current = false
        setCity(initialCity)
        setLat(null)
        setLng(null)
        setPhase(initialCity ? 'question' : 'locating')
        setQIndex(0)
        setAnswers([])
        setPicks([])
        setLoadingMsg(0)
      }, 300)
      return () => clearTimeout(t)
    }

    cancelGps.current = false

    if (initialCity) {
      setPhase('question')
    } else {
      setPhase('locating')
    }

    if (!navigator.geolocation) {
      if (!initialCity) setPhase('city')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async pos => {
        if (cancelGps.current) return
        const { latitude, longitude } = pos.coords
        setLat(latitude)
        setLng(longitude)

        try {
          const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
          )
          const geo = await r.json()
          const name = geo.city || geo.locality || geo.principalSubdivision || ''
          if (!cancelGps.current && name) setCity(name)
        } catch { /* use existing city */ }

        if (!cancelGps.current && !initialCity) setPhase('question')
      },
      () => {
        if (!cancelGps.current && !initialCity) setPhase('city')
      },
      { timeout: 8000, maximumAge: 300_000 },
    )
  }, [open, initialCity])

  useEffect(() => {
    if (open) capture('survey_opened')
  }, [open])

  useEffect(() => {
    if (phase !== 'loading') return
    const interval = setInterval(() => {
      setLoadingMsg(i => (i + 1) % LOADING_MESSAGES.length)
    }, 900)
    return () => clearInterval(interval)
  }, [phase])

  async function handleAnswer(answer: string) {
    const newAnswers = [...answers, answer]
    setAnswers(newAnswers)
    capture('question_answered', { question_index: qIndex, answer })

    if (qIndex < QUESTIONS.length - 1) {
      setAnimating(true)
      setTimeout(() => {
        setQIndex(i => i + 1)
        setAnimating(false)
      }, 180)
    } else {
      setPhase('loading')
      setLoadingMsg(0)
      try {
        const body: Record<string, unknown> = { city, answers: newAnswers }
        if (lat !== null) body.lat = lat
        if (lng !== null) body.lng = lng

        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.picks?.length > 0) {
          setPicks(data.picks)
          setPhase('results')
          capture('picks_viewed', { city, pick_count: data.picks.length })
        } else {
          setPhase('empty')
        }
      } catch {
        setPhase('empty')
      }
    }
  }

  function handleReset() {
    setQIndex(0)
    setAnswers([])
    setPicks([])
    setPhase('question')
  }

  function handleShare() {
    const ids = picks.map(p => p.id).join(',')
    const params = new URLSearchParams({ city: city || 'nearby', ids })
    const url = `${window.location.origin}/picks?${params.toString()}`
    if (navigator.share) {
      navigator.share({ title: 'My picks for tonight 🎯', text: `Check out these events in ${city || 'my area'}!`, url })
        .catch(() => {/* user cancelled */})
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        capture('picks_shared', { city, pick_count: picks.length })
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full sm:max-w-lg bg-yd-card rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors rounded-full hover:bg-white/10"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Locating phase */}
        {phase === 'locating' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6">📍</div>
            <h2 className="font-display text-xl text-white mb-3">Finding events near you...</h2>
            <p className="text-white/40 text-sm mb-8">Allow location access for the best picks</p>
            <button
              onClick={() => setPhase('city')}
              className="text-white/30 hover:text-white/60 text-sm underline underline-offset-2 transition-colors"
            >
              Enter city manually instead
            </button>
          </div>
        )}

        {/* City phase */}
        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">5 quick questions → your 3 best picks tonight</p>
            <input
              autoFocus
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && city.trim()) { capture('city_selected', { city }); setPhase('question') } }}
              placeholder="What city are you in?"
              className="w-full px-4 py-3 rounded-xl bg-white/10 text-white placeholder-white/30 border border-white/20 focus:outline-none focus:border-yd-orange mb-4 text-base"
            />
            <button
              onClick={() => { if (city.trim()) { capture('city_selected', { city }); setPhase('question') } }}
              disabled={!city.trim()}
              className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
            >
              Let&apos;s go →
            </button>
          </div>
        )}

        {/* Question phase */}
        {phase === 'question' && (
          <div className={`p-6 transition-opacity duration-150 ${animating ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}`}>
            <div className="flex gap-1.5 mb-5">
              {QUESTIONS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= qIndex ? 'bg-yd-orange' : 'bg-white/10'}`}
                />
              ))}
            </div>

            <p className="text-white/30 text-xs mb-1.5">Question {Math.min(qIndex + 1, QUESTIONS.length)} of {QUESTIONS.length}</p>
            <h2 className="font-display text-xl text-white mb-1">{QUESTIONS[qIndex].question}</h2>
            {QUESTIONS[qIndex].subtitle && (
              <p className="text-white/40 text-sm mb-5">{QUESTIONS[qIndex].subtitle}</p>
            )}
            {!QUESTIONS[qIndex].subtitle && <div className="mb-5" />}

            {(city || lat) && (
              <div className="flex items-center gap-1.5 mb-4 -mt-2">
                <span className="text-xs text-white/30">📍</span>
                <span className="text-xs text-white/30">{city || 'your location'}</span>
                {!lat && (
                  <button
                    onClick={() => setPhase('city')}
                    className="text-xs text-white/20 hover:text-white/50 underline underline-offset-2 transition-colors ml-1"
                  >
                    change
                  </button>
                )}
              </div>
            )}

            <div className="space-y-2.5">
              {QUESTIONS[qIndex].options.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => handleAnswer(opt.label)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-yd-orange/60 hover:bg-yd-orange/5 text-left transition-all group"
                >
                  <span className="text-2xl shrink-0">{opt.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-white text-sm">{opt.label}</span>
                      <span className="text-xs bg-white/10 text-white/40 px-2 py-0.5 rounded-full shrink-0">{opt.quality}</span>
                    </div>
                    <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors truncate">{opt.desc}</p>
                  </div>
                  <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">→</span>
                </button>
              ))}
            </div>

            {qIndex > 0 && (
              <button
                onClick={() => { setQIndex(i => i - 1); setAnswers(a => a.slice(0, -1)) }}
                className="mt-4 text-white/25 hover:text-white/50 text-xs transition-colors"
              >
                ← Back
              </button>
            )}
          </div>
        )}

        {/* Loading phase */}
        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">🎯</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-[1.25rem] transition-all duration-300">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        )}

        {/* Results phase */}
        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <h2 className="font-display text-xl text-white">Your picks for tonight</h2>
              <p className="text-white/30 text-xs mt-0.5">
                {lat ? `📍 near you` : `in ${city}`}
              </p>
            </div>

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {picks.map((pick, i) => (
                <div key={pick.id} className="bg-yd-bg/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors">
                  <div className="relative w-full h-36">
                    {pick.imageUrl ? (
                      <Image
                        src={pick.imageUrl}
                        alt={pick.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 512px"
                      />
                    ) : (
                      <CategoryPlaceholder category={pick.category} />
                    )}
                    <span className="absolute top-2 left-2 text-xl leading-none drop-shadow-lg">{MEDALS[i]}</span>
                  </div>
                  <div className="p-3">
                    <p className="font-semibold text-white text-sm leading-snug mb-1 line-clamp-2">{pick.title}</p>
                    <p className="text-white/40 text-xs mb-2">
                      {pick.venue && <span>{pick.venue} · </span>}
                      {pick.dateFormatted} · {pick.priceFormatted}
                    </p>
                    <p className="text-yd-orange/80 text-xs italic leading-relaxed mb-3">
                      &ldquo;{pick.pitch}&rdquo;
                    </p>
                    {pick.ticketUrl ? (
                      <a
                        href={pick.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 bg-yd-orange hover:bg-yd-orangeHover text-white text-xs font-bold px-4 py-1.5 rounded-lg transition-colors"
                        onClick={() => capture('ticket_clicked', { event_id: pick.id, title: pick.title, city, rank: pick.rank })}
                      >
                        Let&apos;s go →
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {copied ? '✅ Link copied!' : '🔗 Share my picks'}
              </button>
              <div className="flex items-center justify-between">
                <button
                  onClick={handleReset}
                  className="text-white/25 hover:text-white/55 text-xs transition-colors"
                >
                  ↩ Try different answers
                </button>
                <button
                  onClick={onClose}
                  className="text-white/25 hover:text-white/55 text-xs transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty phase */}
        {phase === 'empty' && (
          <div className="p-8 text-center py-14">
            <div className="text-4xl mb-4">🤷</div>
            <h2 className="font-display text-xl text-white mb-2">Nothing matched right now</h2>
            <p className="text-white/40 text-sm mb-6">
              Try a different city or check back soon — events update daily.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                ← Try again
              </button>
              <button
                onClick={onClose}
                className="text-white/30 hover:text-white/60 text-sm px-5 py-2.5 transition-colors"
              >
                Browse events
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}