'use client'
// v2-bust=1786662472673

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
// All questions Ã¢ÂÂ group-size is conditional (shown only for groups)
// ---------------------------------------------------------------------------
const ALL_QUESTIONS: Question[] = [
  {
    id: 'when',
    question: 'When are you planning this?',
    subtitle: '',
    options: [
      { label: 'Now',            desc: "Let's make something happen right now",          emoji: 'Ã¢ÂÂ¡', quality: 'Spontaneous'   },
      { label: 'Soon',           desc: 'This weekend Ã¢ÂÂ Friday through Sunday',           emoji: 'Ã°ÂÂÂ', quality: 'Weekend'        },
      { label: 'Next Week',      desc: 'Lining something up for next week',              emoji: 'Ã°ÂÂÂÃ¯Â¸Â', quality: 'Coming up'      },
      { label: 'Planning Ahead', desc: 'Looking out a few weeks or more',               emoji: 'Ã°ÂÂÂ', quality: 'Looking ahead'  },
      { label: 'Planning a Trip',desc: "I'm traveling and want to plan ahead",           emoji: 'Ã¢ÂÂÃ¯Â¸Â', quality: 'Trip planning'  },
    ],
  },
  {
    id: 'energy',
    question: "What's your energy?",
    subtitle: 'Slide to set your vibe Ã¢ÂÂ drag to pick a range',
    special: 'energy-slider',
    options: [],
  },
  {
    id: 'crew',
    question: "Who's your crew?",
    subtitle: '',
    options: [
      { label: 'Just me',        desc: "Solo mission Ã¢ÂÂ flying solo tonight",              emoji: 'Ã°ÂÂ§Â', quality: 'Solo'         },
      { label: 'Date Night',     desc: 'Me and my person Ã¢ÂÂ just the two of us',          emoji: 'Ã°ÂÂÂ', quality: 'Couple'       },
      { label: 'Small group',    desc: 'A few close friends or fam',                     emoji: 'Ã°ÂÂÂ¯', quality: 'Social'       },
      { label: 'The whole squad',desc: "Big group energy, everyone's coming",            emoji: 'Ã°ÂÂÂ', quality: 'Party mode'   },
    ],
  },
  {
    id: 'group-size',
    question: 'Roughly how many people?',
    subtitle: '',
    conditional: true,
    options: [
      { label: '2Ã¢ÂÂ4',  desc: 'Small and close-knit',    emoji: 'Ã°ÂÂÂ¥', quality: 'Intimate'  },
      { label: '5Ã¢ÂÂ8',  desc: 'A solid crew',            emoji: 'Ã°ÂÂÂ«', quality: 'Medium'    },
      { label: '9Ã¢ÂÂ15', desc: 'Getting bigger!',         emoji: 'Ã°ÂÂÂ', quality: 'Large'     },
      { label: '16+',  desc: "It's a full-on party",   emoji: 'Ã°ÂÂÂ', quality: 'Big group' },
    ],
  },
  {
    id: 'experience',
    question: 'What sounds good?',
    subtitle: 'Go with your gut',
    options: [
      { label: 'Live music or show',      desc: 'Something to watch and feel',          emoji: 'Ã°ÂÂÂµ', quality: 'Entertainment' },
      { label: 'Food & drinks',           desc: 'Good eats, good drinks, good company', emoji: 'Ã°ÂÂÂ', quality: 'Chill'         },
      { label: 'One-of-a-kind experience',desc: "Something I've never done before",    emoji: 'Ã¢ÂÂ¨', quality: 'Unique'        },
    ],
  },
  {
    id: 'scene',
    question: "What's the scene?",
    subtitle: 'Pick the vibe that fits',
    options: [
      { label: 'Small & intimate', desc: 'Real atmosphere, you can actually talk',       emoji: 'Ã°ÂÂÂ¡', quality: 'Cozy'   },
      { label: 'Buzzing & social', desc: 'Medium energy, meeting-people kind of night',  emoji: 'Ã°ÂÂÂ»', quality: 'Social' },
      { label: 'Big & electric',   desc: "Massive crowd, everyone's there for it",      emoji: 'Ã°ÂÂÂ', quality: 'Epic'   },
    ],
  },
  {
    id: 'budget',
    question: "What's your budget?",
    subtitle: '',
    special: 'budget',
    options: [
      { label: 'Free',            desc: 'Free fun is real fun',                    emoji: 'Ã°ÂÂÂ', quality: 'Good',   perPerson: 0,    forCouple: 0    },
      { label: '$25 or so',       desc: 'A little spend for a good time',          emoji: 'Ã°ÂÂÂ', quality: 'Better', perPerson: 25,   forCouple: 50   },
      { label: 'Around $50',      desc: 'Worth it for the right experience',       emoji: 'Ã°ÂÂ§Â¡', quality: 'Great',  perPerson: 50,   forCouple: 100  },
      { label: "Sky's the Limit", desc: 'The experience is what matters',          emoji: 'Ã°ÂÂÂ', quality: 'Best',   perPerson: null, forCouple: null },
    ],
  },
]

const LOADING_MESSAGES = [
  'Scanning events near you...',
  'Matching your vibe...',
  'Finding hidden gems...',
  'Picking your top 3...',
]

const MEDALS = ['Ã°ÂÂ¥Â', 'Ã°ÂÂ¥Â', 'Ã°ÂÂ¥Â']

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
  const [energyMin, setEnergyMin] = useState(5)
  const [energyMax, setEnergyMax] = useState(5)
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
  const cancelGps = useRef(false)
  const sliderRef = useRef<HTMLDivElement>(null)
  const activeDragRef = useRef<'min' | 'max' | null>(null)

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const crewAnswer = answers[2] ?? ''
  const showGroupSize = crewAnswer === 'Small group' || crewAnswer === 'The whole squad'
  const isCouple = crewAnswer === 'Date Night'
  const activeQuestions = ALL_QUESTIONS.filter(q => !q.conditional || showGroupSize)

  const isAnyEnergy = energyMin === 1 && energyMax === 10
  const isSingleEnergy = energyMin === energyMax
  const energyLabel = isAnyEnergy ? 'Any energy Ã°ÂÂÂ²' : isSingleEnergy ? `${energyMin}` : `${energyMin}Ã¢ÂÂ${energyMax}`
  const energyQuality = isAnyEnergy ? 'Any level' : isSingleEnergy && energyMin <= 3 ? 'Low Key' : isSingleEnergy && energyMin >= 8 ? 'Wild' : isSingleEnergy && energyMin >= 6 ? 'High energy' : isSingleEnergy ? 'Moderate' : 'Range'
  const energyDesc = isAnyEnergy
    ? 'Open to anything Ã¢ÂÂ surprise me'
    : isSingleEnergy && energyMin <= 3 ? 'Low key, easy, familiar'
    : isSingleEnergy && energyMin <= 6 ? 'Somewhere in the middle'
    : isSingleEnergy ? 'High energy, adventurous'
    : energyMax - energyMin >= 7 ? "Pretty open Ã¢ÂÂ give me something good"
    : energyMax <= 4 ? 'Low to moderate energy'
    : energyMin >= 6 ? 'Medium-high to high energy'
    : 'Somewhere in the middle'

  const minFrac = (energyMin - 1) / 9
  const maxFrac = (energyMax - 1) / 9

  const timeframeDisplay = (() => {
    const tf = answers[0] ?? ''
    if (tf === 'Now')              return 'tonight'
    if (tf === 'Soon')             return 'this weekend'
    if (tf === 'Next Week')        return 'next week'
    if (tf === 'Planning Ahead')   return 'soon'
    if (tf === 'Planning a Trip')  return 'your trip'
    return 'tonight'
  })()

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
        setEnergyMin(5)
        setEnergyMax(5)
        setPicks([])
        setLoadingMsg(0)
        setShowHistConsent(false)
        setHasReturnHistory(false)
        setLastAnswers(null)
      }, 300)
      return () => clearTimeout(t)
    }

    // Modal just opened Ã¢ÂÂ check localStorage for return-visit history
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
  async function doSubmit(submittedAnswers: string[]) {
    setAnswers(submittedAnswers)
    setPhase('loading')
    setLoadingMsg(0)
    try {
      const body: Record<string, unknown> = { city, answers: submittedAnswers }
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

    // Recompute active questions with NEW answers to handle conditional group-size
    const newCrew = newAnswers[2] ?? ''
    const newShowGroupSize = newCrew === 'Small group' || newCrew === 'The whole squad'
    const newActiveQ = ALL_QUESTIONS.filter(q => !q.conditional || newShowGroupSize)

    if (qIndex < newActiveQ.length - 1) {
      setAnimating(true)
      setTimeout(() => {
        setQIndex(i => i + 1)
        setAnimating(false)
      }, 180)
    } else {
      await doSubmit(newAnswers)
    }
  }

  function handleEnergyConfirm() {
    const ans = isAnyEnergy ? 'Any' : isSingleEnergy ? String(energyMin) : `${energyMin}-${energyMax}`
    handleAnswer(ans)
  }

  function handleReset() {
    setQIndex(0)
    setAnswers([])
    setPicks([])
    setEmailInput('')
    setEmailState('idle')
    setEnergyMin(5)
    setEnergyMax(5)
    setShowHistConsent(false)
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
      navigator.share({ title: `My picks for ${timeframeDisplay} Ã°ÂÂÂ¯`, text: `Check out these events in ${city || 'my area'}!`, url })
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
  // Energy slider pointer handlers
  // ---------------------------------------------------------------------------
  function energyFromPointer(e: React.PointerEvent<HTMLDivElement>): number {
    if (!sliderRef.current) return 5
    const rect = sliderRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return Math.max(1, Math.min(10, Math.round(1 + ratio * 9)))
  }

  function handleSliderDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = energyFromPointer(e)
    let drag: 'min' | 'max'
    if (energyMin === energyMax) {
      drag = v >= energyMax ? 'max' : 'min'
    } else {
      const dMin = Math.abs(v - energyMin)
      const dMax = Math.abs(v - energyMax)
      drag = dMin <= dMax ? 'min' : 'max'
    }
    activeDragRef.current = drag
    if (drag === 'min') setEnergyMin(Math.min(v, energyMax))
    else setEnergyMax(Math.max(v, energyMin))
  }

  function handleSliderMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!activeDragRef.current) return
    const v = energyFromPointer(e)
    if (activeDragRef.current === 'min') setEnergyMin(Math.min(v, energyMax))
    else setEnergyMax(Math.max(v, energyMin))
  }

  function handleSliderUp() { activeDragRef.current = null }

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
          Ã¢ÂÂ
        </button>

        {/* Ã¢ÂÂÃ¢ÂÂ Locating Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'locating' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6">Ã°ÂÂÂ</div>
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

        {/* Ã¢ÂÂÃ¢ÂÂ City entry Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">Ã°ÂÂÂ¯</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">6 quick questions Ã¢ÂÂ your 3 best picks</p>
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
              Let&apos;s go Ã¢ÂÂ
            </button>
          </div>
        )}

        {/* Ã¢ÂÂÃ¢ÂÂ Return visit Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'returning' && lastAnswers && (
          <div className="p-6">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">Ã°ÂÂÂ</div>
              <h2 className="font-display text-xl text-white mb-2">Welcome back!</h2>
              <p className="text-white/50 text-sm">Same vibe as last time or would you like to change it up a bit?</p>
            </div>
            <div className="space-y-2.5">
              <button
                onClick={() => doSubmit(lastAnswers)}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-yd-orange/40 hover:border-yd-orange bg-yd-orange/10 text-left transition-all group"
              >
                <span className="text-2xl shrink-0">Ã°ÂÂÂ</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm mb-0.5">Same vibe</div>
                  <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors">Use my answers from last time</p>
                </div>
                <span className="text-yd-orange/60 group-hover:text-yd-orange transition-colors shrink-0">Ã¢ÂÂ</span>
              </button>
              <button
                onClick={() => { setQIndex(0); setAnswers([]); setEnergyMin(5); setEnergyMax(5); setPhase('question') }}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-white/25 hover:bg-white/5 text-left transition-all group"
              >
                <span className="text-2xl shrink-0">Ã¢ÂÂ¨</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm mb-0.5">Change it up</div>
                  <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors">Start fresh with new answers</p>
                </div>
                <span className="text-white/20 group-hover:text-white/50 transition-colors shrink-0">Ã¢ÂÂ</span>
              </button>
            </div>
          </div>
        )}

        {/* Ã¢ÂÂÃ¢ÂÂ Questions Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
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
                <span className="text-xs text-white/30">Ã°ÂÂÂ</span>
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

            {/* Ã¢ÂÂÃ¢ÂÂ Energy slider Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
            {currentQ.special === 'energy-slider' && (
              <div>
                {/* Selection display */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4 text-center">
                  <div className="text-2xl font-bold text-yd-orange mb-0.5">{energyLabel}</div>
                  <div className="text-xs text-white/40">{energyDesc}</div>
                  <div className="inline-block mt-1 px-2 py-0.5 rounded-full bg-yd-orange/15 text-yd-orange/80 text-[10px] font-medium">{energyQuality}</div>
                </div>

                {/* Slider track */}
                <div
                  ref={sliderRef}
                  className="relative h-10 cursor-pointer select-none mb-1"
                  onPointerDown={handleSliderDown}
                  onPointerMove={handleSliderMove}
                  onPointerUp={handleSliderUp}
                  onPointerLeave={handleSliderUp}
                >
                  {/* Background track */}
                  <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1.5 rounded-full bg-white/15 pointer-events-none" />
                  {/* Active fill */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-yd-orange pointer-events-none"
                    style={{ left: `${minFrac * 100}%`, right: `${(1 - maxFrac) * 100}%` }}
                  />
                  {/* Min thumb */}
                  <div
                    className="absolute w-5 h-5 rounded-full bg-yd-orange border-2 border-white shadow-md pointer-events-none"
                    style={{ left: `${minFrac * 100}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
                  />
                  {/* Max thumb (only if different) */}
                  {!isSingleEnergy && (
                    <div
                      className="absolute w-5 h-5 rounded-full bg-yd-orange border-2 border-white shadow-md pointer-events-none"
                      style={{ left: `${maxFrac * 100}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
                    />
                  )}
                </div>
                {/* Scale labels */}
                <div className="flex justify-between text-[10px] text-white/25 mb-3">
                  <span>1 Ã¢ÂÂ Low Key</span>
                  <span>10 Ã¢ÂÂ High Energy</span>
                </div>

                {/* Any energy toggle */}
                <button
                  onClick={() => {
                    if (isAnyEnergy) { setEnergyMin(5); setEnergyMax(5) }
                    else { setEnergyMin(1); setEnergyMax(10) }
                  }}
                  className={`w-full text-xs py-2 rounded-lg border transition-colors mb-4 ${isAnyEnergy ? 'border-yd-orange/60 bg-yd-orange/10 text-yd-orange' : 'border-white/15 text-white/35 hover:border-white/30 hover:text-white/60'}`}
                >
                  {isAnyEnergy ? 'Ã¢ÂÂ Any energy (1Ã¢ÂÂ10) Ã¢ÂÂ surprise me' : 'Any energy Ã¢ÂÂ open to any level'}
                </button>

                {/* Continue */}
                <button
                  onClick={handleEnergyConfirm}
                  className="w-full bg-yd-orange hover:bg-yd-orangeHover text-white font-bold py-3 rounded-xl transition-colors text-sm"
                >
                  Continue Ã¢ÂÂ
                </button>
              </div>
            )}

            {/* Ã¢ÂÂÃ¢ÂÂ Budget (with couple display) Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
            {currentQ.special === 'budget' && (
              <div className="space-y-2.5">
                {isCouple && (
                  <p className="text-white/40 text-xs mb-3 -mt-2">
                    Ã°ÂÂÂ Showing per-person and couple pricing
                  </p>
                )}
                {currentQ.options.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => handleAnswer(opt.label)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-yd-orange/60 hover:bg-yd-orange/5 text-left transition-all group"
                  >
                    <span className="text-2xl shrink-0">{opt.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-semibold text-white text-sm">{opt.label}</span>
                        {isCouple && opt.perPerson != null && opt.forCouple != null && opt.perPerson > 0 && (
                          <span className="text-xs text-white/50">
                            ${opt.perPerson}/person ÃÂ· ${opt.forCouple} together
                          </span>
                        )}
                        <span className="text-xs bg-white/10 text-white/40 px-2 py-0.5 rounded-full shrink-0">{opt.quality}</span>
                      </div>
                      <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors truncate">{opt.desc}</p>
                    </div>
                    <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">Ã¢ÂÂ</span>
                  </button>
                ))}
              </div>
            )}

            {/* Ã¢ÂÂÃ¢ÂÂ Standard option buttons Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
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
                    <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">Ã¢ÂÂ</span>
                  </button>
                ))}
              </div>
            )}

            {qIndex > 0 && (
              <button
                onClick={() => { setQIndex(i => i - 1); setAnswers(a => a.slice(0, -1)) }}
                className="mt-4 text-white/25 hover:text-white/50 text-xs transition-colors"
              >
                Ã¢ÂÂ Back
              </button>
            )}
          </div>
        )}

        {/* Ã¢ÂÂÃ¢ÂÂ Loading Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">Ã°ÂÂÂ¯</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-[1.25rem] transition-all duration-300">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        )}

        {/* Ã¢ÂÂÃ¢ÂÂ Results Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <h2 className="font-display text-xl text-white">Your picks for {timeframeDisplay}</h2>
              <p className="text-white/30 text-xs mt-0.5">
                {lat ? `Ã°ÂÂÂ near you` : `in ${city}`}
              </p>
            </div>

            {/* Saved count + sign-in nudge */}
            {Object.keys(saved).length > 0 && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-white/50">Ã¢ÂÂ¤Ã¯Â¸Â {Object.keys(saved).length} saved</span>
                <a href="/saved" className="text-xs text-[#4f9b85] hover:text-[#3d8372] transition-colors">View saved Ã¢ÂÂ</a>
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
                        {saved[pick.id] ? 'Ã¢ÂÂ¤Ã¯Â¸Â' : 'Ã°ÂÂ¤Â'}
                      </button>
                      {heartOpen === pick.id && (
                        <div className="absolute right-0 top-8 bg-[#1a1a2e] border border-white/20 rounded-xl shadow-xl z-20 w-44 overflow-hidden">
                          {saved[pick.id] ? (
                            <button onClick={() => unsaveEvent(pick)} className="w-full text-left px-3 py-2.5 text-xs text-white/70 hover:bg-white/10 transition-colors">
                              Ã°ÂÂÂÃ¯Â¸Â Remove from saved
                            </button>
                          ) : (
                            <>
                              <button onClick={() => saveEvent(pick, 'save_for_later')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors border-b border-white/10">
                                Ã°ÂÂÂ Save for later
                              </button>
                              <button onClick={() => saveEvent(pick, 'definitely_going')} className="w-full text-left px-3 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                                Ã°ÂÂÂ¯ Definitely going
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
                    {pick.distanceLabel && (
                      <span className="text-xs text-[#4f9b85]/80 block">Ã°ÂÂÂ {pick.distanceLabel}</span>
                    )}
                    <span className="text-xs text-white/40 block italic">{pick.pitch}</span>
                    <div className="flex gap-2 mt-1">
                      {pick.source === 'activity' && <span className="bg-emerald-500/20 text-emerald-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">Ã°ÂÂÂ Activity</span>}
                      {pick.source === 'facebook' && <span className="bg-blue-600/20 text-blue-400/90 rounded px-1.5 py-0.5 text-[10px] font-medium">Ã°ÂÂÂ Facebook</span>}
                      {pick.ticketUrl && (
                        <a href={pick.ticketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[#4f9b85] hover:text-[#3d8372] transition-colors"
                          onClick={() => capture('ticket_clicked', { event_id: pick.id, title: pick.title, city, rank: pick.rank })}
                        >
                          Let&apos;s go Ã¢ÂÂ
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
                        {r === 'down' ? 'Ã°ÂÂÂ' : 'Ã°ÂÂÂ'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Survey history consent banner */}
            {showHistConsent && (
              <div className="mt-3 bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white text-sm font-semibold mb-1">Ã°ÂÂÂ¾ Remember my picks for next time?</p>
                <p className="text-white/40 text-xs mb-3">
                  We keep the results private either way Ã¢ÂÂ but would you like us to log this in our records so we can remind you what you chose last time, or even two times ago?
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
                  Ã¢ÂÂ You&apos;re in! We&apos;ll send weekly picks to your inbox.
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
                    <p className="text-red-400/80 text-xs mt-1.5">Something went wrong Ã¢ÂÂ try again.</p>
                  )}
                </>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {copied ? 'Ã¢ÂÂ Link copied!' : 'Ã°ÂÂÂ Share my picks'}
              </button>
              <div className="flex items-center justify-between">
                <button
                  onClick={handleReset}
                  className="text-white/25 hover:text-white/55 text-xs transition-colors"
                >
                  Ã¢ÂÂ© Try different answers
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

        {/* Ã¢ÂÂÃ¢ÂÂ Empty Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ */}
        {phase === 'empty' && (
          <div className="p-8 text-center py-14">
            <div className="text-4xl mb-4">Ã°ÂÂ¤Â·</div>
            <h2 className="font-display text-xl text-white mb-2">Nothing matched right now</h2>
            <p className="text-white/40 text-sm mb-6">
              Try a different city or check back soon Ã¢ÂÂ events update daily.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                Ã¢ÂÂ Try again
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
