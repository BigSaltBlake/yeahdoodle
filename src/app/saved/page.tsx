'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getSavedEventIds, wipeHistory, getProfile } from '@/lib/history'
import { useAuth } from '@/components/AuthProvider'
import AuthModal from '@/components/AuthModal'
import { getSupabaseBrowser } from '@/lib/supabase-browser'
import { mapEventRow } from '@/lib/events'
import type { YDEvent } from '@/types'

function formatDate(date: string, time?: string): string {
  if (!date) return 'Date TBA'
  const d = new Date(date + 'T12:00:00')
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const label = d.toLocaleDateString('en-US', opts)
  if (!time) return label
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  const timeLabel = m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  return `${label} · ${timeLabel}`
}

export default function SavedPage() {
  const { user, loading: authLoading } = useAuth()
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [savedEvents, setSavedEvents] = useState<YDEvent[]>([])
  const [hasProfile, setHasProfile] = useState(false)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  useEffect(() => {
    setSavedIds(getSavedEventIds())
    setHasProfile(getProfile().interactionCount > 0)
  }, [])

  useEffect(() => {
    if (!user) { setSavedEvents([]); return }
    async function loadSaved() {
      setEventsLoading(true)
      const sb = getSupabaseBrowser()
      const { data: saves, error: savesErr } = await sb
        .from('saved_events').select('event_id, saved_at').order('saved_at', { ascending: false })
      if (savesErr || !saves?.length) { setEventsLoading(false); return }
      const eventIds = saves.map((s: { event_id: string }) => s.event_id)
      const { data: rows } = await sb.from('events').select('*').in('id', eventIds)
      if (rows) {
        const byId = Object.fromEntries(rows.map((r: { id: string }) => [r.id, r]))
        setSavedEvents(eventIds.map((id: string) => byId[id]).filter(Boolean).map(mapEventRow))
      }
      setEventsLoading(false)
    }
    loadSaved()
  }, [user])

  if (authLoading) {
    return <div className="flex items-center justify-center py-32 text-white/30 text-sm">Loading…</div>
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl text-white mb-2">Saved Events</h1>
      {user ? (
        <>
          <p className="text-white/50 text-sm mb-8">
            {eventsLoading ? 'Loading your saves…' : savedEvents.length > 0 ? `${savedEvents.length} event${savedEvents.length !== 1 ? 's' : ''} saved to your account` : 'No saved events yet — tap ♡ on Discover to save something.'}
          </p>
          {eventsLoading && <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-yd-card rounded-xl p-4 h-20 animate-pulse" />)}</div>}
          {!eventsLoading && savedEvents.length > 0 && (
            <div className="space-y-3">
              {savedEvents.map(event => (
                <div key={event.id} className="bg-yd-card border border-white/5 hover:border-white/10 rounded-xl p-4 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-yd-orange font-medium">{event.category}</span>
                      <p className="text-sm text-white font-semibold mt-0.5 leading-tight">{event.title}</p>
                      <p className="text-xs text-white/50 mt-1 truncate">📍 {event.venueName}{event.city ? `, ${event.city}` : ''}</p>
                      <p className="text-xs text-white/40 mt-0.5">📅 {formatDate(event.date, event.time)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-bold ${event.isFree ? 'text-green-400' : 'text-yd-yellow'}`}>{event.isFree ? 'Free' : event.priceMin ? `$${event.priceMin}` : ''}</p>
                      {event.ticketUrl && <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-yd-orange hover:underline mt-1 inline-block">Tickets →</a>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!eventsLoading && savedEvents.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🎭</div>
              <h2 className="font-display text-xl text-white mb-2">Nothing saved yet</h2>
              <p className="text-white/50 text-sm mb-6">Head to Discover and tap ♡ on anything that looks good.</p>
              <Link href="/discover" className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-block">Browse events →</Link>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-white/50 text-sm mb-8">{savedIds.length > 0 ? `${savedIds.length} event${savedIds.length !== 1 ? 's' : ''} saved on this browser.` : 'Save events from Discover to find them here.'}</p>
          <div className="bg-yd-card border border-yd-orange/20 rounded-2xl p-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="text-3xl shrink-0">🔐</div>
              <div className="flex-1">
                <h2 className="font-semibold text-white mb-1">Sign in to sync your saves</h2>
                <p className="text-sm text-white/50 mb-4 leading-relaxed">Your saves currently live only on this browser. Sign in to access them anywhere and keep them safe.</p>
                <button onClick={() => setShowAuthModal(true)} className="bg-yd-orange hover:bg-yd-orangeHover text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">Sign in free</button>
              </div>
            </div>
          </div>
          {savedIds.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-white/30 uppercase tracking-widest mb-4">Saved on this device ({savedIds.length})</p>
              {savedIds.map(id => (
                <div key={id} className="bg-yd-card border border-white/5 rounded-xl p-4 flex items-center justify-between">
                  <div><p className="text-sm text-white font-medium">Event #{id.slice(0, 8)}…</p><p className="text-xs text-white/40 mt-0.5">Sign in to see full details</p></div>
                  <Link href="/discover" className="text-xs text-yd-orange hover:underline">Find it →</Link>
                </div>
              ))}
            </div>
          )}
          {savedIds.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-4">🎭</div>
              <h2 className="font-display text-xl text-white mb-2">Nothing saved yet</h2>
              <p className="text-white/50 text-sm mb-6">Head to Discover and tap ♡ on anything that looks good.</p>
              <Link href="/discover" className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-block">Browse events →</Link>
            </div>
          )}
        </>
      )}
      {hasProfile && (
        <div className="mt-12 pt-8 border-t border-white/5 text-center">
          <p className="text-xs text-white/30 mb-3">Want to start completely fresh?</p>
          <button onClick={() => { wipeHistory(); window.location.reload() }} className="text-xs text-white/30 hover:text-white/50 transition-colors">🧹 Wipe history & start over</button>
        </div>
      )}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}