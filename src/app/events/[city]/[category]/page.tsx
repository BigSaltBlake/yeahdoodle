import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { mapEventRow } from '@/lib/events'
import { getCityBySlug, CITIES } from '@/lib/cities'
import type { YDEvent, EventCategory } from '@/types'

export const revalidate = 3600

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------
const CATEGORIES: { slug: string; display: EventCategory; emoji: string }[] = [
  { slug: 'music',         display: 'Music',         emoji: '🎵' },
  { slug: 'food-drink',    display: 'Food & Drink',  emoji: '🍔' },
  { slug: 'arts-culture',  display: 'Arts & Culture',emoji: '🎨' },
  { slug: 'sports',        display: 'Sports',        emoji: '🏆' },
  { slug: 'nightlife',     display: 'Nightlife',     emoji: '🌙' },
  { slug: 'outdoors',      display: 'Outdoors',      emoji: '🌲' },
  { slug: 'community',     display: 'Community',     emoji: '🤝' },
  { slug: 'other',         display: 'Other',         emoji: '📅' },
]

function getCategoryBySlug(slug: string) {
  return CATEGORIES.find(c => c.slug === slug)
}

export function generateStaticParams() {
  const params: { city: string; category: string }[] = []
  for (const city of CITIES) {
    for (const cat of CATEGORIES) {
      params.push({ city: city.slug, category: cat.slug })
    }
  }
  return params
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------
export async function generateMetadata(
  { params }: { params: Promise<{ city: string; category: string }> }
): Promise<Metadata> {
  const { city: citySlug, category: catSlug } = await params
  const cityConfig = getCityBySlug(citySlug)
  const catConfig  = getCategoryBySlug(catSlug)
  if (!cityConfig || !catConfig) return {}

  const { display, state } = cityConfig
  const title = `${catConfig.display} Events in ${display}, ${state} — YeahDoodle`
  const description = `Discover the best ${catConfig.display.toLowerCase()} events in ${display}. Find upcoming shows, activities, and experiences — updated daily on YeahDoodle.`

  return {
    title,
    description,
    openGraph: { title, description, url: `https://www.yeahdoodle.com/events/${citySlug}/${catSlug}`, siteName: 'YeahDoodle', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
    alternates: { canonical: `https://www.yeahdoodle.com/events/${citySlug}/${catSlug}` },
  }
}

// ---------------------------------------------------------------------------
// Data fetch
// ---------------------------------------------------------------------------
async function fetchCategoryEvents(city: string, category: EventCategory, limit = 24): Promise<{ events: YDEvent[]; total: number }> {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anon) return { events: [], total: 0 }

  const sb = createClient(url, anon)
  const now = new Date().toISOString()

  const { data, count, error } = await sb
    .from('events')
    .select('*', { count: 'exact' })
    .ilike('city', `%${city}%`)
    .eq('category', category)
    .eq('is_duplicate', false)
    .gte('date_start', now)
    .order('date_start', { ascending: true })
    .limit(limit)

  if (error) return { events: [], total: 0 }
  return { events: (data ?? []).map(mapEventRow), total: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CATEGORY_COLORS: Record<string, string> = {
  'Music':         'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'Food & Drink':  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Arts & Culture':'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'Sports':        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Nightlife':     'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  'Outdoors':      'bg-green-500/20 text-green-300 border-green-500/30',
  'Community':     'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'Other':         'bg-white/10 text-white/60 border-white/10',
}

const CATEGORY_GRADIENTS: Record<string, string> = {
  'Music':         'from-purple-900 via-purple-800 to-indigo-900',
  'Food & Drink':  'from-amber-900 via-orange-800 to-red-900',
  'Arts & Culture':'from-pink-900 via-rose-800 to-fuchsia-900',
  'Sports':        'from-blue-900 via-sky-800 to-cyan-900',
  'Nightlife':     'from-indigo-950 via-violet-900 to-purple-950',
  'Outdoors':      'from-green-900 via-emerald-800 to-teal-900',
  'Community':     'from-teal-900 via-cyan-800 to-emerald-900',
  'Other':         'from-slate-800 via-gray-800 to-zinc-900',
}

function formatDate(dateStr: string, time?: string): string {
  if (!dateStr) return 'Date TBA'
  const date = new Date(dateStr + 'T12:00:00')
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
  const label = date.toLocaleDateString('en-US', opts)
  if (!time) return label
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  const timeStr = m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  return `${label} · ${timeStr}`
}

function formatPrice(min?: number, max?: number, isFree?: boolean): string {
  if (isFree || (!min && !max)) return 'Free'
  if (!max || min === max) return `$${min}`
  return `$${min}–$${max}`
}

function StaticEventCard({ event }: { event: YDEvent }) {
  const catColor = CATEGORY_COLORS[event.category] ?? CATEGORY_COLORS['Other']
  const gradient = CATEGORY_GRADIENTS[event.category] ?? CATEGORY_GRADIENTS['Other']

  return (
    <Link
      href={`/discover?city=${encodeURIComponent(event.city)}`}
      className="group bg-yd-card rounded-xl overflow-hidden border border-white/5 hover:border-yd-orange/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 block"
    >
      <div className="relative w-full h-44 overflow-hidden">
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${gradient}`} />
        )}
        <span className={`absolute top-2 left-2 text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm border ${catColor}`}>
          {event.category}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm leading-tight text-white line-clamp-2 mb-2 group-hover:text-yd-orange transition-colors">
          {event.title}
        </h3>
        <p className="text-xs text-white/50 mb-1 truncate">📍 {event.venueName}</p>
        <p className="text-xs text-white/40 mb-3">{formatDate(event.date, event.time)}</p>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold ${event.isFree ? 'text-green-400' : 'text-yd-yellow'}`}>
            {formatPrice(event.priceMin, event.priceMax, event.isFree)}
          </span>
          <span className="text-xs text-yd-orange font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            Find tickets →
          </span>
        </div>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function CityCategory(
  { params }: { params: Promise<{ city: string; category: string }> }
) {
  const { city: citySlug, category: catSlug } = await params
  const cityConfig = getCityBySlug(citySlug)
  const catConfig  = getCategoryBySlug(catSlug)
  if (!cityConfig || !catConfig) notFound()

  const { display, state } = cityConfig
  const { events, total } = await fetchCategoryEvents(display, catConfig.display)

  const SITE_URL = 'https://www.yeahdoodle.com'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${catConfig.display} Events in ${display}, ${state}`,
    description: `Discover the best ${catConfig.display.toLowerCase()} events in ${display}.`,
    url: `${SITE_URL}/events/${citySlug}/${catSlug}`,
    publisher: { '@type': 'Organization', name: 'YeahDoodle', url: SITE_URL },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb + hero */}
      <div className="bg-yd-navy border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-10">
          {/* Breadcrumb */}
          <nav className="text-xs text-white/40 mb-4 flex items-center gap-1.5">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <span>›</span>
            <Link href={`/events/${citySlug}`} className="hover:text-white transition-colors">{display}</Link>
            <span>›</span>
            <span className="text-white/60">{catConfig.display}</span>
          </nav>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-yd-orange text-sm font-medium mb-2 uppercase tracking-widest">
                {catConfig.emoji} {catConfig.display}
              </p>
              <h1 className="font-display text-4xl sm:text-5xl text-white mb-2">
                {display} <span className="text-white/40">Events</span>
              </h1>
              <p className="text-white/50 text-sm">
                {total > 0
                  ? `${total.toLocaleString()} upcoming ${catConfig.display.toLowerCase()} events`
                  : `Updated daily`}
              </p>
            </div>
            <Link
              href={`/discover?city=${encodeURIComponent(display)}`}
              className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors inline-flex items-center gap-2 self-start sm:self-auto"
            >
              Browse with filters →
            </Link>
          </div>

          {/* Other category pills */}
          <div className="flex flex-wrap gap-2 mt-6">
            {CATEGORIES.filter(c => c.slug !== catSlug).map(cat => (
              <Link
                key={cat.slug}
                href={`/events/${citySlug}/${cat.slug}`}
                className="text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-full transition-colors"
              >
                {cat.emoji} {cat.display}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Events grid */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {events.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {events.map(event => (
                <StaticEventCard key={event.id} event={event} />
              ))}
            </div>
            {total > events.length && (
              <div className="text-center mt-10">
                <p className="text-white/40 text-sm mb-4">Showing {events.length} of {total.toLocaleString()} events</p>
                <Link
                  href={`/discover?city=${encodeURIComponent(display)}`}
                  className="bg-yd-card border border-white/10 hover:border-yd-orange/40 text-white/70 hover:text-white text-sm px-8 py-3 rounded-xl transition-colors inline-block"
                >
                  See all {total.toLocaleString()} {catConfig.display.toLowerCase()} events →
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">{catConfig.emoji}</div>
            <h2 className="font-display text-xl text-white mb-2">
              {catConfig.display} events coming soon
            </h2>
            <p className="text-white/50 text-sm mb-6">
              We&apos;re adding {catConfig.display.toLowerCase()} events in {display} daily — check back shortly.
            </p>
            <Link href={`/events/${citySlug}`} className="text-yd-orange hover:underline text-sm font-medium">
              ← All {display} events
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
