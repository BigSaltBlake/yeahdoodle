'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface RecommendPick {
  title: string
  venue: string
  date: string
  price: string
  ticketUrl: string | null
  imageUrl: string | null
  pitch: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  picks?: RecommendPick[]
  fetchingPicks?: boolean
}

interface WildBillProps {
  city?: string
  eventContext?: string
}

// ---------------------------------------------------------------------------
// Intensity levels â controls voice AND AI persona energy
// ---------------------------------------------------------------------------
type Intensity = 0 | 1 | 2

const INTENSITY_LEVELS = [
  {
    label: 'Mellow',
    emoji: 'ð¤ ',
    voice: { pitch: 0.45, rate: 0.72, volume: 0.85 },
    promptNote: 'Keep your energy calm and measured today. Still colorful, but dialed back â like a cowboy at rest by the campfire. Less exclamation marks, shorter sentences, easy pace.',
  },
  {
    label: 'Normal',
    emoji: 'ð¤ ',
    voice: { pitch: 0.55, rate: 0.82, volume: 0.92 },
    promptNote: '',  // default persona â no extra note
  },
  {
    label: 'Wild',
    emoji: 'ð¥',
    voice: { pitch: 0.70, rate: 0.95, volume: 1.0 },
    promptNote: "You're fired up today, partner! Full cowboy energy â more exclamation marks, more catchphrases, more color. You've had three cups of trail coffee and you are READY. Don't hold back.",
  },
]

// ---------------------------------------------------------------------------
// ElevenLabs TTS â streams audio from /api/wild-bill-tts
// Falls back to Web Speech API if the route isn't configured
// ---------------------------------------------------------------------------
let currentAudio: HTMLAudioElement | null = null

async function speakText(text: string, intensity: Intensity, onEnd?: () => void) {
  if (typeof window === 'undefined') return

  // Cancel any in-progress speech
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
  window.speechSynthesis?.cancel()

  try {
    const res = await fetch('/api/wild-bill-tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, intensity }),
    })

    if (!res.ok) throw new Error('TTS route returned ' + res.status)

    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; onEnd?.() }
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; onEnd?.() }
    await audio.play()
  } catch {
    // Fallback: Web Speech API (browser TTS)
    if (!window.speechSynthesis) { onEnd?.(); return }
    const cfg   = INTENSITY_LEVELS[intensity].voice
    const utter = new SpeechSynthesisUtterance(text)
    utter.pitch  = cfg.pitch
    utter.rate   = cfg.rate
    utter.volume = cfg.volume
    if (onEnd) utter.onend = onEnd
    window.speechSynthesis.speak(utter)
  }
}

// ---------------------------------------------------------------------------
// Wild Bill avatar â ElevenLabs Headshot image
// ---------------------------------------------------------------------------
function AvatarImage({ size = 44, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden ${animate ? 'animate-bounce' : ''}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/wild-bill-avatar.png"
        alt="Wild Bill"
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function WildBill({ city, eventContext }: WildBillProps) {
  const [open, setOpen]           = useState(false)
  const [userLoc,    setUserLoc]    = useState(city || '')
  const [locDone,    setLocDone]    = useState(!!city)
  const [locInput,   setLocInput]   = useState('')
  const [gpsLoading, setGpsLoading] = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const [billSpeaking, setBillSpeaking] = useState(false)
  const [showTagline, setShowTagline]   = useState(false)
  const [intensity, setIntensity] = useState<Intensity>(1)
  const [pendingChips, setPendingChips] = useState<'vibe' | 'avoid' | null>(null)
  const [showAllVibeChips, setShowAllVibeChips] = useState(false)

  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLInputElement>(null)
  const abortRef        = useRef<AbortController | null>(null)
  const catchphraseCooldownRef = useRef(false)

  // Real recorded voice files mapped to intensity level
  const CATCHPHRASE_FILES: Record<Intensity, string> = {
    0: '/WB-YD3.m4a',  // Mellow â shortest/calmest take
    1: '/WB-YD1.m4a',  // Normal
    2: '/WB-YD2.m4a',  // Wild â biggest take
  }

  // Restore saved intensity preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wb_intensity')
      if (saved === '0' || saved === '1' || saved === '2') {
        setIntensity(Number(saved) as Intensity)
      }
    } catch { /* ignore */ }
    setTimeout(() => setShowBadge(true), 2500)
  }, [])

  const saveIntensity = (level: Intensity) => {
    setIntensity(level)
    try { localStorage.setItem('wb_intensity', String(level)) } catch { /* ignore */ }
  }

  // Play "Yeah Doodle!" catchphrase â triggered by CTA button hover/click
  // Has a 3-second cooldown to prevent audio spam on rapid hover
  const playCatchphrase = useCallback((currentIntensity: Intensity) => {
    if (catchphraseCooldownRef.current) return
    catchphraseCooldownRef.current = true
    setTimeout(() => { catchphraseCooldownRef.current = false }, 3000)

    // Cancel any in-progress TTS so voices don't overlap
    if (currentAudio) { currentAudio.pause(); currentAudio = null }
    window.speechSynthesis?.cancel()

    setShowTagline(true)
    setBillSpeaking(true)

    const audio = new Audio(CATCHPHRASE_FILES[currentIntensity])
    currentAudio = audio  // register so speakText can cancel it too
    const onFinish = () => {
      if (currentAudio === audio) currentAudio = null
      setBillSpeaking(false)
      setTimeout(() => setShowTagline(false), 1500)
    }
    audio.onended = onFinish
    audio.onerror = onFinish
    audio.play().catch(onFinish)
  }, [CATCHPHRASE_FILES])

  // Listen for CTA button event from homepage
  useEffect(() => {
    const handler = () => playCatchphrase(intensity)
    window.addEventListener('wb-yeahdoodle', handler)
    return () => window.removeEventListener('wb-yeahdoodle', handler)
  }, [intensity, playCatchphrase])

  // Open Wild Bill with a pre-set city (fired from homepage "Yeah Doodle!" location picker)
  useEffect(() => {
    const handler = (e: Event) => {
      const loc = (e as CustomEvent).detail?.city || ''
      if (loc) {
        setUserLoc(loc)
        setLocDone(true)
      }
      setOpen(true)
    }
    window.addEventListener('wb-open-with-city', handler)
    return () => window.removeEventListener('wb-open-with-city', handler)
  }, [])

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input + greeting when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setShowBadge(false)
      if (messages.length === 0 && locDone) {
        const greeting = userLoc || city
          ? `Well, howdy! Wild Bill here. You're in ${userLoc || city} â let's find your move for tonight. Tap what sounds right:`
          : `Well, howdy! Wild Bill here â your personal adventure scout. May I use your location to see what's happenin' close by? Or just tell me what city you're in!`
        setMessages([{ role: 'assistant', content: greeting }])
        if (city) { setPendingChips('vibe'); setShowAllVibeChips(false) }
        setBillSpeaking(true)
        speakText(greeting, intensity, () => setBillSpeaking(false))
      }
    } else {
      window.speechSynthesis?.cancel()
      setBillSpeaking(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (locDone && open && messages.length === 0) {
      const loc = userLoc || city
      setMessages([{ role: 'assistant', content: `Well, howdy! I'm Wild Bill â your personal adventure scout. You're in ${loc} â let's find your next adventure. Tap what sounds right:` }])
    }
  }, [locDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return

    // Clear any pending chips immediately when user sends
    setPendingChips(null)
    setShowAllVibeChips(false)

    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    abortRef.current = new AbortController()
    let fullText = ''

    try {
      const res = await fetch('/api/wild-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, city: userLoc || city, eventContext, intensity }),
        signal: abortRef.current.signal,
      })

      const reader  = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: fullText }
          return updated
        })
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: "Well, shoot â my telegraph wire went down. Try again in a sec, partner." }
          return updated
        })
      }
    } finally {
      setStreaming(false)

      // Strip all protocol markers to get clean displayable text
      const cleanText = fullText
        .replace(/\[FETCH_PICKS:\{[\s\S]*?\}\]\s*$/, '')
        .replace(/\[ASK:vibe\]/g, '')
        .replace(/\[ASK:avoid\]/g, '')
        .trim()

      const markerMatch = fullText.match(/\[FETCH_PICKS:(\{[\s\S]*?\})\]\s*$/)
      const askVibe  = fullText.includes('[ASK:vibe]')
      const askAvoid = fullText.includes('[ASK:avoid]')

      if (markerMatch) {
        // FETCH_PICKS flow â pull recommendations
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: cleanText, fetchingPicks: true }
          return updated
        })

        try {
          const params = JSON.parse(markerMatch[1])
          const res = await fetch('/api/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
          })
          const data = await res.json()
          const picks: RecommendPick[] = (data.picks ?? []).map((p: Record<string, string | null | undefined>) => ({
            title:     p.title ?? '',
            venue:     p.venue ?? '',
            date:      p.date ?? '',
            price:     p.price ?? '',
            ticketUrl: p.ticketUrl ?? p.ticket_url ?? null,
            imageUrl:  p.imageUrl ?? p.image_url ?? null,
            pitch:     p.pitch ?? '',
          }))
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: cleanText, picks, fetchingPicks: false }
            return updated
          })
        } catch {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: cleanText, fetchingPicks: false }
            return updated
          })
        }

        const speakable = cleanText.length > 200 ? cleanText.substring(0, 200) + '...' : cleanText
        if (speakable) { setBillSpeaking(true); speakText(speakable, intensity, () => setBillSpeaking(false)) }

      } else if (fullText) {
        // Regular response â strip markers from display
        if (askVibe || askAvoid) {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: cleanText }
            return updated
          })
          if (askVibe) { setPendingChips('vibe'); setShowAllVibeChips(false) }
          else if (askAvoid) setPendingChips('avoid')
        }

        const speakable = cleanText.length > 200 ? cleanText.substring(0, 200) + '...' : cleanText
        setBillSpeaking(true)
        speakText(speakable, intensity, () => setBillSpeaking(false))
      }
    }
  }, [messages, streaming, city, eventContext, intensity])

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
            setUserLoc(loc)
            setLocDone(true)
            setGpsLoading(false)
          })
          .catch(() => setGpsLoading(false))
      },
      () => setGpsLoading(false)
    )
  }

  const handleLocSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!locInput.trim()) return
    setUserLoc(locInput.trim())
    setLocDone(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const QUICK_PROMPTS = [
    "What's hot tonight?",
    "Hidden gems nearby",
    "Best live music",
    "Something free to do",
  ]

  // Survey chip options â mirror the MoodSurvey "Go ___" taxonomy
  const SURVEY_CHIPS = {
    vibe: [
      { label: 'ð½ï¸  Go eat',     value: 'Go eat'     },
      { label: 'ðµ  Go listen',  value: 'Go listen'  },
      { label: 'ð¥  Go out',     value: 'Go out'     },
      { label: 'â¡  Go move',    value: 'Go move'    },
      { label: 'ð­  Go see',     value: 'Go see'     },
      { label: 'ð  Go explore', value: 'Go explore' },
      { label: 'ð²  Go play',    value: 'Go play'    },
    ],
    avoid: [
      { label: 'ð¸  Spending more than planned',   value: 'Spending more than planned'   },
      { label: "ð  Chaos I can't escape",         value: "Chaos I can't escape"          },
      { label: 'ð  Needing to plan anything',     value: 'Needing to plan anything'     },
      { label: 'ðª  Being stuck in a seat',        value: 'Being stuck in a seat'        },
    ],
  } as const

  const intensityLevel = INTENSITY_LEVELS[intensity]

  return (
    <>
      {/* "Yeah Doodle!" speech bubble */}
      {showTagline && (
        <div className="fixed bottom-24 right-6 z-50 animate-fade-in">
          <div className="bg-yd-orange text-white font-display text-lg px-4 py-2 rounded-2xl rounded-br-none shadow-lg">
            Yeah Doodle! ð¤ 
          </div>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Chat with Wild Bill"
        className="fixed bottom-6 right-6 z-50 group"
      >
        <div className="relative">
          {billSpeaking && (
            <span className="absolute inset-0 rounded-full bg-yd-orange/40 animate-ping" />
          )}
          <div className="relative bg-gradient-to-br from-yd-orange to-amber-600 rounded-full p-1 shadow-xl hover:scale-105 transition-transform">
            <AvatarImage size={52} />
          </div>
          {showBadge && !open && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold text-white animate-bounce">
              1
            </span>
          )}
          <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-black/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Chat with Wild Bill
          </div>
        </div>
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#1a1a2e]">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-900/60 to-yd-orange/20 border-b border-white/10">
            <AvatarImage size={38} animate={billSpeaking} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-white text-sm font-bold">Wild Bill</div>
              <div className="text-white/50 text-xs truncate">
                {billSpeaking ? 'ð Speaking...' : streaming ? 'Scouting...' : 'Your adventure guide'}
              </div>
            </div>

            {/* Intensity dial */}
            <div className="flex items-center gap-0.5 bg-black/30 rounded-lg p-0.5" title="Wild Bill's energy level">
              {INTENSITY_LEVELS.map((lvl, i) => (
                <button
                  key={lvl.label}
                  onClick={() => saveIntensity(i as Intensity)}
                  title={lvl.label}
                  className={`text-xs px-1.5 py-0.5 rounded-md transition-all font-medium ${
                    intensity === i
                      ? 'bg-yd-orange text-white shadow-sm'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setOpen(false)}
              className="text-white/40 hover:text-white/80 transition-colors text-lg ml-1"
            >
              â
            </button>
          </div>

          {!locDone && (
            <div className="flex flex-col items-center gap-3 p-5 pt-4">
              <p className="text-sm font-semibold text-stone-800 text-center">Where should I scout for adventures?</p>
              <button
                onClick={handleGps}
                disabled={gpsLoading}
                className="w-full rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold py-2.5 px-4 transition-all disabled:opacity-60 text-sm"
              >
                {gpsLoading ? 'Locatingâ¦' : 'ð Use My Current Location'}
              </button>
              <div className="flex w-full items-center gap-2">
                <hr className="flex-1 border-stone-200" />
                <span className="text-xs text-stone-400">or type a location</span>
                <hr className="flex-1 border-stone-200" />
              </div>
              <form onSubmit={handleLocSubmit} className="flex w-full gap-2">
                <input
                  className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="City, zip, state, or countryâ¦"
                  value={locInput}
                  onChange={e => setLocInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-xl bg-stone-800 hover:bg-stone-700 active:scale-95 text-white px-4 py-2 text-sm font-semibold transition-all"
                >
                  Go
                </button>
              </form>
              <p className="text-xs text-stone-400 text-center">Try a zip, city, state, or country â the broader the search, the more Wild Bill explores!</p>
            </div>
          )}
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-80 min-h-48">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
                  {msg.role === 'assistant' && <AvatarImage size={24} />}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-yd-orange text-white rounded-tr-sm'
                        : 'bg-white/10 text-white/90 rounded-tl-sm'
                    }`}
                  >
                    {msg.content || (
                      <span className="flex gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                </div>

                {/* Pick cards */}
                {msg.fetchingPicks && (
                  <div className="w-full pl-8 text-xs text-white/40 animate-pulse">Scouting your picks...</div>
                )}
                {msg.picks && msg.picks.length > 0 && (
                  <div className="w-full pl-8 flex flex-col gap-2">
                    {msg.picks.map((pick, pi) => (
                      <div key={pi} className="bg-white/8 border border-white/10 rounded-xl overflow-hidden">
                        {pick.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={pick.imageUrl} alt={pick.title} className="w-full h-20 object-cover" />
                        )}
                        <div className="p-2.5">
                          <p className="text-white text-xs font-semibold leading-tight mb-0.5">{pick.title}</p>
                          {pick.pitch && <p className="text-white/55 text-[11px] leading-snug mb-1">{pick.pitch}</p>}
                          <p className="text-white/40 text-[11px]">{pick.venue}{pick.date ? ` Â· ${pick.date}` : ''}{pick.price ? ` Â· ${pick.price}` : ''}</p>
                          {pick.ticketUrl && (
                            <a
                              href={pick.ticketUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block mt-1.5 text-[11px] font-semibold text-yd-orange hover:underline"
                            >
                              Let&apos;s go â
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Survey chips â shown when Wild Bill is asking a survey question */}
          {pendingChips && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {(pendingChips === 'vibe'
                ? (showAllVibeChips ? SURVEY_CHIPS.vibe : SURVEY_CHIPS.vibe.slice(0, 4))
                : SURVEY_CHIPS.avoid
              ).map(chip => (
                <button
                  key={chip.label}
                  onClick={() => sendMessage(chip.value)}
                  disabled={streaming}
                  className="text-left text-sm bg-white/8 hover:bg-yd-orange/20 text-white/80 hover:text-white px-3 py-2.5 rounded-xl transition-colors border border-white/10 hover:border-yd-orange/40 disabled:opacity-40"
                >
                  {chip.label}
                </button>
              ))}
              {pendingChips === 'vibe' && !showAllVibeChips && (
                <button
                  onClick={() => setShowAllVibeChips(true)}
                  className="text-xs text-white/35 hover:text-white/55 transition-colors py-0.5 text-left pl-1"
                >
                  + more options
                </button>
              )}
            </div>
          )}

          {/* Quick prompts (only show before first user message, when no chips pending) */}
          {!pendingChips && messages.filter(m => m.role === 'user').length === 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="text-xs bg-white/10 hover:bg-yd-orange/30 text-white/70 hover:text-white px-2.5 py-1 rounded-full transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2 px-3 py-3 border-t border-white/10">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask Wild Bill anything..."
              disabled={streaming}
              className="flex-1 bg-white/10 text-white placeholder-white/30 text-sm rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-yd-orange/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || streaming}
              className="bg-yd-orange hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl px-3 py-2 text-sm font-bold transition-colors"
            >
              â
            </button>
          </form>
        </div>
      )}
    </>
  )
}
