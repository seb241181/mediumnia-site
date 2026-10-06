import { deleteBookingFromGoogleCalendar } from './googleCalendarEvents.js'

const STALE_RUNNING_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5

function safeErrorCode(value) {
  const clean = String(value || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120)
  return clean || 'unknown'
}

export async function processLumiaCalendarSyncJob({
  supabase,
  bookingId,
  deleteEvent = deleteBookingFromGoogleCalendar,
  now = () => new Date(),
}) {
  if (!supabase || !bookingId) return { status: 'invalid_request' }

  const { data: existing, error } = await supabase
    .from('lumia_calendar_sync_jobs')
    .select('id, booking_id, practitioner_id, operation, status, google_event_id, attempt_count, claimed_at')
    .eq('booking_id', bookingId)
    .eq('operation', 'cancel_projection')
    .maybeSingle()

  if (error) return { status: 'job_lookup_failed' }
  if (!existing) return { status: 'not_required' }
  if (existing.status === 'done') return { status: 'done', idempotent: true }
  if (existing.status === 'manual_review') return { status: 'manual_review', idempotent: true }

  const current = now()
  const staleBefore = new Date(current.getTime() - STALE_RUNNING_MS)
  if (existing.status === 'running' && existing.claimed_at && new Date(existing.claimed_at) > staleBefore) {
    return { status: 'running', idempotent: true }
  }
  if (!['pending', 'retry', 'running'].includes(existing.status)) return { status: 'job_not_claimable' }

  const claimedAt = current.toISOString()
  let claim = supabase
    .from('lumia_calendar_sync_jobs')
    .update({
      status: 'running',
      claimed_at: claimedAt,
      attempt_count: Number(existing.attempt_count || 0) + 1,
      updated_at: claimedAt,
    })
    .eq('id', existing.id)
    .eq('status', existing.status)

  if (existing.status === 'running') {
    if (existing.claimed_at) claim = claim.eq('claimed_at', existing.claimed_at)
    else claim = claim.is('claimed_at', null)
  }

  const { data: claimed, error: claimError } = await claim
    .select('id, practitioner_id, google_event_id, attempt_count, claimed_at')
    .maybeSingle()

  if (claimError) return { status: 'claim_failed' }
  if (!claimed) return { status: 'running', idempotent: true }

  let deleted
  try {
    deleted = await deleteEvent({
      supabase,
      practitionerId: claimed.practitioner_id,
      googleEventId: claimed.google_event_id,
    })
  } catch {
    deleted = { status: 'failed', reason: 'network_error' }
  }

  const success = ['deleted', 'already_deleted'].includes(deleted?.status)
  let finalStatus = success ? 'done' : 'retry'
  const reason = success ? null : safeErrorCode(deleted?.reason || deleted?.status || 'google_delete_failed')

  if (!success && (
    deleted?.status === 'not_connected'
    || reason === 'missing_calendar_id'
    || Number(claimed.attempt_count || 0) >= MAX_ATTEMPTS
  )) {
    finalStatus = 'manual_review'
  }

  const finishedAt = now().toISOString()
  const patch = {
    status: finalStatus,
    last_error_code: reason,
    updated_at: finishedAt,
    ...(finalStatus === 'done' ? { completed_at: finishedAt } : { completed_at: null }),
  }
  if (finalStatus !== 'running') patch.claimed_at = null

  const { data: finished, error: finishError } = await supabase
    .from('lumia_calendar_sync_jobs')
    .update(patch)
    .eq('id', claimed.id)
    .eq('status', 'running')
    .eq('claimed_at', claimed.claimed_at)
    .select('status, attempt_count, last_error_code')
    .maybeSingle()

  if (finishError || !finished) return { status: 'finish_uncertain' }
  return {
    status: finished.status,
    attempts: finished.attempt_count,
    error: finished.last_error_code || null,
  }
}

export async function processDueLumiaCalendarSyncJobs({
  supabase,
  limit = 10,
  deleteEvent = deleteBookingFromGoogleCalendar,
  now = () => new Date(),
}) {
  const current = now()
  const staleBefore = new Date(current.getTime() - STALE_RUNNING_MS).toISOString()

  const { data: jobs, error } = await supabase
    .from('lumia_calendar_sync_jobs')
    .select('booking_id, status, claimed_at')
    .in('status', ['pending', 'retry', 'running'])
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(Number(limit) || 10, 50)))

  if (error) return { processed: 0, error: 'job_lookup_failed' }

  const eligible = (jobs || []).filter((job) =>
    job.status !== 'running' || !job.claimed_at || job.claimed_at <= staleBefore
  )

  const counts = {}
  for (const job of eligible) {
    const result = await processLumiaCalendarSyncJob({ supabase, bookingId: job.booking_id, deleteEvent, now })
    counts[result.status] = (counts[result.status] || 0) + 1
  }
  return { processed: eligible.length, counts }
}
