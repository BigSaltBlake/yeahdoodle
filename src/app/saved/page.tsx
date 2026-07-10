'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { getSavedEventIds, wipeHistory, getProfile } from '@/lib/history'

export default function SavedPage() {
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [hasProfile, setHasProfile] = useState(false)

  useEffect(() => {
    const ids = getSavedEventIds()
    setSavedIds(ids)
    const profile = getProfile()
    setHasProfile(profile.interactionCount > 0)
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="font-display text-3xl text-white mb-2">Saved Events</h1>
      <p className="text-white/50 text-sm mb-8">
        {savedIds.length > 0
          ? `You've saved ${savedIds.length} event${savedIds.length !== 1 ? 's' : ''}.`
          : 'Save events from Discover to find them here.'}
      </p>

      <div className="bg-yd-card border border-yd-orange/20 rounded-2xl p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0">🔐</div>
          <div className="flex-1">
            <h2 className="font-semibold text-white mb-1">Create an account to keep your saves</h2>
            <p className="text-sm text-white/50 mb-4 leading-relaxed">
              Right now your saved events live only on this browser.
              Sign up to access them anywhere -- and to get smarter recommendations over time.
            </p>
            <div className="flex gap-3">
              <button className="bg-yd-orange hover:bg-yd-orangeHover text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                Sign up free
              </button>
              <button className="border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm px-5 py-2.5 rounded-xl transition-colors">
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>

      {savedIds.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-white/30 uppercase tracking-widest mb-4">Your saves ({savedIds.length})</p>
          {savedIds.map(id => (
            <div key={id} className="bg-yd-card border border-white/5 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-white font-medium">Event #{id.slice(0, 8)}…</p>
                <p className="text-xs text-white/40 mt-0.5">Saved from browser history</p>
              </div>
              <Link
                href={`/discover`}
                className="text-xs text-yd-orange hover:underline"
              >
                Find it →
              </Link>
            </div>
          ))}
          <p className="text-xs text-white/30 text-center pt-4">
            Full event details load when you view them on the Discover page.
            Creating an account will sync your saves with complete event info.
          </p>
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🎭</div>
          <h2 className="font-display text-xl text-white mb-2">Nothing saved yet</h2>
          <p className="text-white/50 text-sm mb-6">Head to Discover and tap ♥ on anything that looks good.</p>
          <Link
            href="/discover"
            className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl transition-colors inline-block"
          >
            Browse events →
          </Link>
        </div>
      )}

      {hasProfile && (
        <div className="mt-12 pt-8 border-t border-white/5 text-center">
          <p className="text-xs text-white/30 mb-3">Want to start completely fresh?</p>
          <button
            onClick={() => { wipeHistory(); window.location.reload() }}
            className="text-xs text-white/30 hover:text-white/50 transition-colors"
          >
            🧹 Wipe history & start over
          </button>
        </div>
      )}
    </div>
  )
}
