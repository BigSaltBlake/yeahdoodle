'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useAuth } from '@/components/AuthProvider'
import AuthModal from '@/components/AuthModal'

type SaveIntent = 'save_for_later' | 'definitely_going'

interface LocalSaved {
  event_id: string
  event_title: string
  event_data: {
    id: string
    title: string
    venue?: string
    dateFormatted?: string
    priceFormatted?: string
    ticketUrl?: string | null
    imageUrl?: string | null
    category?: string
    pitch?: string
    source?: string
  }
  intent: SaveIntent
  city: string
  saved_at: string
}

const INTENT_LABELS: Record<SaveIntent, string> = {
  save_for_later: '🔖 Save for later',
  definitely_going: '🎯 Definitely going',
}

export default function SavedPage() {
  const [localSaved, setLocalSaved] = useState<LocalSaved[]>([])
  const [authModal, setAuthModal] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    try {
      const raw = localStorage.getItem('yd_saved')
      if (raw) setLocalSaved(JSON.parse(raw))
    } catch {}
  }, [])

  function removeLocal(event_id: string) {
    const updated = localSaved.filter(e => e.event_id !== event_id)
    setLocalSaved(updated)
    try {
      localStorage.setItem('yd_saved', JSON.stringify(updated))
      const map = JSON.parse(localStorage.getItem('yd_saved_map') || '{}')
      delete map[event_id]
      localStorage.setItem('yd_saved_map', JSON.stringify(map))
    } catch {}
    // Fire-and-forget unsave from Supabase
    try {
      const sid = localStorage.getItem('yd_sid')
      fetch('/api/save', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id, session_id: sid }),
      }).catch(() => {})
    } catch {}
  }

  const isEmpty = localSaved.length === 0

  return (
    <div className="min-h-screen bg-yd-bg text-white">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Saved Events</h1>
          <Link href="/" className="text-sm text-white/40 hover:text-white/70 transition-colors">← Back</Link>
        </div>

        {isEmpty ? (
          <div className="text-center py-16 text-white/40">
            <div className="text-5xl mb-4">🤍</div>
            <p className="text-lg mb-2">No saved events yet</p>
            <p className="text-sm">Tap the ❤️ on any pick in your YeahDoodle recommendations to save it here.</p>
            <Link href="/" className="mt-6 inline-block text-sm text-[#4f9b85] hover:underline">Get recommendations →</Link>
          </div>
        ) : (
          <>
            {!user && (
              <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3 mb-4 text-sm">
                <span className="text-white/60">Sign in to sync saved events across devices</span>
                <button onClick={() => setAuthModal(true)} className="text-[#4f9b85] hover:underline ml-3 shrink-0">Sign in</button>
              </div>
            )}
            <div className="space-y-3">
              {localSaved.map((item) => {
                const ev = item.event_data
                return (
                  <div key={item.event_id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors">
                    {ev.imageUrl && (
                      <div className="relative w-full h-32">
                        <Image src={ev.imageUrl} alt={ev.title || item.event_title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 672px" />
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-white text-sm leading-snug">{ev.title || item.event_title}</p>
                          {ev.venue && <p className="text-xs text-white/50 truncate mt-0.5">{ev.venue}</p>}
                          {(ev.dateFormatted || ev.priceFormatted) && (
                            <p className="text-xs text-white/40 mt-0.5">{ev.dateFormatted}{ev.dateFormatted && ev.priceFormatted ? ' · ' : ''}{ev.priceFormatted}</p>
                          )}
                          {ev.pitch && <p className="text-xs text-white/40 italic mt-1">{ev.pitch}</p>}
                        </div>
                        <button
                          onClick={() => removeLocal(item.event_id)}
                          className="text-white/30 hover:text-white/60 transition-colors shrink-0 text-lg leading-none mt-0.5"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                        <span className="text-xs text-white/40">{INTENT_LABELS[item.intent]}</span>
                        {ev.ticketUrl && (
                          <a href={ev.ticketUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-medium text-[#4f9b85] hover:text-[#3d8372] transition-colors">
                            Let's go →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      {authModal && <AuthModal onClose={() => setAuthModal(false)} />}
    </div>
  )
}
