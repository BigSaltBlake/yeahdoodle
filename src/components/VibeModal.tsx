'use client'

import { useState, useEffect } from 'react'
import { deriveVibe, markVibeSetup, saveVibePreferences, getProfile } from '@/lib/history'
import { useAuth } from './AuthProvider'
import type { EventCategory, GroupType } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
}

const CATEGORY_OPTIONS: { value: EventCategory; icon: string }[] = [
  { value: 'Music',            icon: '🎵' },
  { value: 'Comedy',           icon: '😂' },
  { value: 'Food & Drink',     icon: '🍻' },
  { value: 'Arts & Culture',   icon: '🎨' },
  { value: 'Sports & Outdoors',icon: '⚽' },
  { value: 'Outdoors',         icon: '🌲' },
  { value: 'Nightlife',        icon: '🌙' },
  { value: 'Community',        icon: '🤝' },
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
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [saveCount, setSaveCount] = useState(0)
  const { signInWithEmail } = useAuth()

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
    markVibeSetup() // Don't prompt again this session
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

  async function handleSetupAccount(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')
    const { error } = await signInWithEmail(email)
    if (error) {
      setEmailError('Something went wrong — please try again.')
      return
    }
    markVibeSetup()
    setEmailSent(true)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleDismiss}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-fadeIn" />
      <div
        className="relative w-full max-w-sm bg-yd-navy rounded-2xl overflow-hidden animate-slideUp border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        {/* Orange top accent bar */}
        <div className="h-1 bg-gradient-to-r from-yd-orange via-yd-yellow to-yd-orange" />

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-white/30 hover:text-white/70 text-xl leading-none transition-colors"
          aria-label="Close"
        >
          ×
        </button>

        <div className="p-6">
          {/* STEP: Intro */}
          {step === 'intro' && (
            <div className="text-center">
              <div className="text-4xl mb-3">🎯</div>
              <h2 className="font-display text-xl text-white mb-2">
                We&apos;re picking up your vibe
              </h2>
              <p className="text-sm text-white/60 mb-6 leading-relaxed">
                {saveCount > 0
                  ? `You've saved ${saveCount} event${saveCount > 1 ? 's' : ''} — we can use that to find you better picks.`
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

          {/* STEP: Pick interests */}
          {step === 'interests' && (
            <div>
              <h2 className="font-display text-lg text-white mb-1">What&apos;s your scene?</h2>
              <p className="text-sm text-white/50 mb-4">Pick everything that sounds like a good time.</p>

              {/* Categories */}
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

              {/* Group type */}
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
                onClick={() => { saveVibePreferences(selectedCats, selectedGroup); setStep('account') }}
                disabled={selectedCats.length === 0}
                className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors mb-2"
              >
                Looks good →
              </button>
            </div>
          )}

          {/* STEP: Account (optional) */}
          {step === 'account' && !emailSent && (
            <div>
              <h2 className="font-display text-lg text-white mb-1">Save your vibe?</h2>
              <p className="text-sm text-white/50 mb-4 leading-relaxed">
                Enter your email to sync picks across devices. We&apos;ll send a magic link — no password needed.
              </p>

              <form onSubmit={handleSetupAccount} className="space-y-3 mb-4">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full bg-yd-card border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-yd-orange transition-colors"
                />
                {emailError && <p className="text-xs text-red-400">{emailError}</p>}
                <button
                  type="submit"
                  disabled={!email}
                  className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
                >
                  Send magic link
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

          {step === 'account' && emailSent && (
            <div className="text-center py-2">
              <div className="text-4xl mb-3">📬</div>
              <h2 className="font-display text-lg text-white mb-2">Check your inbox!</h2>
              <p className="text-sm text-white/50 leading-relaxed">
                We sent a magic link to <span className="text-white/80">{email}</span>. Click it to sync your vibe across devices.
              </p>
            </div>
          )}

          {/* STEP: Done */}
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
