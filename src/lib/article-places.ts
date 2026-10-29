// ---------------------------------------------------------------------------
// Places named in articles — a local blog or travel story is homework, not a
// pick, but the spots it names can be. One web search, the top few pages
// read, and Claude lists only the places those pages actually name, each
// with what the page says about it and credit to the site.
// Every one is still checked on Google Maps before anyone sees it.
// ---------------------------------------------------------------------------

import { unstable_cache } from 'next/cache'

export interface ArticleEventRow {
  id: string
  title: string
  venue_name: null
  date_start: null
  is_free: boolean
  price_min: null
  price_max: null
  category: string
  ticket_url: null
  image_url: null
  description: string
  ai_description: null
  distanceLabel: string
  source: 'article'
  /** Where we read about it */
  credit: { site: string; url: string }
  /** What to type into Google Maps to find exactly this place */
  search: string
}

type Organic = { title?: string; link?: string; snippet?: string }
type Page = { site: string; url: string; text: string }

// Video and social pages have no readable text worth extracting
const SKIP_SITES = /(^|\.)(youtube|youtu|facebook|instagram|tiktok|pinterest|twitter|x|linkedin)\.(com|be)$/i

function siteName(html: string, url: string): string {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,60})["']/i)
          ?? html.match(/<meta[^>]+content=["']([^"']{2,60})["'][^>]+property=["']og:site_name["']/i)
  return og?.[1]?.trim() || new URL(url).hostname.replace(/^www\./, '')
}

function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-').replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

async function readPage(r: Organic): Promise<Page | null> {
  if (!r.link) return null
  const fallback = r.snippet
    ? { site: new URL(r.link).hostname.replace(/^www\./, ''), url: r.link, text: `${r.title ?? ''}\n${r.snippet}` }
    : null
  try {
    const res = await fetch(r.link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YeahDoodle/1.0; +https://yeahdoodle.com)' },
      signal: AbortSignal.timeout(3500),
      cache: 'no-store',
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return fallback
    const html = (await res.text()).slice(0, 400_000)
    const text = pageText(html)
    // A blocked or script-only page leaves almost nothing behind
    if (text.length < 400) return fallback
    return { site: siteName(html, r.link), url: r.link, text: text.slice(0, 7000) }
  } catch {
    return fallback
  }
}

async function findArticlePlaces(params: {
  want: string
  town: string
  isTourist: boolean
  categories: string[]
}): Promise<ArticleEventRow[]> {
  const serperKey = process.env.SERPER_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const { want, town, isTourist, categories } = params
  if (!serperKey || !anthropicKey || !town) return []

  // "Get outside 🌲" → "Get outside"
  const wantText = want.replace(/[^A-Za-z0-9&' -]/g, '').trim()
  const q = isTourist
    ? `${wantText} ${town} best places to visit`
    : `${wantText} ${town} hidden gems locals love`

  const search = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: 8 }),
    signal: AbortSignal.timeout(4000),
    cache: 'no-store',
  })
  if (!search.ok) throw new Error('serper ' + search.status)
  const organic = ((await search.json()).organic ?? []) as Organic[]

  const sources = organic
    .filter(r => {
      try { return !!r.link && !SKIP_SITES.test(new URL(r.link).hostname.replace(/^www\./, '')) }
      catch { return false }
    })
    .slice(0, 3)
  const pages = (await Promise.all(sources.map(readPage))).filter((p): p is Page => !!p)
  if (!pages.length) throw new Error('no readable pages')

  const prompt = `Below are ${pages.length} web pages about ${town}. List the specific, real places they name that someone could go to for: "${wantText}".${isTourist
    ? ' They are visiting, so places the town is known for are good.'
    : ' They live here, so favor the local favorites and hidden spots the pages mention over the famous ones.'}

STRICT:
- Only places a page names outright (a park, trail, lake, museum, garden, landmark, venue, restaurant…). Never add a place from your own knowledge.
- Only places in or within about 30 miles of ${town}. Many towns share a name with a more famous place — skip anything from the other one.
- No chains, hotels, malls, stores, tour companies, towns or neighborhoods.
- "says" is what that page says about the place, in your own words, max 25 words. Nothing the page doesn't say.
- "search" is what to type into Google Maps to find exactly this place: its proper name plus the town.
- "category" is exactly one of: ${categories.join(', ')}.
- At most 6 places, best fit first. If none fit, return [].

${pages.map((p, i) => `=== PAGE ${i + 1}: ${p.site} ===\n${p.text}`).join('\n\n')}

Return ONLY a JSON array:
[{"name":"<place name>","search":"<name, town>","page":<page number>,"says":"<what the page says>","category":"<category>"}]`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('anthropic ' + res.status)
  const text: string = (await res.json()).content?.[0]?.text ?? '[]'
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  type Found = { name?: string; search?: string; page?: number; says?: string; category?: string }
  const seen = new Set<string>()
  return (JSON.parse(match[0]) as Found[])
    .flatMap((f, i) => {
      const page = pages[(Number(f.page) || 1) - 1]
      const name = f.name?.trim()
      if (!name || !page || seen.has(name.toLowerCase())) return []
      seen.add(name.toLowerCase())
      return [{
        id:             `article-${i}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
        title:          name,
        venue_name:     null,
        date_start:     null,
        is_free:        false,
        price_min:      null,
        price_max:      null,
        category:       categories.includes(f.category ?? '') ? f.category! : categories[0],
        ticket_url:     null,
        image_url:      null,
        description:    `${(f.says ?? '').trim()} (named in ${page.site})`,
        ai_description: null,
        distanceLabel:  '',
        source:         'article' as const,
        credit:         { site: page.site, url: page.url },
        search:         f.search?.trim() || `${name} ${town}`,
      }]
    })
    .slice(0, 6)
}

// Failures throw, so only real answers (even "none here") are kept for a day
const cachedArticlePlaces = unstable_cache(findArticlePlaces, ['article-places-v1'], { revalidate: 86400 })

/** Places named in the top web articles for this want and town */
export async function getArticlePlaces(params: Parameters<typeof findArticlePlaces>[0]): Promise<ArticleEventRow[]> {
  try {
    return await cachedArticlePlaces(params)
  } catch (err) {
    console.warn('[article-places]', String(err).slice(0, 200))
    return []
  }
}
