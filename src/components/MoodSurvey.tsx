'use client'
// v2 — Groups A/B/C: energy slider, 5 timeframes, crew split, group-size Q, budget labels, return-visit history
import { useState, useEffect, useRef } from 'react'
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
  distanceLabel?: string
}

interface Props {
  open: boolean
  onClose: () => void
  initialCity?: string
}

interface QuestionOption {
  label: string
  desc: string
  emoji: string
  quality: string
  perPerson?: number | null
  forCouple?: number | null
}

interface Question {
  id: string
  question: string
  subtitle: string
  options: QuestionOption[]
  special?: 'energy-slider' | 'budget'
  conditional?: boolean
}

// ---------------------------------------------------------------------------
// Questions — psychology-first: feeling target → kill switch (2 questions)
// When, crew, and budget are result-page filters — not survey questions
// ---------------------------------------------------------------------------
const ALL_QUESTIONS: Question[] = [
  {
    id: 'feeling',
    question: 'How do you want to feel?',
    subtitle: 'Go with your gut — the right answer comes fast',
    options: [
      { label: 'Pumped up & electric', desc: 'High energy, big moments, electric atmosphere',   emoji: '🔥', quality: 'High energy' },
      { label: 'Relaxed & happy',      desc: 'Chill vibes, good food, good company',            emoji: '😌', quality: 'Laid back'   },
      { label: "Curious & wow'd",      desc: 'Something that surprises or inspires me',         emoji: '🤯', quality: 'Inspired'    },
      { label: 'Laughing & social',    desc: 'Fun, loose, laughing with people I like',         emoji: '😂', quality: 'Social'      },
    ],
  },
  {
    id: 'killswitch',
    question: 'What would kill the vibe?',
    subtitle: "Pick your dealbreaker — we'll steer clear",
    options: [
      { label: 'Huge crowds & noise',       desc: "Can't hear myself think in big venues",          emoji: '🙉', quality: 'Avoid crowds'  },
      { label: 'Blowing my budget',         desc: 'Spending way more than I planned',               emoji: '💸', quality: 'Budget-aware'  },
      { label: 'Sitting still for hours',   desc: 'Long performances, lectures, sit-down shows',    emoji: '🧘', quality: 'Stay active'    },
      { label: 'Lots of planning required', desc: 'Figuring it out on the fly is a nightmare',      emoji: '🗺️', quality: 'Keep it simple' },
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

type Phase = 'locating' | 'city' | 'returning' | 'question' | 'loading' | 'results' | 'empty'
type EmailState = 'idle' | 'loading' | 'done' | 'error'
type FeedbackRating = 'up' | 'meh' | 'down'
type SaveIntent = 'save_for_later' | 'definitely_going'
type SavedEventLocal = { event_id: string; event_title: string; event_data: Record<string, unknown>; intent: SaveIntent; city: string; saved_at: string }
type SurveyHistoryEntry = { answers: string[]; city: string; date: string }

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
  const [showHistConsent, setShowHistConsent] = useState(false)
  const [hasReturnHistory, setHasReturnHistory] = useState(false)
  const [lastAnswers, setLastAnswers] = useState<string[] | null>(null)
  const [filterBudget, setFilterBudget] = useState<string>('')
  const [filterCrew, setFilterCrew]     = useState<string>('')
  const [filterWhen, setFilterWhen]     = useState<string>('')
  const [openFilter, setOpenFilter]     = useState<'when' | 'budget' | 'crew' | null>(null)
  const cancelGps = useRef(false)

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const activeQuestions = ALL_QUESTIONS

  const timeframeDisplay = 'the next few days'

  // ---------------------------------------------------------------------------
  // GPS + modal lifecycle
  // ---------------------------------------------------------------------------
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
        setShowHistConsent(false)
        setHasReturnHistory(false)
        setLastAnswers(null)
      }, 300)
      return () => clearTimeout(t)
    }

    // Modal just opened — check localStorage for return-visit history
    cancelGps.current = false
    let returnHist = false
    let savedAnswers: string[] | null = null
    try {
      const consent = localStorage.getItem('yd_hist_consent')
      if (consent === 'true') {
        const hist = JSON.parse(localStorage.getItem('yd_survey_hist') || '[]') as SurveyHistoryEntry[]
        if (hist.length > 0) {
          returnHist = true
          savedAnswers = hist[0].answers
        }
      }
    } catch { /* */ }
    setHasReturnHistory(returnHist)
    setLastAnswers(savedAnswers)

    if (initialCity) {
      setPhase(returnHist ? 'returning' : 'question')
      return
    }

    setPhase('locating')

    if (!navigator.geolocation) {
      setPhase('city')
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
        if (!cancelGps.current) setPhase(returnHist ? 'returning' : 'question')
      },
      () => {
        if (!cancelGps.current) setPhase('city')
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

  // ---------------------------------------------------------------------------
  // Session / save / feedback helpers (unchanged from prior version)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Survey history helpers
  // ---------------------------------------------------------------------------
  function saveToHistory(answersToSave: string[]) {
    try {
      const hist = JSON.parse(localStorage.getItem('yd_survey_hist') || '[]') as SurveyHistoryEntry[]
      hist.unshift({ answers: answersToSave, city, date: new Date().toISOString() })
      localStorage.setItem('yd_survey_hist', JSON.stringify(hist.slice(0, 5)))
    } catch { /* */ }
  }

  // ---------------------------------------------------------------------------
  // Core submit (used by both normal survey flow and "Same vibe" shortcut)
  // ---------------------------------------------------------------------------
  async function doSubmit(submittedAnswers: string[], filterOverrides?: { budget?: string; crew?: string; when?: string }) {
    const activeBudget = filterOverrides !== undefined ? (filterOverrides.budget ?? '') : filterBudget
    const activeCrew   = filterOverrides !== undefined ? (filterOverrides.crew   ?? '') : filterCrew
    const activeWhen   = filterOverrides !== undefined ? (filterOverrides.when   ?? '') : filterWhen
    setAnswers(submittedAnswers)
    setPhase('loading')
    setLoadingMsg(0)
    try {
      const body: Record<string, unknown> = {
        city,
        answers: submittedAnswers,
        ...(activeBudget || activeCrew || activeWhen ? {
          filters: {
            ...(activeBudget ? { budget: activeBudget } : {}),
            ...(activeCrew   ? { crew:   activeCrew   } : {}),
            ...(activeWhen   ? { when:   activeWhen   } : {}),
          }
        } : {}),
      }
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
        // History: auto-save if already consented; prompt if first time
        try {
          const consent = localStorage.getItem('yd_hist_consent')
          if (consent === 'true') saveToHistory(submittedAnswers)
          else if (!consent) setShowHistConsent(true)
        } catch { /* */ }
      } else {
        setPhase('empty')
      }
    } catch {
      setPhase('empty')
    }
  }

  // ---------------------------------------------------------------------------
  // Answer handlers
  // ---------------------------------------------------------------------------
  async function handleAnswer(answer: string) {
    const newAnswers = [...answers, answer]
    setAnswers(newAnswers)
    capture('question_answered', { question_index: qIndex, answer })

    if (qIndex < ALL_QUESTIONS.length - 1) {
      setAnimating(true)
      setTimeout(() => {
        setQIndex(i => i + 1)
        setAnimating(false)
      }, 180)
    } else {
      await doSubmit(newAnswers)
    }
  }

  function handleReset() {
    setQIndex(0)
    setAnswers([])
    setPicks([])
    setEmailInput('')
    setEmailState('idle')
    setShowHistConsent(false)
    setFilterBudget('')
    setFilterCrew('')
    setFilterWhen('')
    setOpenFilter(null)
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

  function handleShare() {
    const ids = picks.map(p => p.id).join(',')
    const params = new URLSearchParams({ city: city || 'nearby', ids })
    const url = `${window.location.origin}/picks?${params.toString()}`
    if (navigator.share) {
      navigator.share({ title: 'Stop scrolling. Go live. 👉', text: `Found something worth doing${city ? ` in ${city}` : ' near me'} through YeahDoodle`, url })
        .catch(() => { /* user cancelled */ })
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        capture('picks_shared', { city, pick_count: picks.length })
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!open) return null

  const currentQ = activeQuestions[qIndex]

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

        {/* ── Locating ─────────────────────────────────────────────────────── */}
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

        {/* ── City entry ───────────────────────────────────────────────────── */}
        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">2 quick questions → your 3 best picks</p>
            <input
              autoFocus
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && city.trim()) { capture('city_selected', { city }); setPhase(hasReturnHistory ? 'returning' : 'question') } }}
              placeholder="What city are you in?"
              className="w-full px-4 py-3 rounded-xl bg-white/10 text-white placeholder-white/30 border border-white/20 focus:outline-none focus:border-yd-orange mb-4 text-base"
            />
            <button
              onClick={() => { if (city.trim()) { capture('city_selected', { city }); setPhase(hasReturnHistory ? 'returning' : 'question') } }}
              disabled={!city.trim()}
              className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
            >
              Let&apos;s go →
            </button>
          </div>
        )}

        {/* ── Return visit ─────────────────────────────────────────────────── */}
        {phase === 'returning' && lastAnswers && (
          <div className="p-6">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">👋</div>
              <h2 className="font-display text-xl text-white mb-2">Welcome back!</h2>
              <p className="text-white/50 text-sm">Same vibe as last time or would you like to change it up a bit?</p>
            </div>
            <div className="space-y-2.5">
              <button
                onClick={() => doSubmit(lastAnswers)}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-yd-orange/40 hover:border-yd-orange bg-yd-orange/10 text-left transition-all group"
              >
                <span className="text-2xl shrink-0">🔄</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm mb-0.5">Same vibe</div>
                  <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors">Use my answers from last time</p>
                </div>
                <span className="text-yd-orange/60 group-hover:text-yd-orange transition-colors shrink-0">→</span>
              </button>
              <button
                onClick={() => { setQIndex(0); setAnswers([]); setPhase('question') }}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-white/25 hover:bg-white/5 text-left transition-all group"
              >
                <span className="text-2xl shrink-0">✨</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm mb-0.5">Change it up</div>
                  <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors">Start fresh with new answers</p>
                </div>
                <span className="text-white/20 group-hover:text-white/50 transition-colors shrink-0">→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Questions ────────────────────────────────────────────────────── */}
        {phase === 'question' && currentQ && (
          <div className={`p-6 transition-opacity duration-150 ${animating ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}`}>

            {/* Progress */}
            <div className="flex gap-1.5 mb-5">
              {activeQuestions.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= qIndex ? 'bg-yd-orange' : 'bg-white/10'}`}
                />
              ))}
            </div>

            <p className="text-white/30 text-xs mb-1.5">Question {qIndex + 1} of {activeQuestions.length}</p>
            <h2 className="font-display text-xl text-white mb-1">{currentQ.question}</h2>
            {currentQ.subtitle
              ? <p className="text-white/40 text-sm mb-5">{currentQ.subtitle}</p>
              : <div className="mb-5" />
            }

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

            {/* ── Standard option buttons ───────────────────────────────── */}
            {!currentQ.special && (
              <div className="space-y-2.5">
                {currentQ.options.map(opt => (
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
            )}

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

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">🎯</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-[1.25rem] transition-all duration-300">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-3">
              <h2 className="font-display text-xl text-white">Your picks</h2>
              <p className="text-white/30 text-xs mt-0.5">
                {lat ? `📍 near you` : `in ${city}`}
              </p>
            </div>

            {/* ── Filters ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-1.5 mb-3" onClick={() => setOpenFilter(null)}>
              {/* When */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenFilter(openFilter === 'when' ? null : 'when')}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${filterWhen ? 'bg-yd-orange/20 border-yd-orange/60 text-yd-orange font-semibold' : 'border-white/15 text-white/45 hover:border-white/30 hover:text-white/70'}`}
                >
                  📅 {filterWhen || 'When'}
                </button>
                {openFilter === 'when' && (
                  <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[150px] overflow-hidden">
                    {filterWhen && (
                      <button onClick={() => { setFilterWhen(''); setOpenFilter(null); doSubmit(answers, { when: '', budget: filterBudget, crew: filterCrew }) }}
                        className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                        ✕ Any time
                      </button>
                    )}
                    {['Now', 'This weekend', 'Next Week', 'Planning Ahead'].map(o => (
                      <button key={o} onClick={() => { setFilterWhen(o); setOpenFilter(null); doSubmit(answers, { when: o, budget: filterBudget, crew: filterCrew }) }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors ${filterWhen === o ? 'text-yd-orange font-semibold' : 'text-white/70'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Budget */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenFilter(openFilter === 'budget' ? null : 'budget')}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${filterBudget ? 'bg-yd-orange/20 border-yd-orange/60 text-yd-orange font-semibold' : 'border-white/15 text-white/45 hover:border-white/30 hover:text-white/70'}`}
                >
                  💰 {filterBudget || 'Budget'}
                </button>
                {openFilter === 'budget' && (
                  <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[150px] overflow-hidden">
                    {filterBudget && (
                      <button onClick={() => { setFilterBudget(''); setOpenFilter(null); doSubmit(answers, { budget: '', when: filterWhen, crew: filterCrew }) }}
                        className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                        ✕ Any budget
                      </button>
                    )}
                    {['Free', '$25 or so', 'Around $50', "Sky's the Limit"].map(o => (
                      <button key={o} onClick={() => { setFilterBudget(o); setOpenFilter(null); doSubmit(answers, { budget: o, when: filterWhen, crew: filterCrew }) }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors ${filterBudget === o ? 'text-yd-orange font-semibold' : 'text-white/70'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Crew */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setOpenFilter(openFilter === 'crew' ? null : 'crew')}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${filterCrew ? 'bg-yd-orange/20 border-yd-orange/60 text-yd-orange font-semibold' : 'border-white/15 text-white/45 hover:border-white/30 hover:text-white/70'}`}
                >
                  👥 {filterCrew || 'Crew'}
                </button>
                {openFilter === 'crew' && (
                  <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[155px] overflow-hidden">
                    {filterCrew && (
                      <button onClick={() => { setFilterCrew(''); setOpenFilter(null); doSubmit(answers, { crew: '', when: filterWhen, budget: filterBudget }) }}
                        className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                        ✕ Any crew
                      </button>
                    )}
                    {['Just me', 'Date Night', 'Small group', 'The whole squad'].map(o => (
                      <button key={o} onClick={() => { setFilterCrew(o); setOpenFilter(null); doSubmit(answers, { crew: o, when: filterWhen, budget: filterBudget }) }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors ${filterCrew === o ? 'text-yd-orange font-semibold' : 'text-white/70'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                    <div className="absolute inset-0">
                      <CategoryPlaceholder category={pick.category || ''} />
                    </div>
                    {pick.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pick.imageUrl}
                        alt={pick.title}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
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
                    <span className="text-xs text-white/50 block truncate overflow-hidden whitespace-nowraw max-w-[200px]">{pick.venue}</span>
                    <span className="text-xs text-white/40 block">{pick.dateFormatted} &middot; {pick.priceFormatted}</span>
                    {pick.distanceLabel && (
                      <span className="text-xs text-[#4f9b85]/80 block">📍 {pick.distanceLabel}</span>
                    )}
                    <span className="text-xs text-white/40 block italic">{pick.pitch}</span>
                    <div className="flex gap-2 mt-1">
                      {pick.source === 'activity' && <span className="bg-emerald-500/20 text-emerald-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">🏃 Activity</span>}
                      {pick.source === 'facebook' && <span className="bg-blue-600/20 text-blue-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">📘 Facebook</span>}
                      {pick.ticketUrl && (
                        <a href={pick.ticketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[#4f9b85] hover:text-[#3d8372] transition-colors"
                          onClick={() => capture('ticket_clicked', { event_id: pick.id, title: pick.title, city, rank: pick.rank })}
                        >
                          Let&apos;s go →
                        </a>
                      )}
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

            {/* Survey history consent banner */}
            {showHistConsent && (
              <div className="mt-3 bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white text-sm font-semibold mb-1">💾 Remember my picks for next time?</p>
                <p className="text-white/40 text-xs mb-3">
                  We keep the results private either way — but would you like us to log this in our records so we can remind you what you chose last time, or even two times ago?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      try { localStorage.setItem('yd_hist_consent', 'true') } catch { /* */ }
                      saveToHistory(answers)
                      setShowHistConsent(false)
                    }}
                    className="flex-1 bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    Yes, keep it private
                  </button>
                  <button
                    onClick={() => {
                      try { localStorage.setItem('yd_hist_consent', 'false') } catch { /* */ }
                      setShowHistConsent(false)
                    }}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/50 text-xs py-2 rounded-lg transition-colors"
                  >
                    No thanks
                  </button>
                </div>
              </div>
            )}

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

        {/* ── Empty ────────────────────────────────────────────────────────── */}
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
