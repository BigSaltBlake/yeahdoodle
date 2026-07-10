'use client'

import { useState, useEffect } from 'react'
import { deriveVibe, markVibeSetup, getProfile } from '@/lib/history'
import type { EventCategory, GroupType } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

const CATEGORY_OPTIONS: { value: EventCategory; icon: string }[] = [
  { value: 'Music',          icon: '🎵' },
  { value: 'Food & Drink',   icon: '🍻' },
  { value: 'Arts & Culture', icon: '🎨' },
  { value: 'Sports',         icon: '⚽' },
  { value: 'Nightlife',      icon: '🌙' },
  { value: 'Outdoors',       icon: '🌲' },
]

const GROUP_OPTIONS: { value: GroupType; icon: string; label: string }[] = [
  { value: 'singles',        icon: '👤', label: 'Solo' },
  { value: 'couples',        icon: '💑', label: 'Couples' },
  { value: 'friend-groups',  icon: '👯', label: 'Squad' },
  { value: 'families',       icon: '👨‍👩‍👧', label: 'Family' },
]

type Step = 'intro' | 'interests' | 'account' | 'done'

export default function VibeModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('intro')
  const [selectedCats, setSelectedCats] = useState<EventCategory[]>([])
  const [selectedGroup, setSelectedGroup] = useState<GroupType | null>(null)
  const [email, setEmail] = useState('')
  const [saveCount, setSaveCount] = useState(0)

  useEffect(() => {
    if (open) {
      setStep('intro')
      const vibe = deriveVibe()
      setSelectedCats(vibe.topCategories.length > 0 ? vibe.topCategories : [])
      setSelectedGroup(vibe.topGroups[0] ?? null)
      setSaveCount(getProfile().savedEventIds.length)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleDismiss() }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function handleDismiss() {
    markVibeSetup()
    onClose()
  }

  function toggleCat(cat: EventCategory) {
    setSelectedCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  function handleSkipAccount() {
    markVibeSetup()
    setStep('done')
    setTimeout(onClose, 1800)
  }

  function handleSetupAccount(e: React.FormEvent) {
    e.preventDefault()
    // TODO: wire to Supabase Auth sign-up
    markVibeSetup()
    setStep('done')
    setTimeout(onClose, 1800)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleDismiss}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fadeIn" />
      <div
        className="relative w-full max-w-sm bg-yd-navy rounded-2xl overflow-hidden animate-slideUp border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1 bg-gradient-to-r from-yd-orange via-yd-yellow to-yd-orange" />

        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-white/30 hover:text-white/70 text-xl leading-none transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <div className="p-6">
          {step === 'intro' && (
            <div className="text-center">
              <div className="text-4xl mb-3">🎯</div>
              <h2 className="font-display text-xl text-white mb-2">
                We&apos;re picking up your vibe
              </h2>
              <p className="text-sm text-white/60 mb-6 leading-relaxed">
                {saveCount > 0
                  ? `You've saved ${saveCount} event${saveCount > 1 ? 's' : ''} -- we can use that to find you better picks.`
                  : "We've noticed what you're browsing. Let's make your recommendations actually good."}
              </p>
              <button
                onClick={() => setStep('interests')}
                className="w-full bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold py-3 rounded-xl transition-colors mb-3"
              >
                Tune my vibe →
              </button>
              <button
                onClick={handleDismiss}
                className="w-full text-sm text-white/40 hover:text-white/60 py-2 transition-colors"
              >
                Not now
              </button>
            </div>
          )}

          {step === 'interests' && (
            <div>
              <h2 className="font-display text-lg text-white mb-1">What&apos;s your scene?</h2>
              <p className="text-sm text-white/50 mb-4">Pick everything that sounds like a good time.</p>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {CATEGORY_OPTIONS.map(cat => (
                  <button
                    key={cat.value}
                    onClick={() => toggleCat(cat.value)}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-medium transition-all ${
                      selectedCats.includes(cat.value)
                        ? 'bg-yd-orange/15 border-yd-orange text-white'
                        : 'border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                    }`}
                  >
                    <span className="text-xl">{cat.icon}</span>
                    <span>{cat.value}</span>
                  </button>
                ))}
              </div>

              <p className="text-xs text-white/40 uppercase tracking-widest mb-2">Usually going as</p>
              <div className="flex gap-2 mb-5">
                {GROUP_OPTIONS.map(g => (
                  <button
                    key={g.value}
                    onClick={() => setSelectedGroup(g.value === selectedGroup ? null : g.value)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      selectedGroup === g.value
                        ? 'bg-yd-orange/15 border-yd-orange text-white'
                        : 'border-white/10 text-white/50 hover:border-white/20'
                    }`}
                  >
                    <span className="text-lg">{g.icon}</span>
                    <span>{g.label}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setStep('account')}
                disabled={selectedCats.length === 0}
                className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors mb-2"
              >
                Looks good →
              </button>
            </div>
          )}

          {step === 'account' && (
            <div>
              <h2 className="font-display text-lg text-white mb-1">Save your vibe?</h2>
              <p className="text-sm text-white/50 mb-4 leading-relaxed">
                Create an account to keep your picks across devices. Totally optional -- we&apos;ll remember you on this browser either way.
              </p>

              <form onSubmit={handleSetupAccount} className="space-y-3 mb-4">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-yd-card border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-yd-orange transition-colors"
                />
                <button
                  type="submit"
                  disabled={!email}
                  className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Create account
                </button>
              </form>

              <button
                onClick={handleSkipAccount}
                className="w-full text-sm text-white/40 hover:text-white/60 py-2 transition-colors"
              >
                Just remember me on this browser
              </button>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-2">
              <div className="text-4xl mb-3">✅</div>
              <h2 className="font-display text-lg text-white mb-2">Vibe locked in!</h2>
              <p className="text-sm text-white/50">Your recommendations are getting better already.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
