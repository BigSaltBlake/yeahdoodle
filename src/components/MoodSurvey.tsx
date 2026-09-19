'use client'
// v2 â€” Groups A/B/C: energy slider, 5 timeframes, crew split, group-size Q, budget labels, return-visit history
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
  layout?: 'chips' | 'buttons'
  conditional?: boolean
}

// ---------------------------------------------------------------------------
// Questions â€” action-first: Go ___ taxonomy â†’ kill switch (2 questions)
// Q1 uses compact chip layout; Q2 uses full button cards
// ---------------------------------------------------------------------------
const ALL_QUESTIONS: Question[] = [
  {
    id: 'feeling',
    question: "What do you want to do?",
    subtitle: 'Go with your gut',
    layout: 'chips',
    options: [
      { label: 'Go eat',     desc: '', emoji: 'ğŸ½ï¸', quality: 'Food & drink'  },
      { label: 'Go listen',  desc: '', emoji: 'ğŸµ', quality: 'Live music'    },
      { label: 'Go out',     desc: '', emoji: 'ğŸ¥‚', quality: 'Nightlife'     },
      { label: 'Go move',    desc: '', emoji: 'âš¡', quality: 'Active'        },
      { label: 'Go see',     desc: '', emoji: 'ğŸ­', quality: 'Shows & arts'  },
      { label: 'Go explore', desc: '', emoji: 'ğŸŒ†', quality: 'Discovery'     },
      { label: 'Go play',    desc: '', emoji: 'ğŸ²', quality: 'Games'         },
    ],
  },
  {
    id: 'killswitch',
    question: "What's off the table?",
    subtitle: "Pick your one dealbreaker",
    layout: 'chips',
    options: [
      { label: 'Breaking the bank',    desc: '', emoji: 'ğŸ’¸', quality: 'Budget-sensitive' },
      { label: 'Massive crowds',        desc: '', emoji: 'ğŸ˜µ', quality: 'Avoid crowds'    },
      { label: 'Needs a reservation',   desc: '', emoji: 'ğŸ“‹', quality: 'Spontaneous'     },
      { label: "Can't move around",     desc: '', emoji: 'ğŸª‘', quality: 'Stay active'     },
    ],
  },
]

const LOADING_MESSAGES = [
  'Scanning events near you...',
  'Matching your vibe...',
  'Finding hidden gems...',
  'Picking your top 3...',
]

const MEDALS = ['ğŸ¥‡', 'ğŸ¥ˆ', 'ğŸ¥‰']

type Phase = 'locating' | 'city' | 'returning' | 'question' | 'loading' | 'results' | 'empty' | 'yeahdoodle'
type EmailState = 'idle' | 'loading' | 'done' | 'error'
type FeedbackRating = 'up' | 'meh' | 'down'
type PickDecision = 'rejected' | 'maybe' | 'yeahdoodle'
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
  const [refineStep, setRefineStep]     = useState<'when' | 'crew' | 'done' | null>(null)
  const cancelGps = useRef(false)
  const touchStartX = useRef<number | null>(null)
  const [decisions, setDecisions] = useState<Record<string, PickDecision>>({})
  const [yeadoodlePick, setYeadoodlePick] = useState<Pick | null>(null)
  const [committed, setCommitted] = useState(false)

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const activeQuestions = ALL_QUESTIONS
  const visiblePicks = picks.filter(p => decisions[p.id] !== 'rejected')

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

    // Modal just opened â€” check localStorage for return-visit history
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

  // Trigger conversational refinement steps after results load
  useEffect(() => {
    if (phase !== 'results') return
    setRefineStep(null)
    const t = setTimeout(() => setRefineStep('when'), 400)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function rejectPich(pick: Pick) {
    setDecisions(prev => ({ ...prev, [pick.id]: 'rejected' }))
    submitFeedback(pick, 'down')
    capture('pick_rejected', { event_id: pick.id, title: pick.title, city })
  }

  function maybePich(pick: Pick) {
    setDecisions(prev => ({ ...prev, [pick.id]: 'maybe' }))
    submitFeedback(pick, 'meh')
    capture('pick_maybe', { event_id: pick.id, title: pick.title, city })
  }

  function yeahDoodlePick(pick: Pick) {
    setDecisions(prev => ({ ...prev, [pick.id]: 'yeahdoodle' }))
    submitFeedback(pick, 'up')
    saveEvent(pick, 'definitely_going')
    setYeadoodlePick(pick)
    setCommitted(false)
    setPhase('yeahdoodle')
    capture('yeah_doodle', { event_id: pick.id, title: pick.title, city })
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
  }

  function handleTouchEnd(e: React.TouchEvent, pick: Pick) {
    if (touchStartX.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) > 70) {
      if (dx < 0) rejectPick(pick)
      else yeahDoodlePick(pick)
    }
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
      const data = await res.json().catch(() => ({ picks: [] }))
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
    setRefineStep(null)
    setDecisions({})
    setYeadoodlePick(null)
    setCommitted(false)
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
      navigator.share({ title: 'Stop scrolling. Go live. ğŸ‘‰', text: `Found something worth doing${city ? ` in ${city}` : ' near me'} through YeahDoodle`, url })
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
           âœ•
        </button>

        {/* tilta Locating â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'locating' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6">ğŸ“Í</div>
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

        {/* tilta City entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">ğŸ</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">2 quick questions â†’ your 3 best picks</p>
            <input
              autoFocus
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && city.trim()) { capture('city_selected', { city }); setPhase(hasReturnHistory ? 'returning' : 'question') } }}
              placeholder="What city are you in?"
              className="w-full px-4 py-3 rounded-xl bg-yİ¡¥Ñ”¼ÄÀÑ•áĞµİ¡¥Ñ”Á±…•¡½±‘•Èµİ¡¥Ñ”¼ÌÀ‰½É‘•È‰½É‘•Èµİ¡¥Ñ”¼ÈÀ™½ÕÌé½ÕÑ±¥¹”µ¹½¹”™½ÕÌé‰½É‘•Èµåµ½É…¹”µˆ´ĞÑ•áĞµ‰…Í”ˆ(€€€€€€€€€€€€¼ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì¥˜€¡¥Ñä¹ÑÉ¥´ ¤¤ì…ÁÑÕÉ” ¥Ñå}Í•±•Ñ•œ°ì¥Ñäô¤ìÍ•ÑA¡…Í”¡¡…ÍI•ÑÕÉ¹!¥ÍÑ½Éä€ü€É•ÑÕÉ¹¥¹œœ€è€ÅÕ•ÍÑ¥½¸œ¤ôõô(€€€€€€€€€€€€€‘¥Í…‰±•õì…¥Ñä¹ÑÉ¥´ ¥ô(€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±°‰œµåµ½É…¹”¡½Ù•Èé‰œµåµ½É…¹•!½Ù•È‘¥Í…‰±•é½Á…¥Ñä´ĞÀ‘¥Í…‰±•éÕÉÍ½Èµ¹½Ğµ…±±½İ•Ñ•áĞµİ¡¥Ñ”™½¹Ğµ‰½±Áä´Ì¸ÔÉ½Õ¹‘•µá°ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌÑ•áĞµÍ´ˆ(€€€€€€€€€€€€ø(€€€€€€€€€€€€€1•Ğ™…Á½ÌíÌ¼ƒŠH(€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€¥ô((€€€€€€€ì¼¨Ñ¥±Ñ„I•ÑUÉ¸Ù¥Í¥ĞƒŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠRŠR €¨½ô(€€€€€€€íÁ¡…Í”€ôôô€É•ÑÕÉ¹¥¹œœ€˜˜±…ÍÑ¹Íİ•ÉÌ€˜˜€ (€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰À´Øˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áĞµ•¹Ñ•Èµˆ´Ôˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ•áĞ´Ñá°µˆ´ÌˆûÂ~F,ğ½‘¥Øø(€€€€€€€€€€€€€€ñ È±…ÍÍ9…µ”ô‰™½¹Ğµ‘¥ÍÁ±…äÑ•áĞµá°Ñ•áĞµİ¡¥Ñ”µˆ´Èˆù]•±½µ”‰…¬„ğ½ Èø(€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áĞµİ¡¥Ñ”¼ÔÀÑ•áĞµÍ´ˆùM…µ”Ù¥‰”…Ì±…ÍĞÑ¥µ”½Èİ½Õ±å½Ô±¥­”Ñ¼¡…¹”¥ĞÕÀ„‰¥Ğüğ½Àø(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÍÁ…”µä´È¸Ôˆø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø‘½MÕ‰µ¥Ğ¡±…ÍÑ¹Íİ•ÉÌ¥ô(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È…À´ÌÀ´Ì¸ÔÉ½Õ¹‘•µá°‰½É‘•È‰½É‘•Èµåµ½É…¹”¼ĞÀ¡½Ù•Èé‰½É‘•Èµåµ½É…¹”‰œµåµ½É…¹”¼ÄÀÑ•áĞµ±•™ĞÑÉ…¹Í¥Ñ¥½¸µ…±°É½ÕÀˆ(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áĞ´Éá°Í¡É¥¹¬´ÀˆûÂ~Rğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™±•à´Äµ¥¸µÜ´Àˆø(€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™½¹ĞµÍ•µ¥‰½±Ñ•áĞµİ¡¥Ñ”Ñ•áĞµÍ´µˆ´À¸ÔˆùM…µ”Ù¥‰”ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰Ñ•áĞµİ¡¥Ñ”¼ĞÀÑ•áĞµáÌÉ½ÕÀµ¡½Ù•ÈéÑ•áĞµİ¡¥Ñ”¼ØÀÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌˆùUÍ”µä…¹Íİ•ÉÌ™É½´±…ÍĞÑ¥µ”ğ½Àø(€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Ñ•áĞµåµ½É…¹”¼ØÀÉ½ÕÀµ¡½Ù•ÈéÑ•áĞµåµ½É…¹”ÑÉ…¹Í¥Ñ¥½¸µ½±½ÉÌÍ¡É¥¹¬´ÀˆûŠHğ½ÍÁ…¸ø(€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøìÍ•ÑE%¹‘•à À¤ìÍ•Ñ¹Íİ•ÉÌ¡mt¤ìÍ•ÑA¡…Í” ÅÕ•ÍÑ¥½¸œ¤õô(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Üµ™Õ±°™±•à¥Ñ•µÌµ•¹Ñ•È…À´ÌÀ´Ì¸ÔÉ½Õ¹‘•µá°‰½É‘•È‰½É‘•Èµİ¡¥Ñ”¼ÄÀ¡½Ù•Èé‰½É‘•Èµİ¡¥Ñ”¼ÈÔ¡½Ù•Èé‰œµçv†—FRóRFW‡BÖÆVgBG&ç6—F–öâÖÆÂw&÷W ¢à¢Ç7â6Æ74æÖSÒ'FW‡BÓ'†Â6‡&–æ²Ó#î)ÊƒÂ÷7ãà¢ÆF—b6Æ74æÖSÒ&fÆW‚ÓÖ–â×rÓ#à¢ÆF—b6Æ74æÖSÒ&föçB×6VÖ–&öÆBFW‡B×v†—FRFW‡B×6ÒÖ"ÓãR#ä6†ævR—BWÂöF—cà¢Ç6Æ74æÖSÒ'FW‡B×v†—FRóCFW‡B×‡2w&÷WÖ†÷fW#§FW‡B×v†—FRócG&ç6—F–öâÖ6öÆ÷'2#å7F'Bg&W6‚v—F‚æWrç7vW'3Â÷à¢ÂöF—cà¢Ç7â6Æ74æÖSÒ'FW‡B×v†—FRó#w&÷WÖ†÷fW#§FW‡B×v†—FRóSG&ç6—F–öâÖ6öÆ÷'26‡&–æ²Ó#î(i#Â÷7ãà¢Âö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢—Ğ ¢²ò¢F–ÇFVW7F–öç2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H¢÷Ğ¢·†6RÓÓÒwVW7F–öârbb7W'&VçEbb€¢ÆF—b6Æ74æÖS×¶ÓbG&ç6—F–öâÖ÷6—G’GW&F–öâÓSG¶æ–ÖF–æròv÷6—G’ÓG&ç6ÆFR×’Ór¢v÷6—G’ÓG&ç6ÆFR×’ÓwÖÓà ¢²ò¢&öw&W72¢÷Ğ¢ÆF—b6Æ74æÖSÒ&fÆW‚vÓãRÖ"ÓR#à¢¶7F—fUVW7F–öç2æÖ‚…òÂ’’Óâ€¢ÆF—`¢¶W“×¶—Ğ¢6Æ74æÖS×¶‚ÓfÆW‚Ó&÷VæFVBÖgVÆÂG&ç6—F–öâÖÆÂGW&F–öâÓ3G¶’ÃÒ–æFW‚òv&r×–BÖ÷&ævRr¢v&r×v†—FRówÖĞ¢óà¢’—Ğ¢ÂöF—cà ¢Ç6Æ74æÖSÒ'FW‡B×v†—FRó3FW‡B×‡2Ö"ÓãR#åVW7F–öâ·–æFW‚²Òöb¶7F—fUVW7F–öç2æÆVæwF‡ÓÂ÷à¢Æƒ"6Æ74æÖSÒ&föçBÖF—7Æ’FW‡B×†ÂFW‡B×v†—FRÖ"Ó#ç¶7W'&VçEçVW7F–öçÓÂöƒ#à¢¶7W'&VçEç7V'F—FÆP¢òÇ6Æ74æÖSÒ'FW‡B×v†—FRóCFW‡B×6ÒÖ"ÓR#ç¶7W'&VçEç7V'F—FÆWÓÂ÷à¢¢ÆF—b6Æ74æÖSÒ&Ö"ÓR"óà¢Ğ ¢²†6—G’ÇÂÆB’bb€¢ÆF—b6Æ74æÖSÒ&fÆW‚—FV×2Ö6VçFW"vÓãRÖ"ÓBÖ×BÓ"#à¢Ç7â6Æ74æÖSÒ'FW‡B×‡2FW‡B×v†—FRó3#ï	ù<ÓÂ÷7ãà¢Ç7â6Æ74æÖSÒ'FW‡B×‡2FW‡B×v†—FRó3#ç¶6—G’ÇÂw–÷W"Æö6F–öâwÓÂ÷7ãà¢²ÆBbb€¢Æ'WGFöà¢öä6Æ–6³×²‚’Óâ6WE†6R‚v6—G’r—Ğ¢6Æ74æÖSÒ'FW‡B×‡2FW‡B×v†—FRó#†÷fW#§FW‡B×v†—FRóSVæFW&Æ–æRVæFW&Æ–æRÖöfg6WBÓ"G&ç6—F–öâÖ6öÆ÷'2ÖÂÓ ¢à¢6†ævP¢Âö'WGFöãà¢—Ğ¢ÂöF—cà¢—Ğ ¢²ò¢F–ÇF6†—Æ–÷WB†6ö×7Bw&–B(	BW6VBf÷"vòõõòF†öæö×’’)H)H¢÷Ğ¢²7W'&VçEç7V6–Âbb7W'&VçEæÆ–÷WBÓÓÒv6†—2rbb€¢ÆF—b6Æ74æÖSÒ&w&–Bw&–BÖ1d grid-cols-2 gap-2">
                {currentQ.options.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => handleAnswer(opt.label)}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-white/10 hover:border-yd-orange/60 hover:bg-yd-orange/5 text-left transition-all group"
                  >
                    <span className="text-xl shrink-0">{opt.emoji}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-white text-sm leading-tight">{opt.label}</div>
                      {opt.desc && <p className="text-white/35 text-[11px] group-hover:text-white/55 transition-colors leading-tight mt-0.5 line-clamp-1">{opt.desc}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* â”€â”€ Standard option buttons (full cards â€” used for kill switch) â”€â”€ */}
            {!currentQ.special && !currentQ.layout && (
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
                      </div>
                      <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors">{opt.desc}</p>
                    </div>
                    <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">â†’</span>
                  </button>
                ))}
              </div>
            )}

            {qIndex > 0 && (
              <button
                onClick={() => { setQIndex(i => i - 1); setAnswers(a => a.slice(0, -1)) }}
                className="mt-4 text-white/25 hover:text-white/50 text-xs transition-colors"
              >
                â† Back
              </button>
            )}
          </div>
        )}

        {/* â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">ğŸ¯</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-[1.25rem] transition-all duration-300">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        )}

        {/* â”€â”€ Results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-3">
              <h2 className="font-display text-xl text-white">Your picks</h2>
              <p className="text-white/30 text-xs mt-0.5">
                {lat ? `ğŸ“ near you` : `in ${city}`}
              </p>
            </div>

            {/* â”€â”€ Conversational refinement â†’ chips after done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}

            {/* Step 1: When */}
            {refineStep === 'when' && (
              <div className="mb-3">
                <p className="text-white/40 text-xs mb-2">ğŸ“… When are you thinking?</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Right now', 'This weekend', 'Next week', 'No rush'].map(label => {
                    const val = label === 'Right now' ? 'Now' : label === 'No rush' ? '' : label
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          setFilterWhen(val)
                          if (val) doSubmit(answers, { when: val, budget: filterBudget, crew: filterCrew })
                          setRefineStep('crew')
                        }}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:border-yd-orange/60 hover:bg-yd-orange/10 hover:text-white transition-all"
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Crew */}
            {refineStep === 'crew' && (
              <div className="mb-3">
                <p className="text-white/40 text-xs mb-2">ğŸ‘¥ Who&apos;s going?</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Just me', 'Date night', 'Small group', 'The whole squad'].map(o => (
                    <button
                      key={o}
                      onClick={() => {
                        setFilterCrew(o)
                        doSubmit(answers, { crew: o, when: filterWhen, budget: filterBudget })
                        setRefineStep('done')
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border border-white/20 text-white/70 hover:border-yd-orange/60 hover:bg-yd-orange/10 hover:text-white transition-all"
                    >
                      {o}
                    </button>
                  ))}
                  <button
                    onClick={() => setRefineStep('done')}
                    className="px-3 py-1.5 rounded-full text-xs border border-white/10 text-white/30 hover:text-white/50 transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {/* Chips â€” shown after refinement done, or for further tweaking */}
            {refineStep === 'done' && (
              <div className="flex flex-wrap gap-1.5 mb-3" onClick={() => setOpenFilter(null)}>
                {/* When */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setOpenFilter(openFilter === 'when' ? null : 'when')}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${filterWhen ? 'bg-yd-orange/20 border-yd-orange/60 text-yd-orange font-semibold' : 'border-white/15 text-white/45 hover:border-white/30 hover:text-white/70'}`}
                  >
                    ğŸ“… {filterWhen || 'When'}
                  </button>
                  {openFilter === 'when' && (
                    <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[150px] overflow-hidden">
                      {filterWhen && (
                        <button onClick={() => { setFilterWhen(''); setOpenFilter(null); doSubmit(answers, { when: '', budget: filterBudget, crew: filterCrew }) }}
                          className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                          âœ• Any time
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
                    ğŸ’° {filterBudget || 'Budget'}
                  </button>
                  {openFilter === 'budget' && (
                    <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[150px] overflow-hidden">
                      {filterBudget && (
                        <button onClick={() => { setFilterBudget(''); setOpenFilter(null); doSubmit(answers, { budget: '', when: filterWhen, crew: filterCrew }) }}
                          className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                          âœ• Any budget
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
                    ğŸ‘¥ {filterCrew || 'Crew'}
                  </button>
                  {openFilter === 'crew' && (
                    <div className="absolute left-0 top-full mt-1 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-30 min-w-[155px] overflow-hidden">
                      {filterCrew && (
                        <button onClick={() => { setFilterCrew(''); setOpenFilter(null); doSubmit(answers, { crew: '', when: filterWhen, budget: filterBudget }) }}
                          className="w-full text-left px-3 py-2 text-xs text-white/40 hover:bg-white/10 border-b border-white/10 transition-colors">
                          âœ• Any crew
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
            )}

            {/* Saved count + sign-in nudge */}
            {Object.keys(saved).length > 0 && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-white/50">â¤ï¸ {Object.keys(saved).length} saved</span>
                <a href="/saved" className="text-xs text-[#4f9b85] hover:text-[#3d8372] transition-colors">View saved â†’</a>
              </div>
            )}
            {showSignInNudge && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-2 text-xs">
                <span className="text-white/60">Sign in to access your saved events on any device</span>
                <a href="/auth" className="text-[#4f9b85] hover:underline ml-2 shrink-0">Sign in</a>
              </div>
            )}

            {visiblePicks.length === 0 && picks.length > 0 && (
              <div className="text-center py-10">
                <p className="text-white/40 text-sm mb-3">Nothing grabbed you?</p>
                <button onClick={handleReset} className="text-yd-orange text-sm hover:underline">â†© Try different answers</button>
              </div>
            )}

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {visiblePicks.map((pick) => {
                const i = picks.indexOf(pick)
                return (
                <div key={pick.id}
                  className="bg-yd-bg/60 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all"
                  onClick={() => setHeartOpen(null)}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={(e) => handleTouchEnd(e, pick)}
                >
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
                        {saved[pick.id] ? 'â¤ï¸' : 'ğŸ¤'}
                      </button>
                      {heartOpen === pick.id && (
                        <div className="absolute right-0 top-8 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-20 w-44 overflow-hidden">
                          {saved[pick.id] ? (
                            <button onClick={() => unsaveEvent(pick)} className="w-full text-left px-3 py-2.5 text-xs text-white/70 hover:bg-white/10 transition-colors">
                              ğŸ—‘ï¸ Remove from saved
                            </button>
                          ) : (
                            <>
                              <button onClick={() => saveEvent(pick, 'save_for_later')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors border-b border-white/10">
                                ğŸ”– Save for later
                              </button>
                              <button onClick={() => saveEvent(pick, 'definitely_going')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                                ğŸ¯ Definitely going
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
                      <span className="text-xs text-[#4f9b85]/80 block">ğŸ“ {pick.distanceLabel}</span>
                    )}
                    <span className="text-xs text-white/40 block italic">{pick.pitch}</span>
                    <div className="flex gap-2 mt-1">
                      {pick.source === 'activity' && <span className="bg-emerald-500/20 text-emerald-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">ğŸƒ Activity</span>}
                      {pick.source === 'facebook' && <span className="bg-blue-600/20 text-blue-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">ğŸ“˜ Facebook</span>}
                      {pick.ticketUrl && (
                        <a href={pick.ticketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[#4f9b85] hover:text-[#3d8372] transition-colors"
                          onClick={() => capture('ticket_clicked', { event_id: pick.id, title: pick.title, city, rank: pick.rank })}
                        >
                          Let&apos;s go â†’
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Decision row */}
                  <div className="flex border-t border-white/10 mt-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); rejectPick(pick) }}
                      className="flex-1 py-2.5 text-xs text-white/35 hover:text-red-400/80 hover:bg-red-500/5 transition-colors rounded-bl-xl"
                    >
                      âœ• Not feeling it
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); maybePick(pick) }}
                      className={`flex-1 py-2.5 text-xs border-x border-white/10 transition-colors ${
                        decisions[pick.id] === 'maybe'
                          ? 'text-white/60 bg-white/5'
                          : 'text-white/35 hover:text-white/60 hover:bg-white/5'
                      }`}
                    >
                      {decisions[pick.id] === 'maybe' ? 'ã€œ Maybe' : 'ã€œ Could work'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); yeahDoodlePick(pick) }}
                      className="flex-1 py-2.5 text-xs font-bold text-yd-orange hover:bg-yd-orange/10 transition-colors rounded-br-xl"
                    >
                      Yeah Doodle! â†’
                    </button>
                  </div>
                </div>
                )
              })}
            </div>

            {/* Survey history consent banner */}
            {showHistConsent && (
              <div className="mt-3 bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white text-sm font-semibold mb-1">ğŸ’¾ Remember my picks for next time?</p>
                <p className="text-white/40 text-xs mb-3">
                  We keep the results private either way â€” but would you like us to log this in our records so we can remind you what you chose last time, or even two times ago?
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
                  âœ… You&apos;re in! We&apos;ll send weekly picks to your inbox.
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
                    <p className="text-red-400/80 text-xs mt-1.5">Something went wrong â€” try again.</p>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {copied ? 'âœ… Link copied!' : 'ğŸ”— Share my picks'}
              </button>
              <div className="flex items-center justify-between">
                <button
                  onClick={handleReset}
                  className="text-white/25 hover:text-white/55 text-xs transition-colors"
                >
                  â†© Try different answers
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

        {/* â”€â”€ Yeah Doodle! commitment screen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'yeahdoodle' && yeadoodlePick && (
          <div className="p-5 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setPhase('results')}
              className="flex items-center gap-1.5 text-white/35 hover:text-white/65 text-xs mb-4 transition-colors"
            >
              â† Back to picks
            </button>

            {/* Hero image */}
            <div className="relative w-full h-44 rounded-xl overflow-hidden mb-4">
              <div className="absolute inset-0">
                <CategoryPlaceholder category={yeadoodlePick.category || ''} />
              </div>
              {yeadoodlePick.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={yeadoodlePick.imageUrl}
                  alt={yeadoodlePick.title}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <p className="text-yd-orange text-[11px] font-bold uppercase tracking-wider mb-1">ğŸ‰ Yeah Doodle!</p>
                <h2 className="font-display text-lg text-white leading-tight">{yeadoodlePick.title}</h2>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-1.5 mb-4">
              {yeadoodlePick.venue && (
                <div className="flex items-center gap-2 text-sm text-white/65">
                  <span>ğŸ“</span><span>{yeadoodlePick.venue}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-white/65">
                <span>ğŸ“…</span><span>{yeadoodlePick.dateFormatted}</span>
              </div>
              {yeadoodlePick.priceFormatted && (
                <div className="flex items-center gap-2 text-sm text-white/65">
                  <span>ğŸ’°</span><span>{yeadoodlePick.priceFormatted}</span>
                </div>
              )}
              {yeadoodlePick.distanceLabel && (
                <div className="flex items-center gap-2 text-sm text-[#4f9b85]">
                  <span>ğŸ—ºï¸</span><span>{yeadoodlePick.distanceLabel}</span>
                </div>
              )}
            </div>

            {/* AI pitch */}
            {yeadoodlePick.pitch && (
              <div className="bg-white/5 rounded-xl p-3.5 mb-5 border border-white/10">
                <p className="text-white/75 text-sm italic leading-relaxed">&ldquo;{yeadoodlePick.pitch}&rdquo;</p>
              </div>
            )}

            {/* Primary CTA */}
            <button
              onClick={() => { setCommitted(true); capture('commitment_confirmed', { event_id: yeadoodlePick.id, city }) }}
              className={`w-full font-bold py-4 rounded-xl text-base transition-all mb-2.5 flex items-center justify-center gap-2 ${
                committed
                  ? 'bg-green-600/25 border border-green-500/40 text-green-400 cursor-default'
                  : 'bg-yd-orange hover:bg-yd-orangeHover text-white'
              }`}
            >
              {committed ? 'âœ… You\'re going!' : 'ğŸ”’ Lock it in'}
            </button>

            {/* Secondary actions */}
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent((yeadoodlePick.venue || '') + (city ? ` ${city}` : ''))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/65 hover:text-white text-sm py-3 rounded-xl transition-colors border border-white/10"
              >
                ğŸ—ºï¸ Directions
              </a>
              {yeadoodlePick.ticketUrl ? (
                <a
                  href={yeadoodlePick.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/65 hover:text-white text-sm py-3 rounded-xl transition-colors border border-white/10"
                  onClick={() => capture('ticket_clicked', { event_id: yeadoodlePick.id, title: yeadoodlePick.title, city, rank: yeadoodlePick.rank })}
                >
                  ğŸŸï¸ Get tickets
                </a>
              ) : (
                <button
                  onClick={handleShare}
                  className="flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/65 hover:text-white text-sm py-3 rounded-xl transition-colors border border-white/10"
                >
                  ğŸ“¤ Share
                </button>
              )}
            </div>

            {/* Add to calendar */}
            <button
              onClick={() => {
                const t = encodeURIComponent(yeadoodlePick.title)
                const d = encodeURIComponent((yeadoodlePick.pitch || '') + '\n\nFound on YeahDoodle')
                const l = encodeURIComponent((yeadoodlePick.venue || '') + (city ? `, ${city}` : ''))
                window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${t}&details=${d}&location=${l}`, '_blank')
                capture('calendar_added', { event_id: yeadoodlePick.id, city })
              }}
              className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white/45 hover:text-white/70 text-sm py-3 rounded-xl transition-colors border border-white/10"
            >
              ğŸ“† Add to calendar
            </button>

            {Object.keys(saved).length > 0 && (
              <p className="text-center text-white/25 text-xs mt-4">
                Saved to <a href="/saved" className="text-[#4f9b85] hover:underline transition-colors">your events</a>
              </p>
            )}
          </div>
        )}

        {/* â”€â”€ Empty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {phase === 'empty' && (
          <div className="p-8 text-center py-14">
            <div className="text-4xl mb-4">ğŸ¤·</div>
            <h2 className="font-display text-xl text-white mb-2">Nothing matched right now</h2>
            <p className="text-white/40 text-sm mb-6">
              Try a different city or check back soon â€” events update daily.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                â† Try again
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
