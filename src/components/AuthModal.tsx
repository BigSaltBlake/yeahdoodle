'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'

interface Props {
  onClose: () => void
}

export default function AuthModal({ onClose }: Props) {
  const { signInWithEmail, user } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const googleBtnRef = useRef<HTMLDivElement>(null)

  // Close modal when sign-in completes
  useEffect(() => {
    if (user) onClose()
  }, [user, onClose])

  // Render the Google sign-in button inside our custom button's hidden div
  useEffect(() => {
    const tryRender = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return
      googleBtnRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 352,
      })
    }

    tryRender()

    // Poll until GSI script loads
    const interval = setInterval(() => {
      if (window.google?.accounts?.id) {
        tryRender()
        clearInterval(interval)
      }
    }, 200)

    return () => clearInterval(interval)
  }, [])

  // Clicking our styled button clicks Google's rendered button underneath
  function handleGoogle() {
    const btn = googleBtnRef.current?.querySelector('div[role="button"]') as HTMLElement | null
    if (btn) {
      btn.click()
    } else {
      // Fallback: prompt (shows One Tap)
      window.google?.accounts.id.prompt()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    const { error: err } = await signInWithEmail(email.trim())
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm bg-yd-navy rounded-2xl p-6 shadow-2xl border border-white/10"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white/70 hover:text-white flex items-center justify-center text-lg leading-none transition-colors"
        >
          x
        </button>

        {sent ? (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">📬</div>
            <h2 className="font-display text-xl text-white mb-2">Check your email</h2>
            <p className="text-sm text-white/60 leading-relaxed">
              We sent a sign-in link to{' '}
              <strong className="text-white">{email}</strong>.{' '}
              Click it to access your account — no password needed.
            </p>
            <button
              onClick={onClose}
              className="mt-6 text-sm text-white/40 hover:text-white/70 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🎯</div>
              <h2 className="font-display text-xl text-white mb-1">Sign in to YeahDoodle</h2>
              <p className="text-sm text-white/50">Save events across all your devices</p>
            </div>

            {/* Google sign-in — our styled button triggers the hidden GSI button */}
            <div className="relative mb-4">
              <div
                ref={googleBtnRef}
                className="absolute inset-0 opacity-0 pointer-events-none overflow-hidden rounded-xl"
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                className="w-full bg-yd-card border border-white/10 text-white rounded-xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-yd-orange/50 transition-colors"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send magic link'}
              </button>
            </form>

            <p className="text-xs text-white/30 text-center mt-4">
              No password needed. We will email you a one-click sign-in link.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
