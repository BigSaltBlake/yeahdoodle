'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import CategoryPlaceholder from '@/components/CategoryPlaceholder'

interface Pick {
  id: string
  rank: number
  pitch: string
  title: string
  venue: string
  dateFormatted: string
  priceFormatted: string
  ticketUrl: string | null
  imageUrl: string | null
  category: string
}

const MEDALS = ['🥇', '🥈', '🥉']

function PicksContent() {
  const params = useSearchParams()
  const city = params.get('city') || ''
  const ids = params.get('ids') || ''

  const [picks, setPicks] = useState<Pick[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!ids) { setError(true); setLoading(false); return }
    async function load() {
      try {
        const res = await fetch('/api/picks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ city, ids: ids.split(',') }),
        })
        if (!res.ok) throw new Error('not ok')
        const data = await res.json()
        setPicks(data.picks || [])
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [city, ids])

  if (loading) {
    return (
      <div className="min-h-screen bg-yd-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🎯</div>
          <p className="text-white/40">Loading picks...</p>
        </div>
      </div>
    )
  }

  if (error || picks.length === 0) {
    return (
      <div className="min-h-screen bg-yd-bg flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">😕</div>
          <h1 className="font-display text-2xl text-white mb-2">These picks have expired</h1>
          <p className="text-white/40 text-sm mb-6">Events move fast — find fresh picks for tonight.</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-yd-orange hover:bg-yd-orangeHover text-white font-bold px-6 py-3 rounded-xl transition-colors text-sm">
            🎯 Find My Perfect Event →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-yd-bg">
      <div className="bg-yd-card border-b border-white/10 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <Link href="/" className="font-display text-yd-orange text-lg font-bold">YeahDoodle</Link>
          <span className="text-white/30 text-xs">📍 {city || 'nearby'}</span>
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="font-display text-2xl text-white mb-1">Tonight&apos;s top picks</h1>
          <p className="text-white/40 text-sm">Someone found these just for you 🎯</p>
        </div>
        <div className="space-y-4">
          {picks.map((pick, i) => (
            <div key={pick.id} className="bg-yd-card border border-white/10 rounded-xl overflow-hidden">
              <div className="relative w-full h-40">
                {pick.imageUrl ? (
                  <Image src={pick.imageUrl} alt={pick.title} fill className="object-cover" sizes="512px" />
                ) : (
                  <CategoryPlaceholder category={pick.category} />
                )}
                <span className="absolute top-2 left-2 text-2xl leading-none drop-shadow-lg">{MEDALS[i]}</span>
              </div>
              <div className="p-4">
                <p className="font-semibold text-white text-base leading-snug mb-1">{pick.title}</p>
                <p className="text-white/40 text-xs mb-2">
                  {pick.venue && <span>{pick.venue} · </span>}
                  {pick.dateFormatted} · {pick.priceFormatted}
                </p>
                <p className="text-yd-orange/80 text-sm italic leading-relaxed mb-3">&ldquo;{pick.pitch}&rdquo;</p>
                {pick.ticketUrl && (
                  <a href={pick.ticketUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 bg-yd-orange hover:bg-yd-orangeHover text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">
                    Let&apos;s go →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center bg-yd-card border border-white/10 rounded-2xl p-6">
          <p className="text-white/60 text-sm mb-3">Want picks matched to <em>your</em> vibe?</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-yd-orange hover:bg-yd-orangeHover text-white font-bold px-6 py-3 rounded-xl transition-colors text-sm">
            🎯 Find My Perfect Event →
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function PicksPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-yd-bg flex items-center justify-center"><div className="text-5xl animate-bounce">🎯</div></div>}>
      <PicksContent />
    </Suspense>
  )
}