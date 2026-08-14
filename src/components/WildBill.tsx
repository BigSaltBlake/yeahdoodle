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

const VOICE_CONFIG = {
  pitch: 0.55,
  rate: 0.82,
  volume: 0.92,
  preferVoices: ['Google UK English Male', 'Daniel', 'Thomas', 'Alex', 'Fred'],
}

function speakText(text: string, onEnd?: () => void) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.pitch = VOICE_CONFIG.pitch
  utter.rate = VOICE_CONFIG.rate
  utter.volume = VOICE_CONFIG.volume
  const voices = window.speechSynthesis.getVoices()
  for (const name of VOICE_CONFIG.preferVoices) {
    const v = voices.find(v => v.name.includes(name))
    if (v) { utter.voice = v; break }
  }
  if (onEnd) utter.onend = onEnd
  window.speechSynthesis.speak(utter)
}

function CowboyAvatar({ size = 44, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <div className={`relative shrink-0 ${animate ? 'animate-bounce' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
        <ellipse cx="50" cy="42" rx="40" ry="8" fill="#5c3a1e" />
        <rect x="22" y="10" width="56" height="34" rx="8" fill="#7a4a28" />
        <rect x="22" y="38" width="56" height="6" rx="2" fill="#c0392b" />
        <text x="50" y="44" textAnchor="middle" fontSize="8" fill="#f1c40f">★</text>
        <circle cx="50" cy="64" r="22" fill="#e8b88a" />
        <circle cx="42" cy="60" r="3.5" fill="#2c1810" />
        <circle cx="58" cy="60" r="3.5" fill="#2c1810" />
        <circle cx="43.5" cy="58.5" r="1" fill="white" />
        <circle cx="59.5" cy="58.5" r="1" fill="white" />
        <ellipse cx="50" cy="67" rx="3" ry="2" fill="#d4956b" />
        <path d="M41 73 Q50 80 59 73" stroke="#7a3b1e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M42 70 Q50 74 58 70" stroke="#5c3a1e" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="28" cy="64" r="5" fill="#e8b88a" />
        <circle cx="72" cy="64" r="5" fill="#e8b88a" />
        <path d="M32 84 Q50 92 68 84 L65 96 Q50 100 35 96 Z" fill="#c0392b" />
        <circle cx="50" cy="88" r="3" fill="#e74c3c" />
      </svg>
    </div>
  )
}

export default function WildBill({ city, eventContext }: WildBillProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showBadge, setShowBadge] = useState(false)
  const [billSpeaking, setBillSpeaking] = useState(false)
  const [showTagline, setShowTagline] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const played = sessionStorage.getItem('wb_intro')
    if (played) return
    sessionStorage.setItem('wb_intro', '1')
    const doPlay = () => {
      setTimeout(() => {
        setShowTagline(true)
        setBillSpeaking(true)
        speakText('Yeah Doodle!', () => {
          setBillSpeaking(false)
          setTimeout(() => setShowTagline(false), 1500)
          setTimeout(() => setShowBadge(true), 800)
        })
      }, 1800)
    }
    if (window.speechSynthesis.getVoices().length > 0) {
      doPlay()
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null
        doPlay()
      }
    }
  }, [])

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
        speakText(greeting, () => setBillSpeaking(false))
      }
    } else {
      window.speechSynthesis?.cancel()
      setBillSpeaking(false)
    }
  }, [open])

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
        body: JSON.stringify({ messages: newMessages, city, eventContext }),
        signal: abortRef.current.signal,
      })
      const reader = res.body?.getReader()
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
        speakText(speakable, () => setBillSpeaking(false))
      }
    }
  }, [messages, streaming, city, eventContext])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const QUICK_PROMPTS = ["What's hot tonight?", "Hidden gems nearby", "Best live music", "Something free to do"]

  return (
    <>
      {showTagline && (
        <div className="fixed bottom-24 right-6 z-50">
          <div className="bg-yd-orange text-white font-display text-lg px-4 py-2 rounded-2xl rounded-br-none shadow-lg">
            Yeah Doodle! 🤠
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} aria-label="Chat with Wild Bill" className="fixed bottom-6 right-6 z-50 group">
        <div className="relative">
          {billSpeaking && <span className="absolute inset-0 rounded-full bg-yd-orange/40 animate-ping" />}
          <div className="relative bg-gradient-to-br from-yd-orange to-amber-600 rounded-full p-1 shadow-xl hover:scale-105 transition-transform">
            <CowboyAvatar size={52} />
          </div>
          {showBadge && !open && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold text-white animate-bounce">1</span>
          )}
          <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap bg-black/80 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Chat with Wild Bill</div>
        </div>
      </button>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#1a1a2e]">
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-900/60 to-yd-orange/20 border-b border-white/10">
            <CowboyAvatar size={38} animate={billSpeaking} />
            <div className="flex-1 min-w-0">
              <div className="font-display text-white text-sm font-bold">Wild Bill</div>
              <div className="text-white/50 text-xs truncate">{billSpeaking ? '🔊 Speaking...' : streaming ? 'Scouting...' : 'Your adventure guide'}</div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white/80 transition-colors text-lg">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-80 min-h-48">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && <CowboyAvatar size={24} />}
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-yd-orange text-white rounded-tr-sm' : 'bg-white/10 text-white/90 rounded-tl-sm'}`}>
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
                <button key={p} onClick={() => sendMessage(p)} className="text-xs bg-white/10 hover:bg-yd-orange/30 text-white/70 hover:text-white px-2.5 py-1 rounded-full transition-colors">{p}</button>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2 px-3 py-3 border-t border-white/10">
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Wild Bill anything..." disabled={streaming} className="flex-1 bg-white/10 text-white placeholder-white/30 text-sm rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-yd-orange/50 disabled:opacity-50" />
            <button type="submit" disabled={!input.trim() || streaming} className="bg-yd-orange hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl px-3 py-2 text-sm font-bold transition-colors">→</button>
          </form>
        </div>
      )}
    </>
  )
}
