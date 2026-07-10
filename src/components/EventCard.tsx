'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'
import type { YDEvent } from '@/types'
import { saveEvent, unsaveEvent, isEventSaved, trackEventView, shouldPromptVibe } from '@/lib/history'

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
  const date = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return time ? `Tonight \u00b7 ${formatTime(time)}` : 'Tonight'
  if (date.toDateString() === tomorrow.toDateString()) return time ? `Tomorrow \u00b7 ${formatTime(time)}` : 'Tomorrow'
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const label = date.toLocaleDateString('en-US', opts)
  return time ? `${label} \u00b7 ${formatTime(time)}` : label
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
  return `$${min}\u2013$${max}`
}

export default function EventCard({ event, onOpenDetail, onVibePrompt }: Props) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSaved(isEventSaved(event.id))
  }, [event.id])

  function handleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved) {
      unsaveEvent(event.id)
      setSaved(false)
    } else {
      saveEvent(event.id, event.category, event.groupSuitability)
      setSaved(true)
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
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">
            {event.category === 'Music' ? '🎵' : event.category === 'Sports' ? '⚽' : event.category === 'Food & Drink' ? '🍻' : event.category === 'Nightlife' ? '🌙' : event.category === 'Outdoors' ? '🌲' : '🎭'}
          </div>
        )}
        <span className={`absolute top-2 left-2 text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm ${catColor}`}>
          {event.category}
        </span>
        <button
          onClick={handleSave}
          aria-label={saved ? 'Unsave event' : 'Save event'}
          className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${
            saved
              ? 'bg-yd-orange text-white scale-110'
              : 'bg-black/40 text-white/70 hover:bg-yd-orange/80 hover:text-white'
          }`}
        >
          {saved ? '\u2665' : '\u2661'}
        </button>
      </div>

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
