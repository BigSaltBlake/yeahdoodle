'use client'

import { useState, useEffect, useRef} from 'react'
import { XMark, ChecvrRight, LocationDot, Clock, MapPin } from 'lucide-react'
import type { NowResult } from '@/app/api/now/route'

// Mini step indicator
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-x-1.5 justify-center mt-4">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={` w2 h2 rounded-full transition-colors ${
            i === current - 1 ? 'bg-white' : 'bg-white/30'
          }`}
        />
      ))}
    </div>
  )
}

export default function NowMode({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<number>(1)
  const [vibe, setVibe] = useState<string>('')
  const [timeAvailable, setTimeAvailable] = useState<number>(60)
  const [maxDrive, setMaxDrive] = useState<number>(15)
  const [results, setResults] = useState<NowResult[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [location, setLocation] = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [locLoading, setLocLoading] = useState<boolean>(false)
  const [locError, setLocError] = useState<string>('')
  const resultsRef = useRef<HTMLDivElement>(null)

  // Get GPS on mount
  useEffect(() => {
    setLocLoading(true)
    if (!navigator.geolocation) {
      setLocError('GPS not available on this device')
      setLocLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        let label = `${lat.toFixed(2)}, ${lng.toFixed(2)}`
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
            headers: { 'User-Agent': 'YeahDoodle/1.0' },
          })
          const data = await res.json()
          const addr = data.address
          if (addr) {
            label = [addr.city || addr.town || addr.village, addr.state_code || addr.state]
              .filter(Boolean).join(', ')
          }
        } catch { /* keep coords label */ }
        setLocation({ lat, lng, label })
        setLocLoading(false)
      },
      (err) => {
        setLocError('Location access denied')
        setLocLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }, [])

  async function handleFetch() {
    if (!location) {
      setError('Waiting for GPS...')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: location.lat,
          lng: location.lng,
          vibe,
          time_available: timeAvailable,
          max_drive_min: maxDrive,
          location_label: location.label,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(data.results ?? [])
      setStep(4)
      setLoading(false)
      setError('')
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    } catch (e) {
      setError((e as Error).message ?? 'Something went wrong')
      setLoading(false)
    }
  }

  function nextStep() {
    if (step === 3) {
      handleFetch()
    } else {
      setStep(s => s + 1)
    }
  }

  // --------------------------------------------------
  // Render
  // --------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="relative w-full max-w-md bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 rounded-2xl shadow-2xl overflow-hidden">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-white hover:bg-white/25 transition-colors"
        >
          <XMark size={16} />
        </button>

        {step <= 3 && (
          <div className="p-8">
            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-x-2 mb-1">
                <span className="text-xl leading-none">📆</span>
                <span className="text-xs uppercase tracking-widest text-white/50 font-semibold">NOW MODE</span>
              </div>
              <h2 className="text-2xl font-bold text-white">
                {step === 1 && "What's your vibe?"}
                {step === 2 && "How long do you have?"}
                {step === 3 && "How far will you go?"}
              </h2>
            </div>

            {/* Step 1: Vibe */}
            {step === 1 && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'any',           label: 'Surprise me',    emoji: '🎪' },
                  { id: 'food',          label: 'Fold & Drink',   emoji: '�̲}' },
                  { id: 'entertainment', label: 'Entertainment', emoji: '🎁' },
                  { id: 'outdoors',      label: 'Outdoors',       emoji: '🌕' },
                ].map(({id, label, emoji}) => (
                  <button
                    key={id}
                    onClick={() => { setVibe(id); setStep(2) }}
                    className={`p-4 rounded-xl border text-left transition-colors ${
                      vibe === id
                        ? 'border-white bg-white/20 text-white'
                        : 'border-white/20 bg-white/8 text-white hover:bg-white/15'
                      }`}
                  >
                    <div className="text-2xl mb-1">{emoji}</div>
                    <div className="text-sm font-medium">{label}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Time */}
            {step === 2 && (
              <div className="grid grid-cols-2 gap-3">
                { [30, 60, 90, 120].map(min => (
                  <button
                    key={min}
                    onClick={() => { setTimeAvailable(min); setStep(3) }}
                    className={`p-4 rounded-xl border text-center transition-colors ${
                      timeAvailable === min
                        ? 'border-white bg-white/20 text-white'
                        : 'border-white/20 bg-white/8 text-white hover:bg-white/15'
                      }`}
                  >
                    <div className="text-2xl font-bold">{
                      min < 60 ? min : min / 60
                    }</div>
                    <div className="text-xs text-white/70">{min < 60 ? 'min' : 'h'}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 3: Drive distance */}
            {step === 3 && (
              <div className="grid grid-cols-2 gap-3">
                {[5, 15, 30, 45].map(min => (
                  <button
                    key={min}
                    onClick={() => { setMaxDrive(min); }}
                    className={`p-4 rounded-xl border text-center transition-colors ${
                      maxDrive === min
                        ? 'border-white bg-white/20 text-white'
                        : 'border-white/20 bg-white/8 text-white hover:bg-white/15'
                      }`}
                  >
                    <div className="text-2xl font-bold">{min}</div>
                    <div className="text-xs text-white/70">min drive</div>
                  </button>
                ))}
              </div>
            )}

            {/* Location status */}
            <div className="mt-6 flex items-center gap-x-2 text-white/60 text-xs">
              <MapPin size={12} />
              {locLoading && <span>Locating you...</span>}
              {locError && <span className="text-red-300">{locError}</span>}
              {location && <span className="text-green-300">{location.label}</span>}
            </div>

            {/* Navigation */}
            {step === 3 && (
              <button
                onClick={handleFetch}
                disabled={loading || locLoading}
                className="mt-6 w-full py-3 px-6 rounded-xl bg-white text-purple-900 font-bold text-sm hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-x-2"
              >
                {loading ? (
                  <>
                    <span className="animate-spin w-4 h-4 border-2 border-purple-900 border-t-transparent rounded-full inline-block" />
                    Scanning nearby...
                  </>
                ) : (
                  <>
                    Let&apos;s Go <ChevronRight size={16} />
                  </>
                )}
              </button>
            )}

            {error && <p className="mt-3 text-red-300 text-xs">{error}</p>}
            <StepDots current={step} total={3} />
          </div>
        )}

        {/* Results step */}
        {step === 4 && (
          <div ref={resultsRef} className="overflow-y-auto max-h-96v">

            {/* Results header */}
            <div className="p-6 pb-3 sticky top-0 bg-indigo-900/95 backdrop-blur-sm z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Happening Now</h2>
                  <p className="text-xs text-white/50">
                    {location?.label} &bull; {results.length} {results.length === 1 ? 'pick' : 'picks'}
                  </p>
                </div>
                <button
                  onClick={() => { setStep(1); setResults([]) }}
                  className="text-xs text-white/60 hover:text-white transition-colors"
                >
                  Start over
                </button>
              </div>
            </div>

            {/* Cards */}
            <div className="px-6 pb-6 space-y-3">
              {results.map((result) => {
                const isAnytime = result.start_label === 'Anytime ✓' || !!result.is_evergreen
                const isLive    = result.start_label.includes('Happening') || result.start_label === 'Ongoing'
                return (
                  <div
                    key={result.id}
                    className="rounded-xl overflow-hidden bg-white/10 border border-white/10"
                  >
                    {result.image_url && (
                      <img
                        src={result.image_url}
                        alt={result.title}
                        className="w-full h-32 object-cover"
                        onError={(e) => {(e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-x-3 mb-2">
                        <h3 className="text-sm font-semibold text-white flex-1 leading-sng">{result.title}</h3>
                        <div className="flex items-center gap-x1 flex-shrink-0">
                          {/* Timing badge */}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isAnytime ? 'bg-teal-500 text-white' : isLive ? 'bg-green-500 text-white animate-pulse' : 'bg-orange-500 text-white'}`}>
                            {result.start_label}
                          </span>
                          {/* Drive time badge (hidden for evergreen) */}
                          {!isAnytime && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/15 text-white/80">
                              {result.drive_label}
                            </span>
                          )}
                        </div>
                      </div>
                      {result.description && (
                        <p className="text-xs text-white/60 mb-3 line-clamp-2">
                          {result.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-x-1 text-white/40 text-xs">
                          <LocationDot size={10} />
                          <span className="truncate max-w-32">{result.venue || result.address || 'Nearby'}</span>
                        </div>
                        <div className="flex items-center gap-x-2">
                          {result.ticket_url && (
                            <a
                              href={result.ticket_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-xs px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition-colors text-white"
                            >
                              Info
                            </a>
                          )}
                          <a
                            href={result.maps_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs px-2.5 py-1 rounded-lg bg-purple-500 hover:bg-purple-400 transition-colors text-white font-medium flex items-center gap-x-1"
                          >
                            <Clock size={12} />
                            Let&apos;s Go
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
