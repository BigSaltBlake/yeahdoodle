'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import type React from 'react'
import type { YDEvent } from '@/types'
import { saveEvent, unsaveEvent, isEventSaved, trackEventView, shouldPromptVibe } from '@/lib/history'
import { useAuth } from './AuthProvider'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

interface Props {
  event: YDEvent
  onOpenDetail: (event: YDEvent) => void
  onVibePrompt?: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  'Music':         'bg-purple-500/20 text-purple-300',
  'Food & Drink':  'bg-amber-500/20 text-amber-300',
  'Arts & Culture':'bg-pink-500/20 text-pink-300',
  'Sports':        'bg-blue-500/20 text-blue-300',
  'Nightlife':     'bg-indigo-500/20 text-indigo-300',
  'Outdoors':      'bg-green-500/20 text-green-300',
  'Community':     'bg-teal-500/20 text-teal-300',
  'Other':         'bg-white/10 text-white/60',
}

function formatDate(dateStr: string, time?: string): string {
  if (!dateStr) return 'Date TBA'
  const date = new Date(dateStr + 'T12:00:00') // noon to avoid TZ shift
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return time ? `Tonight · ${formatTime(time)}` : 'Tonight'
  if (date.toDateString() === tomorrow.toDateString()) return time ? `Tomorrow · ${formatTime(time)}` : 'Tomorrow'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const label = date.toLocaleDateString('en-US', opts)
  return time ? `${label} · ${formatTime(time)}` : label
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatPrice(min?: number, max?: number, isFree?: boolean): string {
  if (isFree || (!min && !max)) return 'Free'
  if (!max || min === max) return `$${min}`
  return `$${min}–$${max}`
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  'Music':         'from-purple-900 via-purple-800 to-indigo-900',
  'Food & Drink':  'from-amber-900 via-orange-800 to-red-900',
  'Arts & Culture':'from-pink-900 via-rose-800 to-fuchsia-900',
  'Sports':        'from-blue-900 via-sky-800 to-cyan-900',
  'Nightlife':     'from-indigo-950 via-violet-900 to-purple-950',
  'Outdoors':      'from-green-900 via-emerald-800 to-teal-900',
  'Community':     'from-teal-900 via-cyan-800 to-emerald-900',
  'Other':         'from-slate-800 via-gray-800 to-zinc-900',
}

const CATEGORY_ICONS: Record<string, string> = {
  'Music': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M22 48V20l28-6v28" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="48" r="6" stroke="white" stroke-width="3"/><circle cx="44" cy="42" r="6" stroke="white" stroke-width="3"/></svg>`,
  'Food & Drink': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M20 8v16c0 4.4 3.6 8 8 8s8-3.6 8-8V8" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M28 32v24M20 56h16" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M44 8c0 0 4 4 4 12s-4 12-4 12v24" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  'Arts & Culture': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><circle cx="32" cy="32" r="20" stroke="white" stroke-width="3"/><circle cx="22" cy="26" r="4" stroke="white" stroke-width="2.5"/><circle cx="42" cy="26" r="4" stroke="white" stroke-width="2.5"/><circle cx="32" cy="42" r="4" stroke="white" stroke-width="2.5"/></svg>`,
  'Sports': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M32 8l6 12h14l-11 8 4 13-13-9-13 9 4-13L12 20h14z" stroke="white" stroke-width="3" stroke-linejoin="round"/></svg>`,
  'Nightlife': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M38 10a20 20 0 1 1-24 24 14 14 0 0 0 24-24z" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="M42 18l2 2M48 28l3 1M44 38l2 2" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  'Outdoors': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><path d="M8 52l24-36 24 36H8z" stroke="white" stroke-width="3" stroke-linejoin="round"/><path d="M20 52l12-18 12 18" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  'Community': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><circle cx="32" cy="20" r="8" stroke="white" stroke-width="3"/><path d="M14 52c0-9.9 8.1-18 18-18s18 8.1 18 18" stroke="white" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="28" r="5" stroke="white" stroke-width="2.5"/><path d="M4 48c0-6.1 3.6-11 8-11" stroke="white" stroke-width="2.5" stroke-linecap="round"/><circle cx="52" cy="28" r="5" stroke="white" stroke-width="2.5"/><path d="M60 48c0-6.1-3.6-11-8-11" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  'Other': `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="64" style="opacity:0.3"><rect x="10" y="14" width="44" height="36" rx="4" stroke="white" stroke-width="3"/><path d="M10 24h44" stroke="white" stroke-width="3"/><path d="M22 14V10M42 14V10" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`,
}

function CategoryPlaceholder({ category }: { category: string }) {
  const gradient = CATEGORY_GRADIENTS[category] ?? CATEGORY_GRADIENTS['Other']
  const icon = CATEGORY_ICONS[category] ?? CATEGORY_ICONS['Other']
  return (
    <div
      className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center group-hover:scale-105 transition-transform duration-300`}
    >
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }} />
      <div dangerouslySetInnerHTML={{ __html: icon }} />
    </div>
  )
}

export default function EventCard({ event, onOpenDetail, onVibePrompt }: Props) {
  const [saved, setSaved] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    setSaved(isEventSaved(event.id))
  }, [event.id])

  async function syncToSupabase(action: 'save' | 'unsave') {
    if (!user) return
    const sb = getSupabaseBrowser()
    if (action === 'save') {
      await sb.from('saved_events').upsert({ user_id: user.id, event_id: event.id })
    } else {
      await sb.from('saved_events').delete().match({ user_id: user.id, event_id: event.id })
    }
  }

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved) {
      unsaveEvent(event.id)
      setSaved(false)
      syncToSupabase('unsave')
    } else {
      saveEvent(event.id, event.category, event.groupSuitability)
      setSaved(true)
      syncToSupabase('save')
      if (shouldPromptVibe()) onVibePrompt?.()
    }
  }

  function handleClick() {
    trackEventView(event.id, event.category, event.groupSuitability)
    onOpenDetail(event)
    if (shouldPromptVibe()) onVibePrompt?.()
  }

  const catColor = CATEGORY_COLORS[event.category] ?? CATEGORY_COLORS['Other']

  return (
    <article
      onClick={handleClick}
      className="group bg-yd-card rounded-xl overflow-hidden border border-white/5 hover:border-yd-orange/40 transition-all duration-200 cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30"
    >
      {/* Image */}
      <div className="relative w-full h-44 bg-yd-card2 overflow-hidden">
        {event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <CategoryPlaceholder category={event.category} />
        )}
        {/* Category badge */}
        <span className={`absolute top-2 left-2 text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm ${catColor}`}>
          {event.category}
        </span>
        {/* Save button */}
        <button
          onClick={handleSave}
          aria-label={saved ? 'Unsave event' : 'Save event'}
          className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
            saved
              ? 'bg-yd-orange text-white scale-110'
              : 'bg-black/40 text-white/70 hover:bg-yd-orange/80 hover:text-white'
          }`}
        >
          {saved ? '♥' : '♡'}
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-sm leading-tight text-white line-clamp-2 mb-2 group-hover:text-yd-orange transition-colors">
          {event.title}
        </h3>
        <p className="text-xs text-white/50 mb-1 truncate">📍 {event.venueName}</p>
        <p className="text-xs text-white/40 mb-3">{formatDate(event.date, event.time)}</p>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold ${event.isFree ? 'text-green-400' : 'text-yd-yellow'}`}>
            {formatPrice(event.priceMin, event.priceMax, event.isFree)}
          </span>
          <span className="text-xs text-yd-orange font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            View details →
          </span>
        </div>
      </div>
    </article>
  )
}
