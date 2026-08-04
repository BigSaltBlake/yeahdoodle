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
  source?: string
}

interface Props {
  open: boolean
  onClose: () => void
  initialCity?: string
}

const QUESTIONS = [
  {
    question: 'When are you planning this?',
    subtitle: '',
    options: [
      { label: 'Tonight', desc: "Let's make something happen right now", emoji: '🌙', quality: 'Tonight' },
      { label: 'Tomorrow', desc: 'Lining something up for tomorrow', emoji: '☀️', quality: 'Tomorrow' },
      { label: 'This weekend', desc: 'Friday through Sunday', emoji: '🎉', quality: 'Weekend' },
      { label: 'Coming weeks', desc: 'Scouting ahead — want options on the calendar', emoji: '📅', quality: 'Planning' },
    ],
  },
  {
    question: "What's your energy?",
    subtitle: 'How adventurous are you feeling?',
    options: [
      { label: 'Easy & familiar', desc: "Take me somewhere I know I'll enjoy", emoji: '🎯', quality: 'Safe bet' },
      { label: 'Mix it up a bit', desc: 'Push me slightly outside my comfort zone', emoji: '⚡', quality: 'Adventurous' },
      { label: 'Full send', desc: 'Make it a story worth telling', emoji: '🚀', quality: 'Wild card' },
    ],
  },
  {
    question: "Who's your crew?",
    subtitle: '',
    options: [
      { label: 'Solo or date night', desc: 'Just me, or me and one other', emoji: '👤', quality: 'Intimate' },
      { label: 'Small group', desc: 'A few close friends or fam', emoji: '👯', quality: 'Social' },
      { label: 'The whole squad', desc: "Big group energy, everyone's coming", emoji: '🎊', quality: 'Party mode' },
    ],
  },
  {
    question: 'What sounds good?',
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
    question: "What's your budget?",
    subtitle: '',
    options: [
      { label: 'Free–$25', desc: 'Free fun is real fun', emoji: '💚', quality: 'Good' },
      { label: '$25–$75', desc: 'Happy to spend on a good time', emoji: '💛', quality: 'Better' },
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
type EmailState = 'idle' | 'loading' | 'done' | 'error'
type FeedbackRating = 'up' | 'meh' | 'down'
type SaveIntent = 'save_for_later' | 'definitely_going'
type SavedEventLocal = { event_id: string; event_title: string; event_data: Record<string, unknown>; intent: SaveIntent; city: string; saved_at: string }

export default function MoodSurvey({ open, onClose, initialCity = '' }: Props) {
  const [city, setCity] = useState(initialCity)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>(initialCity ? 'question' : 'locating')
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [picks, setPicks] = useState<Pick[]>([])
  const [animating, setAnimating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailState, setEmailState] = useState<EmailState>('idle')
  const [feedback, setFeedback] = useState<Record<string, FeedbackRating>>({})
  const [saved, setSaved] = useState<Record<string, SaveIntent>>({})
  const [heartOpen, setHeartOpen] = useState<string | null>(null)
  const [showSignInNudge, setShowSignInNudge] = useState(false)
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

    // Modal just opened -- try GPS
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

  function getSessionId(): string {
    try {
      const k = 'yd_sid'
      let sid: string | null = null
      try { sid = localStorage.getItem(k) } catch { /* */ }
      if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(k, sid) } catch { /* */ } }
      return sid
    } catch { return 'anon' }
  }

  async function submitFeedback(pick: Pick, rating: FeedbackRating) {
    setFeedback(prev => ({ ...prev, [pick.id]: rating }))
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: pick.id, event_title: pick.title, rating, session_id: getSessionId(), city }),
      })
    } catch { /* fire and forget */ }
  }

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem('yd_saved_map') || '{}')) } catch {}
  }, [])

  async function saveEvent(pick: Pick, intent: SaveIntent) {
    setHeartOpen(null)
    const newSaved = { ...saved, [pick.id]: intent }
    setSaved(newSaved)
    try {
      localStorage.setItem('yd_saved_map', JSON.stringify(newSaved))
      const list: SavedEventLocal[] = JSON.parse(localStorage.getItem('yd_saved') || '[]')
      const filtered = list.filter(e => e.event_id !== pick.id)
      filtered.unshift({ event_id: pick.id, event_title: pick.title, event_data: pick as unknown as Record<string, unknown>, intent, city, saved_at: new Date().toISOString() })
      localStorage.setItem('yd_saved', JSON.stringify(filtered))
    } catch {}
    if (Object.keys(saved).length === 0) setShowSignInNudge(true)
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: pick.id, event_title: pick.title, event_data: pick, intent, session_id: getSessionId(), city }),
      })
    } catch {}
    capture('event_saved', { event_id: pick.id, title: pick.title, intent, city })
  }

  async function unsaveEvent(pick: Pick) {
    setHeartOpen(null)
    const newSaved = { ...saved }
    delete newSaved[pick.id]
    setSaved(newSaved)
    try {
      localStorage.setItem('yd_saved_map', JSON.stringify(newSaved))
      const list: SavedEventLocal[] = JSON.parse(localStorage.getItem('yd_saved') || '[]')
      localStorage.setItem('yd_saved', JSON.stringify(list.filter(e => e.event_id !== pick.id)))
    } catch {}
    try {
      await fetch('/api/save', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: pick.id, session_id: getSessionId() }),
      })
    } catch {}
    capture('event_unsaved', { event_id: pick.id, title: pick.title, city })
  }

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
    setEmailInput('')
    setEmailState('idle')
    setPhase('question')
  }

  async function handleSubscribe() {
    if (!emailInput.trim() || emailState !== 'idle') return
    setEmailState('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailInput.trim(), city: city || null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEmailState('done')
      capture('email_subscribed', { city })
    } catch {
      setEmailState('error')
    }
  }

  const timeframeDisplay = (() => {
    const tf = answers[0] ?? ''
    if (tf === 'Tonight') return 'tonight'
    if (tf === 'Tomorrow') return 'tomorrow'
    if (tf === 'This weekend') return 'this weekend'
    if (tf === 'Coming weeks') return 'coming up'
    return 'tonight'
  })()

  function handleShare() {
    const ids = picks.map(p => p.id).join(',')
    const params = new URLSearchParams({ city: city || 'nearby', ids })
    const url = `${window.location.origin}/picks?${params.toString()}`
    if (navigator.share) {
      navigator.share({ title: `My picks for ${timeframeDisplay} 🎯`, text: `Check out these events in ${city || 'my area'}!`, url })
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
            <p className="text-white/50 text-sm mb-7">6 quick questions → your 3 best picks</p>
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
              <h2 className="font-display text-xl text-white">Your picks for {timeframeDisplay}</h2>
              <p className="text-white/30 text-xs mt-0.5">
                {lat ? `📍 near you` : `in ${city}`}
              </p>
            </div>

            {/* Saved count + sign-in nudge */}
            {Object.keys(saved).length > 0 && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-white/50">❤️ {Object.keys(saved).length} saved</span>
                <a href="/saved" className="text-xs text-[#4f9b85] hover:text-[#3d8372] transition-colors">View saved →</a>
              </div>
            )}
            {showSignInNudge && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-2 text-xs">
                <span className="text-white/60">Sign in to access your saved events on any device</span>
                <a href="/auth" className="text-[#4f9b85] hover:underline ml-2 shrink-0">Sign in</a>
              </div>
            )}
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {picks.map((pick, i) => (
                <div key={pick.id} className="bg-yd-bg/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors" onClick={() => setHeartOpen(null)}>
                  <div className="relative w-full h-36">
                    <Image src={pick.imageUrl || ''} alt={pick.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 100%" priority={!!pick.imageUrl} />
                    {!pick.imageUrl && (
                      <CategoryPlaceholder category={pick.category || ''} className="w-full h-full" />
                    )}
                    <span className="absolute top-2 left-2 text-xl leading-none drop-shadow-lg">{MEDALS[i]}</span>
                    {/* Heart / Save */}
                    <div className="absolute top-2 right-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setHeartOpen(heartOpen === pick.id ? null : pick.id) }}
                        className="text-xl leading-none drop-shadow-lg transition-transform hover:scale-125 active:scale-110 block"
                        title={saved[pick.id] ? 'Saved' : 'Save this event'}
                        style={{ opacity: saved[pick.id] ? 1 : 0.5 }}
                      >
                        {saved[pick.id] ? '❤️' : '🤍'}
                      </button>
                      {heartOpen === pick.id && (
                        <div className="absolute right-0 top-8 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-20 w-44 overflow-hidden">
                          {saved[pick.id] ? (
                            <button onClick={() => unsaveEvent(pick)} className="w-full text-left px-3 py-2.5 text-xs text-white/70 hover:bg-white/10 transition-colors">
                              🗑️ Remove from saved
                            </button>
                          ) : (
                            <>
                              <button onClick={() => saveEvent(pick, 'save_for_later')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors border-b border-white/10">
                                🔖 Save for later
                              </button>
                              <button onClick={() => saveEvent(pick, 'definitely_going')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                                🎯 Definitely going
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    <span className="font-medium font-semibold text-white text-sm leading-snug">{pick.title}</span>
                    <span className="text-xs text-white/50 block truncate overflow-hidden whitespace-nowrap max-w-[200px]">{pick.venue}</span>
                    <span className="text-xs text-white/40 block">{pick.dateFormatted} &middot; {pick.priceFormatted}</span>
                    <span className="text-xs text-white/40 block italic">{pick.pitch}</span>
                    <div className="flex gap-2 mt-1">
                      {pick.source && <span className="bg-white/10 rounded px-1.5 text-[10px] text-white/50">{pick.source}</span>}
                      {pick.ticketUrl && <a href={pick.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-[#4f9b85] hover:text-[#3d8372] transition-colors"
                        onClick={() => capture('ticket_clicked', { event_id: pick.id, title: pick.title, city, rank: pick.rank })}
                      >
                        Let&apos;s go →
                      </a>}
                    </div>
                  </div>
                  {/* Feedback */}
                  <div className="flex items-center justify-center gap-4 pt-2 mt-2 border-t border-white/10">
                    <span className="text-white/40 text-xs mr-1">Rate this pick</span>
                    {(['up', 'meh', 'down'] as FeedbackRating[]).map(r => (
                      <button
                        key={r}
                        onClick={() => submitFeedback(pick, r)}
                        title={r === 'up' ? 'Love it' : r === 'meh' ? 'So-so' : 'Not for me'}
                        style={{ display: 'inline-block', transform: r === 'meh' ? 'rotate(90deg)' : undefined, fontSize: '1.15rem', opacity: feedback[pick.id] ? (feedback[pick.id] === r ? 1 : 0.2) : 0.45 }}
                        className="transition-all duration-150 hover:scale-125 active:scale-110 leading-none cursor-pointer"
                      >
                        {r === 'down' ? '👎' : '👍'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Email capture */}
            <div className="mt-4 bg-white/5 border border-white/10 rounded-xl p-4">
              {emailState === 'done' ? (
                <p className="text-center text-sm text-white/70">
                  ✅ You&apos;re in! We&apos;ll send weekly picks to your inbox.
                </p>
              ) : (
                <>
                  <p className="text-white text-sm font-semibold mb-0.5">
                    Get weekly picks{city ? ` for ${city}` : ''}
                  </p>
                  <p className="text-white/40 text-xs mb-3">
                    We&apos;ll send your best local events every week. No spam.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={e => { setEmailInput(e.target.value); if (emailState === 'error') setEmailState('idle') }}
                      onKeyDown={e => { if (e.key === 'Enter') handleSubscribe() }}
                      placeholder="you@email.com"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/10 text-white placeholder-white/25 border border-white/15 focus:outline-none focus:border-yd-orange text-sm"
                    />
                    <button
                      onClick={handleSubscribe}
                      disabled={!emailInput.trim() || emailState === 'loading'}
                      className="shrink-0 bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                    >
                      {emailState === 'loading' ? '...' : 'Notify me'}
                    </button>
                  </div>
                  {emailState === 'error' && (
                    <p className="text-red-400/80 text-xs mt-1.5">Something went wrong — try again.</p>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2">
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
