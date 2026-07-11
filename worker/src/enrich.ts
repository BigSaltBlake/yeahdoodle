/**
 * AI description enrichment step
 *
 * After each sync run, this step finds events with null ai_description
 * and generates a punchy 2-sentence description using Claude Haiku.
 *
 * Cost estimate: ~$0.002 per 1000 events (Haiku input + output tokens).
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Db } from './lib/db'

const BATCH_SIZE = 20
const MAX_EVENTS = 200
const MODEL      = 'claude-haiku-4-5'

interface EventRow {
  id: string
  title: string
  category: string
  description: string | null
  venue_name: string | null
  city: string | null
  state: string | null
  date_start: string | null
}

function buildPrompt(event: EventRow): string {
  const when = event.date_start
    ? new Date(event.date_start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'upcoming'
  const where = [event.venue_name, event.city, event.state].filter(Boolean).join(', ')
  const raw = event.description ? `\n\nSource description: "${event.description.slice(0, 300)}"` : ''

  return `You are writing concise, exciting event descriptions for YeahDoodle, a social event discovery app.

Event: ${event.title}
Category: ${event.category}
When: ${when}
Where: ${where}${raw}

Write exactly 2 sentences that make someone want to go. Be specific, vivid, and energetic. No filler phrases like "Don't miss" or "Join us". Output only the 2 sentences, nothing else.`
}

async function enrichBatch(client: Anthropic, events: EventRow[], db: Db): Promise<number> {
  const results = await Promise.allSettled(
    events.map(async (event) => {
      const msg = await client.messages.create({
        model:      MODEL,
        max_tokens: 120,
        messages:   [{ role: 'user', content: buildPrompt(event) }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : null
      if (!text) return

      const { error } = await db
        .from('events')
        .update({ ai_description: text })
        .eq('id', event.id)

      if (error) throw new Error(`DB update failed for ${event.id}: ${error.message}`)
    }),
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed    = results.filter(r => r.status === 'rejected')
  failed.forEach(r => console.error('[Enrich] batch item failed:', (r as PromiseRejectedResult).reason))
  return succeeded
}

export async function enrichDescriptions(db: Db): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[Enrich] ANTHROPIC_API_KEY not set — skipping enrichment')
    return
  }

  const { data: events, error } = await db
    .from('events')
    .select('id, title, category, description, venue_name, city, state, date_start')
    .is('ai_description', null)
    .not('title', 'is', null)
    .gte('date_start', new Date().toISOString())
    .order('date_start', { ascending: true })
    .limit(MAX_EVENTS)

  if (error) { console.error('[Enrich] Failed to fetch events:', error.message); return }
  if (!events?.length) { console.log('[Enrich] No events need enrichment.'); return }

  console.log(`[Enrich] Enriching ${events.length} events with Claude Haiku...`)

  const client = new Anthropic({ apiKey })
  let totalEnriched = 0

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE) as EventRow[]
    const n = await enrichBatch(client, batch, db)
    totalEnriched += n
    console.log(`[Enrich] Batch ${Math.floor(i / BATCH_SIZE) + 1}: +${n} (${totalEnriched} total)`)
    if (i + BATCH_SIZE < events.length) await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`[Enrich] Done. ${totalEnriched}/${events.length} events enriched.`)
}
