// TEST-only manual trigger. Intentionally refuses every Production deployment.
import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js'
import { executeAvailabilityCalendarSync } from '../lib/availabilityCalendarExecutor.js'

const safeCode = (error) => /^[a-z0-9_]{3,80}$/.test(String(error?.message || '')) ? error.message : 'sync_failed'

async function release(db, practitionerId, runId) {
  try { await db.rpc('release_availability_calendar_sync_lock', { p_practitioner_id: practitionerId, p_run_id: runId }) } catch { /* TTL remains the safe fallback. */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (process.env.VERCEL_ENV === 'production' || process.env.MEDIUMIA_ENV !== 'test') return res.status(404).json({ error: 'test_only' })
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!process.env.AVAILABILITY_SYNC_TEST_SECRET || token !== process.env.AVAILABILITY_SYNC_TEST_SECRET) return res.status(401).json({ error: 'unauthorized' })
  const db = getSupabaseAdmin()
  const { data: configs, error } = await db.from('availability_calendar_sync_config').select('practitioner_id,target_calendar_id,source_calendar_id,enabled,environment').eq('enabled', true).eq('environment', 'test')
  if (error) return res.status(503).json({ error: 'sync_config_unavailable' })
  if ((configs || []).some(c => c.target_calendar_id === c.source_calendar_id)) return res.status(409).json({ error: 'unsafe_calendar_target' })
  const requestedDays = Number(req.query?.days || 14)
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 31) return res.status(400).json({ error: 'invalid_projection_horizon' })
  const runs = []
  for (const config of configs || []) {
    const runId = randomUUID()
    const { data: locked, error: lockError } = await db.rpc('claim_availability_calendar_sync_lock', {
      p_practitioner_id: config.practitioner_id, p_run_id: runId, p_ttl_seconds: 120,
    })
    if (lockError) return res.status(503).json({ error: 'sync_lock_unavailable' })
    if (!locked) { runs.push({ status: 'skipped_concurrent' }); continue }
    const startedAt = new Date().toISOString()
    try {
      await db.from('availability_calendar_sync_runs').insert({
        id: runId, practitioner_id: config.practitioner_id, source_calendar_id: config.source_calendar_id,
        target_calendar_id: config.target_calendar_id, status: 'running', started_at: startedAt,
      })
      const outcome = await executeAvailabilityCalendarSync({ db, config, days: requestedDays })
      const finishedAt = new Date().toISOString()
      await Promise.all([
        db.from('availability_calendar_sync_runs').update({ status: 'success', finished_at: finishedAt, created_count: outcome.created, updated_count: outcome.updated, unchanged_count: outcome.unchanged, deleted_count: outcome.deleted }).eq('id', runId),
        db.from('availability_calendar_sync_config').update({ last_success_at: finishedAt, last_error_at: null, last_error_code: null, updated_at: finishedAt }).eq('practitioner_id', config.practitioner_id),
      ])
      runs.push({ status: 'success', created: outcome.created, updated: outcome.updated, unchanged: outcome.unchanged, deleted: outcome.deleted, projected: outcome.projected })
    } catch (error) {
      const code = safeCode(error)
      const finishedAt = new Date().toISOString()
      await Promise.all([
        db.from('availability_calendar_sync_runs').update({ status: 'error', finished_at: finishedAt, error_code: code }).eq('id', runId),
        db.from('availability_calendar_sync_config').update({ last_error_at: finishedAt, last_error_code: code, updated_at: finishedAt }).eq('practitioner_id', config.practitioner_id),
      ])
      runs.push({ status: 'error', error: code })
    } finally { await release(db, config.practitioner_id, runId) }
  }
  const failed = runs.some((run) => run.status === 'error')
  return res.status(failed ? 503 : 200).json({ status: failed ? 'partial_failure' : 'ok', runs })
}
