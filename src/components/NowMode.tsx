'use client'

import { useState, useEffect, useRef } from 'react'
import type { NowResult } from '@/app/api/now/route'

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
type TimeOption   = 30 | 60 | 120 | 180
type DriveOption  = 5 | 15 | 30
type VibeOption   = 'any' | 'food' | 'entertainment' | 'outdoors'

const TIME_OPTIONS: { value: TimeOption; label: string; sublabel: string }[] = [
  { value: 30,  label: '30 min',   sublabel: 'Quick stop'     },
  { value: 60,  label: '1 hour',   sublabel: 'Quick outing'   },
  { value: 120, label: '2 hours',  sublabel: 'Good stretch'   },
  { value: 180, label: '3+ hours', sublabel: 'Make a night'   },
]

const DRIVE_OPTIONS: { value: DriveOption; label: string; sublabel: string }[] = [
  { value: 5,  label: '5 min',  sublabel: 'Staying close'   },
  { value: 15, label: '15 min', sublabel: 'Short drive'     },
  { value: 30, label: '30 min', sublabel: 'Worth the trip'  },
]

const VIBE_OPTIONS: { value: VibeOption; label: string; emoji: string }[] = [
  { value: 'any',           label: 'Whatever\'s close', emoji: '⚡' },
  { value: 'food',          label: 'Food & Drinks',     emoji: '🍻' },
  { value: 'entertainment', label: 'Live Entertainment',emoji: '🎸' },
  { value: 'outdoors',      label: 'Outdoors',          emoji: '🌿' },
]

// ---------------------------------------------------------------------------
// Wild Bill catchphrase files (same as WildBill.tsx)
// ---------------------------------------------------------------------------
const CATCHPHRASE_FILES = ['/WB-YD3.m4a', '/WB-YD1.m4a', '/WB-YD2.m4a']

function playYeahDoodle() {
  const file = CATCHPHRASE_FILES[Math.floor(Math.random() * CATCHPHRASE_FILES.length)]
  const audio = new Audio(file)
  audio.play().catch(() => {})
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------
function ResultCard({
  result,
  onLetsGo,
}: {
  result: NowResult
  onLetsGo: (r: NowResult) => void
}) {
  const isNow     = result.start_label === 'Happening now' || result.start_label === 'Ongoing'
  const isAnytime = result.start_label === 'Anytime ✓' || !!result.is_evergreen
  const isClose   = result.drive_minutes <= 5

  return (
    <div className="bg-[#1a1a2e] border border-white/8 rounded-2xl overflow-hidden flex flex-col hover:border-yd-orange/30 transition-colors group">
      {/* Image */}
      <div className="relative h-36 shrink-0 overflow-hidden bg-white/5">
        {result.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.image_url}
            alt={result.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        {/* Status badges */}
        <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isNow     ? 'bg-green-500 text-white animate-pulse' :
            isAnytime ? 'bg-teal-500 text-white' :
                        'bg-yd-orange text-white'
          }`}>
            {result.start_label}
          </span>
          {!isAnytime && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              isClose ? 'bg-white text-yd-bg' : 'bg-black/60 text-white'
            }`}>
              {result.drive_label}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="text-yd-orange text-xs font-semibold mb-1 uppercase tracking-wide">
          {result.category}
        </div>
        <h3 className="text-white font-bold text-base leading-snug mb-1 line-clamp-2">
          {result.title}
        </h3>
        {result.venue && (
          <p className="text-white/40 text-xs mb-2">📍 {result.venue}</p>
        )}
        {result.description && (
          <p className="text-white/60 text-xs leading-relaxed line-clamp-2 mb-3 flex-1">
            {result.description}
          </p>
        )}

        {/* Let's Go button */}
        <button
          onClick={() => onLetsGo(result)}
          className="mt-auto w-full bg-yd-orange hover:bg-amber-500 text-white font-bold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          <span>Let&apos;s Go!</span>
          <span className="text-base">🤠</span>
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main NowMode component
// ---------------------------------------------------------------------------
interface NowModeProps {
  open: boolean
  onClose: () => void
}

export default function NowMode({ open, onClose }: NowModeProps) {
  const [step, setStep] = useState<'time' | 'drive' | 'vibe' | 'loading' | 'results'>('time')
  const [timeAvailable, setTimeAvailable] = useState<TimeOption>(60)
  const [maxDrive, setMaxDrive] = useState<DriveOption>(15)
  const [vibe, setVibe] = useState<VibeOption>('any')
  const [results, setResults] = useState<NowResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showYeahDoodle, setShowYeahDoodle] = useState(false)
  const [selectedTitle, setSelectedTitle] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep('time')
      setResults([])
      setError(null)
      setShowYeahDoodle(false)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function fetchResults(t: TimeOption, d: DriveOption, v: VibeOption) {
    setStep('loading')
    setError(null)

    // Get GPS
    let lat: number | null = null
    let lng: number | null = null
    let locationLabel = ''

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude

      // Reverse geocode for better Serper queries
      const geo = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'User-Agent': 'YeahDoodle/1.0' } }
      ).then(r => r.json()).catch(() => null)
      if (geo?.address) {
        const addr = geo.address
        locationLabel = addr.city || addr.town || addr.village || addr.county || ''
      }
    } catch {
      setError('We need your location to find what\'s happening nearby. Please allow location access and try again.')
      setStep('vibe')
      return
    }

    try {
      const res = await fetch('/api/now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          time_available: t,
          max_drive_min: d,
          vibe: v,
          location_label: locationLabel,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'API error')

      if (!data.results || data.results.length === 0) {
        setError('Nothing matched your filters right now — try a wider drive range or more time.')
        setStep('results')
        setResults([])
        return
      }

      setResults(data.results)
      setStep('results')
    } catch (err) {
      setError('Something went wrong fetching results. Try again in a sec.')
      setStep('results')
    }
  }

  function handleLetsGo(result: NowResult) {
    // Play Wild Bill "Yeah Doodle!!"
    playYeahDoodle()
    setSelectedTitle(result.title)
    setShowYeahDoodle(true)
    setTimeout(() => setShowYeahDoodle(false), 3000)

    // Open maps for directions after a short delay (let the audio start first)
    setTimeout(() => {
      window.open(result.maps_url, '_blank')
    }, 400)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* "Yeah Doodle!!" bubble */}
      {showYeahDoodle && (
        <div className="fixed bottom-28 right-6 z-[60] pointer-events-none animate-bounce-in">
          <div className="bg-yd-orange text-white font-display text-2xl px-6 py-3 rounded-2xl rounded-br-none shadow-2xl whitespace-nowrap">
            Yeah Doodle! 🤠
          </div>
          <div className="text-xs text-white/60 text-right mt-1 pr-2">{selectedTitle.slice(0, 30)}</div>
        </div>
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative w-full sm:max-w-xl bg-[#0f0f1a] rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/8 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs font-bold uppercase tracking-widest">Live Now</span>
            </div>
            <h2 className="font-display text-white text-xl">What&apos;s Happening Near You?</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/80 transition-colors text-xl w-8 h-8 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-5">

          {/* ── Step: Time ── */}
          {step === 'time' && (
            <div>
              <p className="text-white/60 text-sm mb-5">How much time do you have to kill?</p>
              <div className="grid grid-cols-2 gap-3">
                {TIME_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setTimeAvailable(opt.value)
                      setStep('drive')
                    }}
                    className="bg-white/5 hover:bg-yd-orange/20 border border-white/10 hover:border-yd-orange/50 rounded-xl p-4 text-left transition-all group"
                  >
                    <div className="font-bold text-white text-lg group-hover:text-yd-orange transition-colors">
                      {opt.label}
                    </div>
                    <div className="text-white/40 text-xs mt-0.5">{opt.sublabel}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Drive ── */}
          {step === 'drive' && (
            <div>
              <button
                onClick={() => setStep('time')}
                className="text-white/40 hover:text-white/70 text-xs mb-4 flex items-center gap-1"
              >
                ← Back
              </button>
              <p className="text-white/60 text-sm mb-1">
                You&apos;ve got <span className="text-white font-semibold">{timeAvailable >= 60 ? `${timeAvailable / 60} hr${timeAvailable > 60 ? 's' : ''}` : `${timeAvailable} min`}</span>.
              </p>
              <p className="text-white/60 text-sm mb-5">How far are you willing to drive?</p>
              <div className="grid grid-cols-3 gap-3">
                {DRIVE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setMaxDrive(opt.value)
                      setStep('vibe')
                    }}
                    className="bg-white/5 hover:bg-yd-orange/20 border border-white/10 hover:border-yd-orange/50 rounded-xl p-4 text-center transition-all group"
                  >
                    <div className="font-bold text-white text-base group-hover:text-yd-orange transition-colors">
                      {opt.label}
                    </div>
                    <div className="text-white/40 text-xs mt-0.5">{opt.sublabel}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Vibe ── */}
          {step === 'vibe' && (
            <div>
              <button
                onClick={() => setStep('drive')}
                className="text-white/40 hover:text-white/70 text-xs mb-4 flex items-center gap-1"
              >
                ← Back
              </button>
              {error && (
                <div className="bg-red-500/20 border border-red-500/30 text-red-300 text-xs rounded-xl p-3 mb-4">
                  {error}
                </div>
              )}
              <p className="text-white/60 text-sm mb-5">What are you in the mood for?</p>
              <div className="grid grid-cols-2 gap-3">
                {VIBE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setVibe(opt.value)
                      fetchResults(timeAvailable, maxDrive, opt.value)
                    }}
                    className="bg-white/5 hover:bg-yd-orange/20 border border-white/10 hover:border-yd-orange/50 rounded-xl p-4 text-left transition-all group flex items-center gap-3"
                  >
                    <span className="text-2xl">{opt.emoji}</span>
                    <span className="font-semibold text-white text-sm group-hover:text-yd-orange transition-colors">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step: Loading ── */}
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-yd-orange/20" />
                <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-yd-orange animate-spin" />
              </div>
              <p className="text-white font-semibold text-lg">Scouting the area...</p>
              <p className="text-white/40 text-sm">Finding what&apos;s happening within {maxDrive} min of you</p>
            </div>
          )}

          {/* ── Step: Results ── */}
          {step === 'results' && (
            <div>
              {error ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">🤠</div>
                  <p className="text-white/60 text-sm mb-4">{error}</p>
                  <button
                    onClick={() => setStep('time')}
                    className="bg-yd-orange hover:bg-amber-500 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-colors"
                  >
                    Try different options
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-white/60 text-xs">
                      {results.length} thing{results.length !== 1 ? 's' : ''} within {maxDrive} min of you
                    </p>
                    <button
                      onClick={() => setStep('time')}
                      className="text-yd-orange hover:text-amber-400 text-xs font-semibold transition-colors"
                    >
                      Search again →
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {results.map(r => (
                      <ResultCard
                        key={r.id}
                        result={r}
                        onLetsGo={handleLetsGo}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Progress dots */}
        {(step === 'time' || step === 'drive' || step === 'vibe') && (
          <div className="flex justify-center gap-1.5 pb-5 shrink-0">
            {(['time', 'drive', 'vibe'] as const).map(s => (
              <div
                key={s}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  step === s ? 'bg-yd-orange' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
