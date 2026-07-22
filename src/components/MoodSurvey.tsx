'use client'

import { useState, useEffect } from 'react'

const CITIES = [
  'Albuquerque, NM', 'Anchorage, AK', 'Arlington, TX', 'Atlanta, GA', 'Austin, TX',
  'Baltimore, MD', 'Boise, ID', 'Boston, MA', 'Buffalo, NY', 'Charlotte, NC',
  'Chicago, IL', 'Cincinnati, OH', 'Cleveland, OH', 'Colorado Springs, CO', 'Columbus, OH',
  'Dallas, TX', 'Denver, CO', 'Detroit, MI', 'El Paso, TX', 'Fort Worth, TX',
  'Fresno, CA', 'Honolulu, HI', 'Houston, TX', 'Indianapolis, IN', 'Jacksonville, FL',
  'Kansas City, MO', 'Las Vegas, NV', 'Long Beach, CA', 'Los Angeles, CA', 'Louisville, KY',
  'Memphis, TN', 'Mesa, AZ', 'Miami, FL', 'Milwaukee, WI', 'Minneapolis, MN',
  'Nashville, TN', 'New Orleans, LA', 'New York, NY', 'Oakland, CA', 'Oklahoma City, OK',
  'Omaha, NE', 'Orlando, FL', 'Philadelphia, PA', 'Phoenix, AZ', 'Pittsburgh, PA',
  'Portland, OR', 'Raleigh, NC', 'Reno, NV', 'Sacramento, CA', 'Salt Lake City, UT',
  'San Antonio, TX', 'San Diego, CA', 'San Francisco, CA', 'San Jose, CA', 'Seattle, WA',
  'St. Louis, MO', 'Tampa, FL', 'Tucson, AZ', 'Tulsa, OK', 'Virginia Beach, VA',
  'Washington, DC', 'Wichita, KS',
]

interface Pick {
  id: string; rank: number; pitch: string; title: string; venue: string
  dateFormatted: string; priceFormatted: string; ticketUrl: string | null
  imageUrl: string | null; category: string; dateIso?: string
}
interface Props { open: boolean; onClose: () => void; initialCity?: string }

const QUESTIONS = [
  { question: "What's your energy tonight?", subtitle: 'How adventurous are you feeling?',
    options: [
      { label: 'Easy & familiar', desc: "Take me somewhere I know I'll enjoy", emoji: '🎯', quality: 'Safe bet' },
      { label: 'Mix it up a bit', desc: 'Push me slightly outside my comfort zone', emoji: '⚡', quality: 'Adventurous' },
      { label: 'Full send', desc: 'Make it a story worth telling tomorrow', emoji: '🚀', quality: 'Wild card' },
    ]},
  { question: "Who's your crew tonight?", subtitle: '',
    options: [
      { label: 'Solo or date night', desc: 'Just me, or me and one other', emoji: '👤', quality: 'Intimate' },
      { label: 'Small group', desc: 'A few close friends or fam', emoji: '👯', quality: 'Social' },
      { label: 'The whole squad', desc: "Big group energy, everyone's coming", emoji: '🎉', quality: 'Party mode' },
    ]},
  { question: 'What sounds good right now?', subtitle: 'Go with your gut',
    options: [
      { label: 'Live music or show', desc: 'Something to watch and feel', emoji: '🎵', quality: 'Entertainment' },
      { label: 'Food & drinks', desc: 'Good eats, good drinks, good company', emoji: '🍽️', quality: 'Chill' },
      { label: 'One-of-a-kind experience', desc: "Something I've never done before", emoji: '✨', quality: 'Unique' },
    ]},
  { question: "What's the scene?", subtitle: 'Pick the vibe that fits',
    options: [
      { label: 'Small & intimate', desc: 'Real atmosphere, you can actually talk', emoji: '🏡', quality: 'Cozy' },
      { label: 'Buzzing & social', desc: 'Medium energy, meeting-people kind of night', emoji: '🍻', quality: 'Social' },
      { label: 'Big & electric', desc: "Massive crowd, everyone's there for it", emoji: '🏟️', quality: 'Epic' },
    ]},
  { question: 'Budget tonight?', subtitle: '',
    options: [
      { label: 'Free–$25', desc: 'Free fun is real fun', emoji: '💚', quality: 'Good' },
      { label: '$25–$75', desc: 'Happy to spend on a good night', emoji: '💛', quality: 'Better' },
      { label: "Sky's the limit", desc: 'The experience is what matters', emoji: '💜', quality: 'Best' },
    ]},
]

const LOADING_MESSAGES = ['Scanning thousands of local events...','Matching your vibe...','Finding hidden gems...','Picking your top 3...']
const MEDALS = ['🥇','🥈','🥉']
type Phase = 'city' | 'question' | 'loading' | 'results' | 'empty'

export default function MoodSurvey({ open, onClose, initialCity = '' }: Props) {
  const [city, setCity] = useState(initialCity)
  const [phase, setPhase] = useState<Phase>(initialCity ? 'question' : 'city')
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [picks, setPicks] = useState<Pick[]>([])
  const [animating, setAnimating] = useState(false)
  const [citySuggestions, setCitySuggestions] = useState<string[]>([])
  const [locating, setLocating] = useState(false)
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setCity(initialCity); setPhase(initialCity ? 'question' : 'city')
        setQIndex(0); setAnswers([]); setPicks([]); setLoadingMsg(0)
        setUserLat(null); setUserLng(null)
      }, 300)
      return () => clearTimeout(t)
    }
  }, [open, initialCity])

  useEffect(() => {
    if (phase !== 'loading') return
    const interval = setInterval(() => setLoadingMsg(i => (i + 1) % LOADING_MESSAGES.length), 900)
    return () => clearInterval(interval)
  }, [phase])

  async function handleGPSLocate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setLocating(true)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      )
      const { latitude, longitude } = pos.coords
      setUserLat(latitude); setUserLng(longitude)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'User-Agent': 'YeahDoodle/1.0' } }
      )
      const data = await res.json()
      const detectedCity = data.address?.city || data.address?.town || data.address?.village || data.address?.county || ''
      if (detectedCity) { setCity(detectedCity); setCitySuggestions([]); setPhase('question') }
    } catch { /* silently fail */ } finally { setLocating(false) }
  }

  async function handleAnswer(answer: string) {
    if (phase !== 'question') return
    const newAnswers = [...answers, answer]
    setAnswers(newAnswers)
    if (qIndex < QUESTIONS.length - 1) {
      setAnimating(true)
      setTimeout(() => { setQIndex(i => i + 1); setAnimating(false) }, 180)
    } else {
      setPhase('loading'); setLoadingMsg(0)
      try {
        const body: Record<string, unknown> = { city, answers: newAnswers }
        if (userLat != null && userLng != null) { body.lat = userLat; body.lng = userLng }
        const res = await fetch('/api/recommend', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.picks?.length > 0) { setPicks(data.picks); setPhase('results') }
        else setPhase('empty')
      } catch { setPhase('empty') }
    }
  }

  function handleReset() { setQIndex(0); setAnswers([]); setPicks([]); setPhase('question') }

  if (!open) return null
  const safeQIndex = Math.min(qIndex, QUESTIONS.length - 1)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full sm:max-w-lg bg-yd-card rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-y-auto max-h-[88vh] sm:max-h-[90vh]">
        <div className="sm:hidden flex justify-center pt-3 -mb-1"><div className="w-10 h-1 rounded-full bg-white/25" /></div>
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors rounded-full hover:bg-white/10" aria-label="Close">&#x2715;</button>

        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">5 quick questions &#x2192; your 3 best picks tonight</p>
            <button type="button" onClick={handleGPSLocate} disabled={locating}
              className="w-full flex items-center justify-center gap-2 text-white/50 hover:text-yd-orange border border-white/10 hover:border-yd-orange/40 rounded-xl py-2.5 mb-3 text-sm transition-colors disabled:opacity-50">
              {locating ? '⏳ Detecting location...' : '📍 Use my location'}
            </button>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-white/10" /><span className="text-white/20 text-xs">or</span><div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="relative w-full mb-4">
              <input autoFocus value={city}
                onChange={e => {
                  const val = e.target.value; setCity(val); setUserLat(null); setUserLng(null)
                  setCitySuggestions(val.length >= 1 ? CITIES.filter(c => c.toLowerCase().startsWith(val.toLowerCase())).slice(0, 6) : [])
                }}
                onKeyDown={e => { if (e.key === 'Enter' && city.trim()) { setCitySuggestions([]); setPhase('question') } if (e.key === 'Escape') setCitySuggestions([]) }}
                placeholder="What city are you in?"
                className="w-full px-4 py-3 rounded-xl bg-white/10 text-white placeholder-white/30 border border-white/20 focus:outline-none focus:border-yd-orange text-base" />
              {citySuggestions.length > 0 && (
                <ul className="absolute top-full left-0 right-0 bg-[#1a1a2e] border border-white/20 rounded-xl mt-1 overflow-hidden z-50 shadow-xl">
                  {citySuggestions.map(c => (
                    <li key={c} className="px-4 py-2.5 text-white text-left cursor-pointer hover:bg-white/10 transition-colors text-sm"
                      onMouseDown={() => { setCity(c.split(',')[0].trim()); setCitySuggestions([]); setPhase('question') }}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => city.trim() && setPhase('question')} disabled={!city.trim()}
              className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm">
              Let&apos;s go &#x2192;
            </button>
          </div>
        )}

        {phase === 'question' && (
          <div className="p-6" style={{ opacity: animating ? 0 : 1, transition: 'opacity 0.15s' }}>
            <div className="flex gap-1.5 mb-5">
              {QUESTIONS.map((_, i) => (
                <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                  style={{ background: i <= qIndex ? 'var(--color-yd-orange, #f97316)' : 'rgba(255,255,255,0.1)' }} />
              ))}
            </div>
            <p className="text-white/30 text-xs mb-1.5">Question {qIndex + 1} of {QUESTIONS.length}</p>
            <h2 className="font-display text-xl text-white mb-1">{QUESTIONS[safeQIndex].question}</h2>
            {QUESTIONS[safeQIndex].subtitle && <p className="text-white/40 text-sm mb-5">{QUESTIONS[safeQIndex].subtitle}</p>}
            {!QUESTIONS[safeQIndex].subtitle && <div className="mb-5" />}
            <div className="space-y-2.5">
              {QUESTIONS[safeQIndex].options.map(opt => (
                <button key={opt.label} onClick={() => handleAnswer(opt.label)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 hover:border-yd-orange/60 hover:bg-yd-orange/5 text-left transition-all group">
                  <span className="text-2xl shrink-0">{opt.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-white text-sm">{opt.label}</span>
                      <span className="text-xs bg-white/10 text-white/40 px-2 py-0.5 rounded-full shrink-0">{opt.quality}</span>
                    </div>
                    <p className="text-white/40 text-xs group-hover:text-white/60 transition-colors truncate">{opt.desc}</p>
                  </div>
                  <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">&#x2192;</span>
                </button>
              ))}
            </div>
            {qIndex > 0 && <button onClick={() => { setQIndex(i => i - 1); setAnswers(a => a.slice(0, -1)) }} className="mt-4 text-white/25 hover:text-white/50 text-xs transition-colors">&#x2190; Back</button>}
          </div>
        )}

        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">🎯</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-5 transition-all duration-300">{LOADING_MESSAGES[loadingMsg]}</p>
          </div>
        )}

        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <h2 className="font-display text-xl text-white">Your picks for tonight</h2>
              <p className="text-white/30 text-xs mt-0.5">{userLat != null ? 'near your location' : `in ${city}`}</p>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {picks.map((pick, i) => (
                <div key={pick.id} className="bg-yd-bg/60 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors">
                  {pick.imageUrl && <img src={pick.imageUrl} alt={pick.title} className="block w-[calc(100%+2rem)] h-36 object-cover -mx-4 -mt-4 mb-4 rounded-t-xl" />}
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{MEDALS[i]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-sm leading-snug mb-1 line-clamp-2">{pick.title}</p>
                      <p className="text-white/40 text-xs mb-2">{pick.venue && <span>{pick.venue} &middot; </span>}{pick.dateFormatted} &middot; {pick.priceFormatted}</p>
                      <p className="text-yd-orange/80 text-xs italic leading-relaxed mb-3">&ldquo;{pick.pitch || 'Check this one out tonight!'}&rdquo;</p>
                      {pick.ticketUrl && <a href={pick.ticketUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 bg-yd-orange hover:bg-yd-orangeHover text-white text-xs font-bold px-4 py-1.5 rounded-lg transition-colors">Let&apos;s go &#x2192;</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4">
              <button onClick={handleReset} className="text-white/25 hover:text-white/55 text-xs transition-colors">&#x21A9; Try different answers</button>
              <button onClick={onClose} className="text-white/25 hover:text-white/55 text-xs transition-colors">Done</button>
            </div>
          </div>
        )}

        {phase === 'empty' && (
          <div className="p-8 text-center py-14">
            <div className="text-4xl mb-4">🤷</div>
            <h2 className="font-display text-xl text-white mb-2">Nothing matched right now</h2>
            <p className="text-white/40 text-sm mb-6">Try a different city or check back soon — events update daily.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={handleReset} className="bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">&#x2190; Try again</button>
              <button onClick={onClose} className="text-white/30 hover:text-white/60 text-sm px-5 py-2.5 transition-colors">Browse events</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
