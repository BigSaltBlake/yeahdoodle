'use client'

import { useState, useEffect } from 'react'

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
  dateIso?: string
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
      { label: 'Easy & familiar', desc: "Take me somewhere I know I'll enjoy", emoji: '\u{1F3AF}', quality: 'Safe bet' },
      { label: 'Mix it up a bit', desc: 'Push me slightly outside my comfort zone', emoji: '\u{26A1}', quality: 'Adventurous' },
      { label: 'Full send', desc: 'Make it a story worth telling tomorrow', emoji: '\u{1F680}', quality: 'Wild card' },
    ],
  },
  {
    question: "Who's your crew tonight?",
    subtitle: '',
    options: [
      { label: 'Solo or date night', desc: 'Just me, or me and one other', emoji: '\u{1F464}', quality: 'Intimate' },
      { label: 'Small group', desc: 'A few close friends or fam', emoji: '\u{1F46F}', quality: 'Social' },
      { label: 'The whole squad', desc: 'Big group energy, everyone\u{2019}s coming', emoji: '\u{1F389}', quality: 'Party mode' },
    ],
  },
  {
    question: 'What sounds good right now?',
    subtitle: 'Go with your gut',
    options: [
      { label: 'Live music or show', desc: 'Something to watch and feel', emoji: '\u{1F3B5}', quality: 'Entertainment' },
      { label: 'Food & drinks', desc: 'Good eats, good drinks, good company', emoji: '\u{1F37D}\u{FE0F}', quality: 'Chill' },
      { label: 'One-of-a-kind experience', desc: "Something I've never done before", emoji: '\u{2728}', quality: 'Unique' },
    ],
  },
  {
    question: "What's the scene?",
    subtitle: 'Pick the vibe that fits',
    options: [
      { label: 'Small & intimate', desc: 'Real atmosphere, you can actually talk', emoji: '\u{1F3E1}', quality: 'Cozy' },
      { label: 'Buzzing & social', desc: 'Medium energy, meeting-people kind of night', emoji: '\u{1F37B}', quality: 'Social' },
      { label: 'Big & electric', desc: "Massive crowd, everyone\u{2019}s there for it", emoji: '\u{1F3DF}\u{FE0F}', quality: 'Epic' },
    ],
  },
  {
    question: 'Budget tonight?',
    subtitle: '',
    options: [
      { label: 'Free\u{2013}$25', desc: 'Free fun is real fun', emoji: '\u{1F49A}', quality: 'Good' },
      { label: '$25\u{2013}$75', desc: 'Happy to spend on a good night', emoji: '\u{1F49B}', quality: 'Better' },
      { label: "Sky\u{2019}s the limit", desc: 'The experience is what matters', emoji: '\u{1F49C}', quality: 'Best' },
    ],
  },
]

const LOADING_MESSAGES = [
  'Scanning thousands of local events...',
  'Matching your vibe...',
  'Finding hidden gems...',
  'Picking your top 3...',
]

const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}']

type Phase = 'city' | 'question' | 'loading' | 'results' | 'empty'

export default function MoodSurvey({ open, onClose, initialCity = '' }: Props) {
  const [city, setCity] = useState(initialCity)
  const [phase, setPhase] = useState<Phase>(initialCity ? 'question' : 'city')
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [loadingMsg, setLoadingMsg] = useState(0)
  const [picks, setPicks] = useState<Pick[]>([])
  const [animating, setAnimating] = useState(false)

  // Reset on close
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setCity(initialCity)
        setPhase(initialCity ? 'question' : 'city')
        setQIndex(0)
        setAnswers([])
        setPicks([])
        setLoadingMsg(0)
      }, 300)
      return () => clearTimeout(t)
    }
  }, [open, initialCity])

  // Rotate loading messages
  useEffect(() => {
    if (phase !== 'loading') return
    const interval = setInterval(() => {
      setLoadingMsg(i => (i + 1) % LOADING_MESSAGES.length)
    }, 900)
    return () => clearInterval(interval)
  }, [phase])

  async function handleAnswer(answer: string) {
    if (phase !== 'question') return
    const newAnswers = [...answers, answer]
    setAnswers(newAnswers)

    if (qIndex < QUESTIONS.length - 1) {
      setAnimating(true)
      setTimeout(() => {
        setQIndex(i => i + 1)
        setAnimating(false)
      }, 180)
    } else {
      // All 5 answered \u{2014} fetch recommendations
      setPhase('loading')
      setLoadingMsg(0)
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ city, answers: newAnswers }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (data.picks?.length > 0) {
          setPicks(data.picks)
          setPhase('results')
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

  if (!open) return null

  const safeQIndex = Math.min(qIndex, QUESTIONS.length - 1)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full sm:max-w-lg bg-yd-card rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors rounded-full hover:bg-white/10"
          aria-label="Close"
        >
          &#x2715;
        </button>

        {/* City phase */}
        {phase === 'city' && (
          <div className="p-8 text-center">
            <div className="text-5xl mb-4">{'\u{1F3AF}'}</div>
            <h2 className="font-display text-2xl text-white mb-2">Find my perfect event</h2>
            <p className="text-white/50 text-sm mb-7">5 quick questions &#x2192; your 3 best picks tonight</p>
            <input
              autoFocus
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && city.trim() && setPhase('question')}
              placeholder="What city are you in?"
              className="w-full px-4 py-3 rounded-xl bg-white/10 text-white placeholder-white/30 border border-white/20 focus:outline-none focus:border-yd-orange mb-4 text-base"
            />
            <button
              onClick={() => city.trim() && setPhase('question')}
              disabled={!city.trim()}
              className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-colors text-sm"
            >
              Let&apos;s go &#x2192;
            </button>
          </div>
        )}

        {/* Question phase */}
        {phase === 'question' && (
          <div
            className="p-6"
            style={{ opacity: animating ? 0 : 1, transition: 'opacity 0.15s' }}
          >
            {/* Progress bar */}
            <div className="flex gap-1.5 mb-5">
              {QUESTIONS.map((_, i) => (
                <div
                  key={i}
                  className="h-1 flex-1 rounded-full transition-all duration-300"
                  style={{ background: i <= qIndex ? 'var(--color-yd-orange, #f97316)' : 'rgba(255,255,255,0.1)' }}
                />
              ))}
            </div>

            <p className="text-white/30 text-xs mb-1.5">Question {qIndex + 1} of {QUESTIONS.length}</p>
            <h2 className="font-display text-xl text-white mb-1">{QUESTIONS[safeQIndex].question}</h2>
            {QUESTIONS[safeQIndex].subtitle && (
              <p className="text-white/40 text-sm mb-5">{QUESTIONS[safeQIndex].subtitle}</p>
            )}
            {!QUESTIONS[safeQIndex].subtitle && <div className="mb-5" />}

            <div className="space-y-2.5">
              {QUESTIONS[safeQIndex].options.map(opt => (
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
                  <span className="text-white/20 group-hover:text-yd-orange transition-colors shrink-0">&#x2192;</span>
                </button>
              ))}
            </div>

            {qIndex > 0 && (
              <button
                onClick={() => { setQIndex(i => i - 1); setAnswers(a => a.slice(0, -1)) }}
                className="mt-4 text-white/25 hover:text-white/50 text-xs transition-colors"
              >
                &#x2190; Back
              </button>
            )}
          </div>
        )}

        {/* Loading phase */}
        {phase === 'loading' && (
          <div className="p-8 text-center py-16">
            <div className="text-5xl mb-6 animate-bounce">{'\u{1F3AF}'}</div>
            <h2 className="font-display text-xl text-white mb-3">Finding your perfect picks...</h2>
            <p className="text-white/40 text-sm min-h-5 transition-all duration-300">
              {LOADING_MESSAGES[loadingMsg]}
            </p>
          </div>
        )}

        {/* Results phase */}
        {phase === 'results' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <h2 className="font-display text-xl text-white">Your picks for tonight</h2>
              <p className="text-white/30 text-xs mt-0.5">in {city}</p>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {picks.map((pick, i) => (
                <div key={pick.id} className="bg-yd-bg/60 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0 mt-0.5">{MEDALS[i]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white text-sm leading-snug mb-1 line-clamp-2">{pick.title}</p>
                      <p className="text-white/40 text-xs mb-2">
                        {pick.venue && <span>{pick.venue} &middot; </span>}
                        {pick.dateFormatted} &middot; {pick.priceFormatted}
                      </p>
                      <p className="text-yd-orange/80 text-xs italic leading-relaxed mb-3">
                        &ldquo;{pick.pitch || 'Check this one out tonight!'}&rdquo;
                      </p>
                      {pick.ticketUrl ? (
                        <a
                          href={pick.ticketUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-yd-orange hover:bg-yd-orangeHover text-white text-xs font-bold px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Let&apos;s go &#x2192;
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4">
              <button
                onClick={handleReset}
                className="text-white/25 hover:text-white/55 text-xs transition-colors"
              >
                &#x21A9; Try different answers
              </button>
              <button
                onClick={onClose}
                className="text-white/25 hover:text-white/55 text-xs transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Empty phase */}
        {phase === 'empty' && (
          <div className="p-8 text-center py-14">
            <div className="text-4xl mb-4">{'\u{1F937}'}</div>
            <h2 className="font-display text-xl text-white mb-2">Nothing matched right now</h2>
            <p className="text-white/40 text-sm mb-6">
              Try a different city or check back soon &#x2014; events update daily.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleReset}
                className="bg-yd-orange/20 hover:bg-yd-orange/30 text-yd-orange text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              >
                &#x2190; Try again
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
