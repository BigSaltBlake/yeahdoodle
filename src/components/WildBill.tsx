'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface WildBillProps {
  city?: string
  eventContext?: string
}

// ---------------------------------------------------------------------------
// Intensity levels — controls voice AND AI persona energy
// ---------------------------------------------------------------------------
type Intensity = 0 | 1 | 2

const INTENSITY_LEVELS = [
  {
    label: 'Mellow',
    emoji: '🤠',
    voice: { pitch: 0.45, rate: 0.72, volume: 0.85 },
    promptNote: 'Keep your energy calm and measured today. Still colorful, but dialed back — like a cowboy at rest by the campfire. Less exclamation marks, shorter sentences, easy pace.',
  },
  {
    label: 'Normal',
    emoji: '🤠',
    voice: { pitch: 0.55, rate: 0.82, volume: 0.92 },
    promptNote: '',  // default persona — no extra note
  },
  {
    label: 'Wild',
    emoji: '🔥',
    voice: { pitch: 0.70, rate: 0.95, volume: 1.0 },
    promptNote: "You're fired up today, partner! Full cowboy energy — more exclamation marks, more catchphrases, more color. You've had three cups of trail coffee and you are READY. Don't hold back.",
  },
]

// ---------------------------------------------------------------------------
// ElevenLabs TTS — streams audio from /api/wild-bill-tts
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
// Wild Bill SVG avatar — cartoon style
// ---------------------------------------------------------------------------
function CowboyAvatar({ size = 44, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <div
      className={`relative shrink-0 ${animate ? 'animate-bounce' : ''}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
        {/* -- Shirt / body -- */}
        <path d="M30 88 Q50 100 70 88 L72 100 L28 100 Z" fill="#2c6e8a" />
        {/* -- Bandana -- */}
        <path d="M37 84 L50 94 L63 84 L61 100 L39 100 Z" fill="#e74c3c" />
        <path d="M37 84 L50 94 L63 84" stroke="#c0392b" strokeWidth="1.5" fill="none" />
        {/* -- Neck -- */}
        <rect x="42" y="82" width="16" height="10" rx="3" fill="#f5c080" />

        {/* -- Hat brim -- */}
        <ellipse cx="50" cy="42" rx="37" ry="6.5" fill="#3d1f08" />

        {/* -- Hat crown -- */}
        <path d="M27 42 L28 16 Q29 7 50 6 Q71 7 72 16 L73 42 Z" fill="#7a4820" />
        <path d="M27 42 L28 16 Q29 7 50 6 Q71 7 72 16 L73 42 Z" fill="none" stroke="#2a1505" strokeWidth="1.5" />

        {/* -- Crown crease / dent (classic Stetson pinch) -- */}
        <path d="M36 11 Q43 20 50 15 Q57 20 64 11" stroke="#5a3010" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* -- Crown highlight -- */}
        <path d="M32 28 Q33 18 41 13" stroke="#a06535" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.55" />

        {/* -- Hat band -- */}
        <rect x="27" y="37" width="46" height="7" rx="2" fill="#c0392b" />
        {/* -- Sheriff star -- */}
        <text x="50" y="43.5" textAnchor="middle" fontSize="8" fill="#f1c40f" fontFamily="Arial">&#9733;</text>

        {/* -- Ears -- */}
        <circle cx="29.5" cy="63" r="5.5" fill="#f5c080" stroke="#d4956b" strokeWidth="1" />
        <circle cx="29.5" cy="63" r="2.8" fill="#e09060" />
        <circle cx="70.5" cy="63" r="5.5" fill="#f5c080" stroke="#d4956b" strokeWidth="1" />
        <circle cx="70.5" cy="63" r="2.8" fill="#e09060" />

        {/* -- Face -- */}
        <circle cx="50" cy="63" r="21" fill="#f5c080" stroke="#d4956b" strokeWidth="1" />
        {/* chin shadow */}
        <ellipse cx="50" cy="75" rx="14" ry="8" fill="#e09050" opacity="0.3" />

        {/* -- Eyebrows - thick cartoon arches -- */}
        <path d="M35.5 54 Q40.5 49.5 46 52.5" stroke="#4a2c0a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M54 52.5 Q59.5 49.5 64.5 54" stroke="#4a2c0a" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        {/* -- Eyes - white sclera -- */}
        <ellipse cx="41" cy="61" rx="5.5" ry="5" fill="white" />
        <ellipse cx="59" cy="61" rx="5.5" ry="5" fill="white" />
        {/* Iris */}
        <circle cx="41" cy="62" r="3.3" fill="#6b3f10" />
        <circle cx="59" cy="62" r="3.3" fill="#6b3f10" />
        {/* Pupil */}
        <circle cx="41" cy="62" r="1.9" fill="#1a0800" />
        <circle cx="59" cy="62" r="1.9" fill="#1a0800" />
        {/* Shine */}
        <circle cx="42.5" cy="60.5" r="1.1" fill="white" />
        <circle cx="60.5" cy="60.5" r="1.1" fill="white" />

        {/* -- Blush cheeks -- */}
        <circle cx="34" cy="68.5" r="5.5" fill="#f06040" opacity="0.22" />
        <circle cx="66" cy="68.5" r="5.5" fill="#f06040" opacity="0.22" />

        {/* -- Nose -- */}
        <ellipse cx="50" cy="68" rx="3.5" ry="2.5" fill="#d98040" />

        {/* -- Mustache - bold filled shape -- */}
        <path d="M38.5 71.5 Q44 77.5 50 74 Q56 77.5 61.5 71.5 Q56 72.5 50 71 Q44 72.5 38.5 71.5 Z" fill="#4a2c0a" />

        {/* -- Smile -- */}
        <path d="M44 78.5 Q50 84 56 78.5" stroke="#8b4020" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function WildBill({ city, eventContext }: WildBillProps) {
  const [open, setOpen]           = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const [billSpeaking, setBillSpeaking] = useState(false)
  const [showTagline, setShowTagline]   = useState(false)
  const [intensity, setIntensity] = useState<Intensity>(1)

  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const inputRef        = useRef<HTMLInputElement>(null)
  const abortRef        = useRef<AbortController | null>(null)
  const introPlayedRef  = useRef(false)

  // Real recorded voice files mapped to intensity level
  const CATCHPHRASE_FILES: Record<Intensity, string> = {
    0: '/WB-YD3.m4a',  // Mellow
    1: '/WB-YD1.m4a',  // Normal
    2: '/WB-YD2.m4a',  // Wild
  }

  // Restore saved intensity preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wb_intensity')
      if (saved === '0' || saved === '1' || saved === '2') {
        setIntensity(Number(saved) as Intensity)
      }
    } catch { /* ignore */ }
    if (!sessionStorage.getItem('wb_intro')) {
      setTimeout(() => setShowBadge(true), 2500)
    }
  }, [])

  const saveIntensity = (level: Intensity) => {
    setIntensity(level)
    try { localStorage.setItem('wb_intensity', String(level)) } catch { /* ignore */ }
  }

  const playIntro = (currentIntensity: Intensity) => {
    if (introPlayedRef.current || sessionStorage.getItem('wb_intro')) return
    introPlayedRef.current = true
    sessionStorage.setItem('wb_intro', '1')
    setShowBadge(false)
    setShowTagline(true)
    setBillSpeaking(true)

    const audio = new Audio(CATCHPHRASE_FILES[currentIntensity])
    const onFinish = () => {
      setBillSpeaking(false)
      setTimeout(() => setShowTagline(false), 1500)
    }
    audio.onended = onFinish
    audio.onerror = onFinish
    audio.play().catch(onFinish)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setShowBadge(false)
      if (messages.length === 0) {
        const greeting = city
          ? `Well, howdy! Wild Bill here — your personal adventure scout. You're lookin' around ${city}? Good taste, partner. What are we huntin' for today?`
          : `Well, howdy! Wild Bill here — your personal adventure scout. Tell me what city you're in and what kinda trouble you're lookin' to get into!`
        setMessages([{ role: 'assistant', content: greeting }])
        setBillSpeaking(true)
        speakText(greeting, intensity, () => setBillSpeaking(false))
      }
    } else {
      window.speechSynthesis?.cancel()
      setBillSpeaking(false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return

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
        body: JSON.stringify({ messages: newMessages, city, eventContext, intensity }),
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
          updated[updated.length - 1] = { role: 'assistant', content: "Well, shoot — my telegraph wire went down. Try again in a sec, partner." }
          return updated
        })
      }
    } finally {
      setStreaming(false)
      if (fullText) {
        const speakable = fullText.length > 200 ? fullText.substring(0, 200) + '...' : fullText
        setBillSpeaking(true)
        speakText(speakable, intensity, () => setBillSpeaking(false))
      }
    }
  }, [messages, streaming, city, eventContext, intensity])

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

  const intensityLevel = INTENSITY_LEVELS[intensity]

  return (
    <>
      {showTagline && (
        <div className="fixed bottom-24 right-6 z-50 animate-fade-in">
          <div className="bg-yd-orange text-white font-display text-lg px-4 py-2 rounded-2xl rounded-br-none shadow-lg">
            Yeah Doodle! 🤠
          </div>
        </div>
      )}

      <button
        onClick={() => { playIntro(intensity); setOpen(o => !o) }}
        aria-label="Chat with Wild Bill"
        className="fixed bottom-6 right-6 z-50 group"
      >
        <div className="relative">
          {billSpeaking && (
            <span className="absolute inset-0 rounded-full bg-yd-orange/40 animate-ping" />
          )}
          <div className="relative bg-gradient-to-br from-yd-orange to-amber-600 rounded-full p-1 shadow-xl hover:scale-105 transition-transform">
            <CowboyAvatar size={52} />
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

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#1a1a2e]">
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-900/60 to-yd-orange/20 border-b border-white/10">
            <CowboyAvatar size={38} animate={billSpeaking} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-white text-sm font-bold">Wild Bill</div>
              <div className="text-white/50 text-xs truncate">
                {billSpeaking ? '🔊 Speaking...' : streaming ? 'Scouting...' : 'Your adventure guide'}
              </div>
            </div>

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
              &#x2715;
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-80 min-h-48">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <CowboyAvatar size={24} />}
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
            ))}
            <div ref={messagesEndRef} />
          </div>

          {messages.filter(m => m.role === 'user').length === 0 && (
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
              &#x2192;
            </button>
          </form>
        </div>
      )}
    </>
  )
}
