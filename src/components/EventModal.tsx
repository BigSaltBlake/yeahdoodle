'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import type { YDEvent } from '@/types'
import { saveEvent, unsaveEvent, isEventSaved } from '@/lib/history'
import { useAuth } from './AuthProvider'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

interface Props {
  event: YDEvent | null
  onClose: () => void
  onVibePrompt?: () => void
}

function formatDate(dateStr: string, time?: string): string {
  if (!dateStr) return 'Date TBA'
  const date = new Date(dateStr + 'T12:00:00')
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
  const label = date.toLocaleDateString('en-US', opts)
  if (!time) return label
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  const timeLabel = m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2,'0')} ${ampm}`
  return `${label} · ${timeLabel}`
}

function formatPrice(min?: number, max?: number, isFree?: boolean): string {
  if (isFree || (!min && !max)) return 'Free admission'
  if (!max || min === max) return `From $${min}`
  return `$${min} – $${max}`
}

const GROUP_LABELS: Record<string, string> = {
  'singles':       '👤 Singles',
  'couples':       '💑 Couples',
  'friend-groups': '👯 Friend Groups',
  'families':      '👨‍👩‍👧 Families',
  'child-friendly':'🧒 Child Friendly',
}

const AGE_LABELS: Record<string, string> = {
  'all-ages':   'All Ages',
  'toddlers':   'Toddlers (0-3)',
  'young-kids': 'Young Kids (4-8)',
  'tweens':     'Tweens (9-12)',
  'teens':      'Teens (13-17)',
  '18-plus':    '18+',
  '21-plus':    '21+',
}

export default function EventModal({ event, onClose, onVibePrompt }: Props) {
  const [saved, setSaved] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    if (event) setSaved(isEventSaved(event.id))
  }, [event])

  async function syncToSupabase(eventId: string, action: 'save' | 'unsave') {
    if (!user) return
    const sb = getSupabaseBrowser()
    if (action === 'save') {
      await sb.from('saved_events').upsert({ user_id: user.id, event_id: eventId })
    } else {
      await sb.from('saved_events').delete().match({ user_id: user.id, event_id: eventId })
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (event) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [event])

  if (!event) return null

  function handleSave() {
    if (!event) return
    if (saved) {
      unsaveEvent(event.id)
      setSaved(false)
      syncToSupabase(event.id, 'unsave')
    } else {
      saveEvent(event.id, event.category, event.groupSuitability)
      setSaved(true)
      syncToSupabase(event.id, 'save')
      onVibePrompt?.()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fadeIn" />

      <div
        className="relative w-full sm:max-w-xl bg-yd-navy rounded-t-2xl sm:rounded-2xl overflow-hidden animate-slideUp max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 text-white/70 hover:text-white flex items-center justify-center text-lg leading-none transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <div className="relative w-full h-52 sm:h-60 bg-yd-card2 shrink-0">
          {event.imageUrl ? (
            <Image src={event.imageUrl} alt={event.title} fill className="object-cover" sizes="600px" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">🎭</div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-yd-navy to-transparent" />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-6">
          <span className="inline-block text-xs font-semibold text-yd-orange bg-yd-orange/10 px-2.5 py-1 rounded-full mt-4 mb-2">
            {event.category}
          </span>
          <h2 className="font-display text-xl text-white leading-tight mb-4">{event.title}</h2>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-yd-card rounded-xl p-3">
              <p className="text-xs text-white/40 mb-1">📅 Date & Time</p>
              <p className="text-sm text-white font-medium">{formatDate(event.date, event.time)}</p>
            </div>
            <div className="bg-yd-card rounded-xl p-3">
              <p className="text-xs text-white/40 mb-1">🎟 Price</p>
              <p className={`text-sm font-semibold ${event.isFree ? 'text-green-400' : 'text-yd-yellow'}`}>
                {formatPrice(event.priceMin, event.priceMax, event.isFree)}
              </p>
            </div>
            <div className="bg-yd-card rounded-xl p-3 col-span-2">
              <p className="text-xs text-white/40 mb-1">📍 Location</p>
              <p className="text-sm text-white font-medium">{event.venueName}</p>
              {event.venueAddress && <p className="text-xs text-white/50 mt-0.5">{event.venueAddress}{event.city ? `, ${event.city}` : ''}{event.state ? `, ${event.state}` : ''}</p>}
            </div>
          </div>

          {event.groupSuitability.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-white/40 mb-2">Great for</p>
              <div className="flex flex-wrap gap-2">
                {event.groupSuitability.map(g => (
                  <span key={g} className="text-xs bg-yd-card px-2.5 py-1 rounded-full text-white/70">
                    {GROUP_LABELS[g] ?? g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.ageGroups.length > 0 && !event.ageGroups.includes('all-ages') && (
            <div className="mb-4">
              <p className="text-xs text-white/40 mb-2">Age groups</p>
              <div className="flex flex-wrap gap-2">
                {event.ageGroups.map(a => (
                  <span key={a} className="text-xs bg-yd-card px-2.5 py-1 rounded-full text-white/70">
                    {AGE_LABELS[a] ?? a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {event.description && (
            <div className="mb-4">
              <p className="text-xs text-white/40 mb-2">About this event</p>
              <p className="text-sm text-white/70 leading-relaxed">{event.description}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {event.ticketUrl && (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-yd-orange hover:bg-yd-orangeHover text-white text-sm font-semibold py-3 rounded-xl text-center transition-colors"
              >
                Get Tickets →
              </a>
            )}
            <button
              onClick={handleSave}
              className={`px-5 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                saved
                  ? 'bg-yd-orange/10 border-yd-orange text-yd-orange'
                  : 'border-white/10 text-white/60 hover:border-white/30 hover:text-white'
              }`}
            >
              {saved ? '♥ Saved' : '♡ Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
