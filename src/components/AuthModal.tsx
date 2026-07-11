'use client'
import { useState } from 'react'
import { useAuth } from './AuthProvider'
interface Props { onClose: () => void }
export default function AuthModal({ onClose }: Props) {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true); setError('')
    const { error: err } = await signInWithEmail(email.trim())
    setLoading(false)
    if (err) setError(err.message); else setSent(true)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-yd-navy rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white/70 hover:text-white flex items-center justify-center text-lg leading-none transition-colors">×</button>
        {sent ? (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">📬</div>
            <h2 className="font-display text-xl text-white mb-2">Check your email</h2>
            <p className="text-sm text-white/60 leading-relaxed">We sent a sign-in link to <strong className="text-white">{email}</strong>. Click it to access your account — no password needed.</p>
            <button onClick={onClose} className="mt-6 text-sm text-white/40 hover:text-white/70 transition-colors">Close</button>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">🔐</div>
              <h2 className="font-display text-xl text-white mb-1">Sign in to YeahDoodle</h2>
              <p className="text-sm text-white/50">Save events across all your devices</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus className="w-full bg-yd-card border border-white/10 text-white rounded-xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-yd-orange/50 transition-colors" />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button type="submit" disabled={loading} className="w-full bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50">{loading ? 'Sending…' : 'Send magic link'}</button>
            </form>
            <p className="text-xs text-white/30 text-center mt-4">No password needed. We&apos;ll email you a one-click sign-in link.</p>
          </>
        )}
      </div>
    </div>
  )
}