/* global process, Buffer */
/**
 * Production entry point for the informational availability-calendar sync.
 *
 * It is deliberately inert until all three production controls are in place:
 * - a production deployment declares MEDIUMIA_ENV=production;
 * - AVAILABILITY_CALENDAR_SYNC_ENABLED is exactly "true";
 * - a dedicated, enabled production configuration exists in the database.
 *
 * The caller is responsible for exposing this handler through an existing API
 * function. Keeping it there avoids increasing Vercel's function count.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { executeAvailabilityCalendarSync } from './availabilityCalendarExecutor.js'

const safeCode = (error) => /^[a-z0-9_]{3,80}$/.test(String(error?.message || '')) ? error.message : 'sync_failed'

function equalSecret(actual, expected) {
  if (!actual || !expected) return false
  const actualBuffer = Buffer.from(String(actual))
  const expectedBuffer = Buffer.from(String(expected))
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function isAuthorized(req) {
  const authorization = String(req.headers?.authorization || '')
  const cronSecret = String(process.env.CRON_SECRET || '')
  const manualSecret = String(process.env.AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET || '')
  const manualToken = String(req.headers?.['x-availability-sync-secret'] || '')
  return (cronSecret.length > 0 && equalSecret(authorization, `Bearer ${cronSecret}`))
    || (manualSecret.length > 0 && equalSecret(manualToken, manualSecret))
}

function isExplicitlyEnabledInProduction() {
  return process.env.VERCEL_ENV === 'production'
    && process.env.MEDIUMIA_ENV === 'production'
    && process.env.AVAILABILITY_CALENDAR_SYNC_ENABLED === 'true'
}

async function release(db, practitionerId, runId) {
  try {
    await db.rpc('release_availability_calendar_sync_lock', { p_practitioner_id: practitionerId, p_run_id: runId })
  } catch {
    // The bounded database lock is the safe fallback.
  }
}

/**
 * Handles a future manual or Vercel-Cron reconciliation.
 * It is fail-closed before creating a Supabase client or calling Google.
 */
export async function handleAvailabilityCalendarSync(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' })
  if (!isExplicitlyEnabledInProduction()) return res.status(404).json({ error: 'sync_disabled' })
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const requestedDays = Number(req.query?.days || 14)
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 90) {
    return res.status(400).json({ error: 'invalid_projection_horizon' })
  }

  const db = getSupabaseAdmin()
  const { data: configs, error } = await db
    .from('availability_calendar_sync_config')
    .select('practitioner_id,target_calendar_id,source_calendar_id,enabled,environment')
    .eq('enabled', true)
    .eq('environment', 'production')
  if (error) return res.status(503).json({ error: 'sync_config_unavailable' })
  if ((configs || []).some((config) => config.target_calendar_id === 'primary'
    || config.target_calendar_id === config.source_calendar_id)) {
    return res.status(409).json({ error: 'unsafe_calendar_target' })
  }

  const runs = []
  for (const config of configs || []) {
    const runId = randomUUID()
    const { data: locked, error: lockError } = await db.rpc('claim_availability_calendar_sync_lock', {
      p_practitioner_id: config.practitioner_id,
      p_run_id: runId,
      p_ttl_seconds: 120,
    })
    if (lockError) return res.status(503).json({ error: 'sync_lock_unavailable' })
    if (!locked) {
      runs.push({ status: 'skipped_concurrent' })
      continue
    }

    const startedAt = new Date().toISOString()
    try {
      await db.from('availability_calendar_sync_runs').insert({
        id: runId,
        practitioner_id: config.practitioner_id,
        source_calendar_id: config.source_calendar_id,
        target_calendar_id: config.target_calendar_id,
        status: 'running',
        started_at: startedAt,
      })
      const outcome = await executeAvailabilityCalendarSync({ db, config, days: requestedDays })
      const finishedAt = new Date().toISOString()
      await Promise.all([
        db.from('availability_calendar_sync_runs').update({
          status: 'success',
          finished_at: finishedAt,
          created_count: outcome.created,
          updated_count: outcome.updated,
          unchanged_count: outcome.unchanged,
          deleted_count: outcome.deleted,
        }).eq('id', runId),
        db.from('availability_calendar_sync_config').update({
          last_success_at: finishedAt,
          last_error_at: null,
          last_error_code: null,
          updated_at: finishedAt,
        }).eq('practitioner_id', config.practitioner_id),
      ])
      runs.push({
        status: 'success',
        created: outcome.created,
        updated: outcome.updated,
        unchanged: outcome.unchanged,
        deleted: outcome.deleted,
        projected: outcome.projected,
      })
    } catch (error) {
      const code = safeCode(error)
      const finishedAt = new Date().toISOString()
      await Promise.all([
        db.from('availability_calendar_sync_runs').update({ status: 'error', finished_at: finishedAt, error_code: code }).eq('id', runId),
        db.from('availability_calendar_sync_config').update({
          last_error_at: finishedAt,
          last_error_code: code,
          updated_at: finishedAt,
        }).eq('practitioner_id', config.practitioner_id),
      ])
      runs.push({ status: 'error', error: code })
    } finally {
      await release(db, config.practitioner_id, runId)
    }
  }

  const failed = runs.some((run) => run.status === 'error')
  return res.status(failed ? 503 : 200).json({ status: failed ? 'partial_failure' : 'ok', runs })
}

export const availabilityCalendarSyncInternals = {
  equalSecret,
  isAuthorized,
  isExplicitlyEnabledInProduction,
}
