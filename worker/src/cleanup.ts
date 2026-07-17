import type { Db } from './lib/db'
export async function deleteExpiredEvents(db: Db): Promise<void> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 1)
  const cutoffIso = cutoff.toISOString()
  const { error, count } = await db.from('events').delete({ count: 'exact' }).lt('date_start', cutoffIso)
  if (error) throw new Error('Cleanup failed: ' + error.message)
  console.log('[Cleanup] Deleted ' + (count ?? 0) + ' expired events (before ' + cutoffIso.slice(0, 10) + ')')
}