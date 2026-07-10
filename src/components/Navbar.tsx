'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { wipeHistory } from '@/lib/history'

export default function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [wiped, setWiped] = useState(false)

  function handleFreshSlate() {
    if (!showConfirm) { setShowConfirm(true); return }
    wipeHistory()
    setWiped(true)
    setShowConfirm(false)
    setTimeout(() => {
      setWiped(false)
      router.push('/')
      router.refresh()
    }, 1200)
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm font-medium transition-colors hover:text-white ${
        pathname === href ? 'text-white' : 'text-white/50'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <>
      <nav className="sticky top-0 z-40 bg-yd-bg/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-xl text-yd-orange tracking-wide shrink-0">
            YeahDoodle
          </Link>

          <div className="hidden sm:flex items-center gap-6">
            {navLink('/', 'Home')}
            {navLink('/discover', 'Discover')}
            {navLink('/saved', 'Saved')}
          </div>

          <div className="flex items-center gap-2">
            {wiped ? (
              <span className="text-xs text-yd-yellow font-medium px-3 py-1.5">
                ✓ Clean slate!
              </span>
            ) : showConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60">Wipe everything?</span>
                <button
                  onClick={handleFreshSlate}
                  className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Yes, reset
                </button>
                <button
                  onClick={() => setShowConfirm(false)}
                  className="text-xs text-white/50 hover:text-white px-2 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleFreshSlate}
                title="Wipe your history and start fresh"
                className="text-xs text-white/40 hover:text-white/70 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5"
              >
                🧹 Fresh Slate
              </button>
            )}

            <Link
              href="/saved"
              className="text-sm font-semibold bg-yd-orange hover:bg-yd-orangeHover text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </nav>

      <div className="sm:hidden flex items-center gap-6 px-4 py-2 bg-yd-navy border-b border-white/5">
        {navLink('/', 'Home')}
        {navLink('/discover', 'Discover')}
        {navLink('/saved', 'Saved')}
      </div>
    </>
  )
}
