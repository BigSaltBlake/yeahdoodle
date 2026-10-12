'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SECRET_KINDS, type SecretKind } from '@/lib/secret-kinds'

type Status = 'idle' | 'locating' | 'saving' | 'done'

const inputCls =
  'w-full bg-yd-card2 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 ' +
  'focus:outline-none focus:border-yd-orange/60 transition-colors'

export default function SharePage() {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SecretKind>('beach')
  const [where, setWhere] = useState('')
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [whySpecial, setWhySpecial] = useState('')
  const [howToGetThere, setHowToGetThere] = useState('')
  const [bestTime, setBestTime] = useState('')
  const [cautions, setCautions] = useState('')
  const [submitterName, setSubmitterName] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [savedPlace, setSavedPlace] = useState<string | null>(null)

  function useMyLocation() {
    if (!navigator.geolocation) { setError('Your browser can’t share its location — type the place instead.'); return }
    setStatus('locating'); setError('')
    navigator.geolocation.getCurrentPosition(
      pos => { setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setWhere(''); setStatus('idle') },
      () => { setError('We couldn’t get your location — type the place instead.'); setStatus('idle') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!pin && !where.trim()) { setError('Tell us where it is.'); return }
    setStatus('saving')
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, kind, whySpecial, howToGetThere, bestTime, cautions, submitterName, website,
          where: pin ? '' : where, lat: pin?.lat, lng: pin?.lng,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong. Please try again.'); setStatus('idle'); return }
      setSavedPlace(data.placeLabel ?? null)
      setStatus('done')
    } catch {
      setError('Something went wrong. Please try again.')
      setStatus('idle')
    }
  }

  function reset() {
    setName(''); setWhere(''); setPin(null); setWhySpecial(''); setHowToGetThere('')
    setBestTime(''); setCautions(''); setSavedPlace(null); setStatus('idle')
  }

  if (status === 'done') {
    return (
      <main className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🗝️</div>
        <h1 className="font-display text-3xl text-white mb-3">Secret’s safe with us.</h1>
        <p className="text-white/60 mb-8">
          Thanks for passing it along. Next time someone near {savedPlace ?? 'there'} is looking for exactly
          this kind of thing, Wild Bill will point them your way.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={reset} className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-5 py-3 rounded-xl transition-colors">
            Share another
          </button>
          <Link href="/" className="border border-white/15 hover:border-white/30 text-white/80 px-5 py-3 rounded-xl transition-colors">
            Back home
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <h1 className="font-display text-3xl sm:text-4xl text-white mb-2">🗝️ Share a local secret</h1>
      <p className="text-white/60 mb-8">
        The beach path only locals use, the swimming hole past the second bend, the taco window with no sign.
        Anywhere in the world. We’ll only show it to people looking for exactly that kind of thing nearby.
      </p>

      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="block text-sm font-medium text-white/80 mb-1.5">What’s it called?</span>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} maxLength={120} required
                 placeholder="e.g. Pounders Beach tide pools" />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-white/80 mb-1.5">What kind of spot?</span>
          <select className={inputCls} value={kind} onChange={e => setKind(e.target.value as SecretKind)}>
            {(Object.keys(SECRET_KINDS) as SecretKind[]).map(k => (
              <option key={k} value={k}>{SECRET_KINDS[k].label}</option>
            ))}
          </select>
        </label>

        <div>
          <span className="block text-sm font-medium text-white/80 mb-1.5">Where is it?</span>
          {pin ? (
            <div className="flex items-center justify-between gap-3 bg-yd-card2 border border-yd-orange/40 rounded-xl px-4 py-3">
              <span className="text-white/80 text-sm">📍 Using where you’re standing right now</span>
              <button type="button" onClick={() => setPin(null)} className="text-xs text-white/50 hover:text-white">Change</button>
            </div>
          ) : (
            <>
              <input className={inputCls} value={where} onChange={e => setWhere(e.target.value)} maxLength={200}
                     placeholder="Nearest town, landmark, or address" />
              <button type="button" onClick={useMyLocation} disabled={status === 'locating'}
                      className="mt-2 text-sm text-yd-yellow hover:text-yd-yellowHover disabled:opacity-50">
                {status === 'locating' ? 'Finding you…' : '📍 I’m there right now — use my location'}
              </button>
            </>
          )}
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-white/80 mb-1.5">Why is it special?</span>
          <textarea className={inputCls} rows={3} value={whySpecial} onChange={e => setWhySpecial(e.target.value)}
                    maxLength={600} required placeholder="What makes it worth the trip?" />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-white/80 mb-1.5">How do you get there? <span className="text-white/40 font-normal">(optional)</span></span>
          <textarea className={inputCls} rows={2} value={howToGetThere} onChange={e => setHowToGetThere(e.target.value)}
                    maxLength={600} placeholder="Where to park, which path to take, what to look for" />
        </label>

        <div className="grid sm:grid-cols-2 gap-5">
          <label className="block">
            <span className="block text-sm font-medium text-white/80 mb-1.5">Best time to go <span className="text-white/40 font-normal">(optional)</span></span>
            <input className={inputCls} value={bestTime} onChange={e => setBestTime(e.target.value)} maxLength={120}
                   placeholder="e.g. Low tide, early morning" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-white/80 mb-1.5">Anything to watch out for? <span className="text-white/40 font-normal">(optional)</span></span>
            <input className={inputCls} value={cautions} onChange={e => setCautions(e.target.value)} maxLength={300}
                   placeholder="e.g. Strong current in winter" />
          </label>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-white/80 mb-1.5">Your first name <span className="text-white/40 font-normal">(optional)</span></span>
          <input className={inputCls} value={submitterName} onChange={e => setSubmitterName(e.target.value)} maxLength={60} />
        </label>

        {/* Hidden from people; bots fill it in */}
        <input type="text" name="website" value={website} onChange={e => setWebsite(e.target.value)}
               tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        <p className="text-xs text-white/40">
          Please only share places the public can legally visit. Everything shared here is visible to everyone.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={status === 'saving'}
                className="w-full bg-yd-orange hover:bg-yd-orangeHover disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl transition-colors">
          {status === 'saving' ? 'Saving…' : 'Share this secret'}
        </button>
      </form>
    </main>
  )
}
