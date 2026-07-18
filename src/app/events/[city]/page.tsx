import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { mapEventRow } from '@/lib/events'
import { getCityBySlug, CITIES } from '@/lib/cities'
import type { YDEvent, EventCategory } from '@/types'

export const revalidate = 3600

export function generateStaticParams() { return CITIES.map(c => ({ city: c.slug })) }

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: citySlug } = await params
  const c = getCityBySlug(citySlug)
  if (!c) return {}
  const title = `Events in ${c.display}, ${c.state} — YeahDoodle`
  const description = `Find the best things to do in ${c.display}. Concerts, food events, sports, arts, nightlife and more — updated daily.`
  return { title, description, openGraph: { title, description, url: `https://www.yeahdoodle.com/events/${citySlug}`, siteName: 'YeahDoodle', type: 'website' }, twitter: { card: 'summary_large_image', title, description }, alternates: { canonical: `https://www.yeahdoodle.com/events/${citySlug}` } }
}

async function fetchCityEvents(city: string, limit = 24) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anon) return { events: [] as YDEvent[], total: 0 }
  const sb = createClient(url, anon)
  const { data, count, error } = await sb.from('events').select('*', { count: 'exact' }).ilike('city', `%${city}%`).gte('date_start', new Date().toISOString()).order('date_start', { ascending: true }).limit(limit)
  if (error) return { events: [] as YDEvent[], total: 0 }
  return { events: (data ?? []).map(mapEventRow), total: count ?? 0 }
}

const CC: Record<string, string> = { 'Music': 'bg-purple-500/20 text-purple-300 border-purple-500/30', 'Food & Drink': 'bg-amber-500/20 text-amber-300 border-amber-500/30', 'Arts & Culture': 'bg-pink-500/20 text-pink-300 border-pink-500/30', 'Sports': 'bg-blue-500/20 text-blue-300 border-blue-500/30', 'Nightlife': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', 'Outdoors': 'bg-green-500/20 text-green-300 border-green-500/30', 'Community': 'bg-teal-500/20 text-teal-300 border-teal-500/30', 'Other': 'bg-white/10 text-white/60 border-white/10' }
const CG: Record<string, string> = { 'Music': 'from-purple-900 via-purple-800 to-indigo-900', 'Food & Drink': 'from-amber-900 via-orange-800 to-red-900', 'Arts & Culture': 'from-pink-900 via-rose-800 to-fuchsia-900', 'Sports': 'from-blue-900 via-sky-800 to-cyan-900', 'Nightlife': 'from-indigo-950 via-violet-900 to-purple-950', 'Outdoors': 'from-green-900 via-emerald-800 to-teal-900', 'Community': 'from-teal-900 via-cyan-800 to-emerald-900', 'Other': 'from-slate-800 via-gray-800 to-zinc-900' }

function fmtDate(d: string, t?: string) {
  if (!d) return 'Date TBA'
  const dt = new Date(d + 'T12:00:00')
  const label = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (!t) return label
  const [h, m] = t.split(':').map(Number), ampm = h >= 12 ? 'PM' : 'AM', hr = h % 12 || 12
  return `${label} · ${m === 0 ? `${hr} ${ampm}` : `${hr}:${String(m).padStart(2,'0')} ${ampm}`}`
}
function fmtPrice(mn?: number, mx?: number, free?: boolean) {
  if (free || (!mn && !mx)) return 'Free'
  if (!mx || mn === mx) return `$${mn}`
  return `$${mn}–$${mx}`
}

function Card({ event }: { event: YDEvent }) {
  return (
    <Link href={`/discover?city=${encodeURIComponent(event.city)}`} className="group bg-yd-card rounded-xl overflow-hidden border border-white/5 hover:border-yd-orange/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 block">
      <div className="relative w-full h-44 overflow-hidden">
        {event.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={event.imageUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          : <div className={`w-full h-full bg-gradient-to-br ${CG[event.category] ?? CG['Other']}`} />}
        <span className={`absolute top-2 left-2 text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-sm border ${CC[event.category] ?? CC['Other']}`}>{event.category}</span>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm leading-tight text-white line-clamp-2 mb-2 group-hover:text-yd-orange transition-colors">{event.title}</h3>
        <p className="text-xs text-white/50 mb-1 truncate">📍 {event.venueName}</p>
        <p className="text-xs text-white/40 mb-3">{fmtDate(event.date, event.time)}</p>
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold ${event.isFree ? 'text-green-400' : 'text-yd-yellow'}`}>{fmtPrice(event.priceMin, event.priceMax, event.isFree)}</span>
          <span className="text-xs text-yd-orange font-medium opacity-0 group-hover:opacity-100 transition-opacity">Find tickets →</span>
        </div>
      </div>
    </Link>
  )
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params
  const cfg = getCityBySlug(slug)
  if (!cfg) notFound()
  const { events, total } = await fetchCityEvents(cfg.display)
  const counts = events.reduce<Record<string, number>>((a, e) => { a[e.category] = (a[e.category] ?? 0) + 1; return a }, {})
  const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]) as EventCategory[]
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Events in ${cfg.display}, ${cfg.state}`, description: `Find the best things to do in ${cfg.display}.`, url: `https://www.yeahdoodle.com/events/${slug}`, publisher: { '@type': 'Organization', name: 'YeahDoodle', url: 'https://www.yeahdoodle.com' } }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="bg-yd-navy border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-yd-orange text-sm font-medium mb-2 uppercase tracking-widest">Events in</p>
              <h1 className="font-display text-4xl sm:text-5xl text-white mb-2">{cfg.display}</h1>
              <p className="text-white/50 text-sm">{total > 0 ? `${total.toLocaleString()} upcoming events · Updated daily` : 'Updated daily · Concerts, food, sports, arts & more'}</p>
            </div>
            <Link href={`/discover?city=${encodeURIComponent(cfg.display)}`} className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors inline-flex items-center gap-2 self-start sm:self-auto">Browse with filters →</Link>
          </div>
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-6">
              {cats.map(cat => (
                <Link key={cat} href={`/events/${slug}/${cat.toLowerCase().replace(/\s+&\s+/g,'-').replace(/\s+/g,'-')}`} className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:opacity-80 ${CC[cat] ?? CC['Other']}`}>
                  {cat} <span className="opacity-60">({counts[cat]})</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {events.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">{events.map(e => <Card key={e.id} event={e} />)}</div>
            {total > events.length && (
              <div className="text-center mt-10">
                <p className="text-white/40 text-sm mb-4">Showing {events.length} of {total.toLocaleString()} events</p>
                <Link href={`/discover?city=${encodeURIComponent(cfg.display)}`} className="bg-yd-card border border-white/10 hover:border-yd-orange/40 text-white/70 hover:text-white text-sm px-8 py-3 rounded-xl transition-colors inline-block">See all {total.toLocaleString()} events →</Link>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🗺️</div>
            <h2 className="font-display text-xl text-white mb-2">Events coming soon</h2>
            <p className="text-white/50 text-sm mb-6">We&apos;re pulling events for {cfg.display} now — check back shortly.</p>
            <Link href={`/discover?city=${encodeURIComponent(cfg.display)}`} className="bg-yd-orange hover:bg-yd-orangeHover text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors inline-block">Search {cfg.display} events</Link>
          </div>
        )}
      </div>
      <div className="border-t border-white/5 bg-yd-navy/50">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <h2 className="font-display text-lg text-white mb-4">More cities</h2>
          <div className="flex flex-wrap gap-2">{CITIES.filter(c => c.slug !== slug).slice(0,20).map(c => <Link key={c.slug} href={`/events/${c.slug}`} className="text-sm text-white/50 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-lg transition-colors">{c.display}</Link>)}</div>
        </div>
      </div>
    </>
  )
}
