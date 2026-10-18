import { DateTime } from 'luxon'
import { checkSlotAvailability, loadAvailabilityData, loadGoogleBusy, parisDayBounds } from './rdvAvailability.js'
import { moveBookingGoogleEvent } from './googleCalendarEvents.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KEY_RE = /^[A-Za-z0-9_.:-]{8,160}$/
const TZ = 'Europe/Paris'

export function parseParisWallTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const parsed = DateTime.fromFormat(value, "yyyy-MM-dd'T'HH:mm", { zone: TZ, setZone: true })
  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== value || parsed.getPossibleOffsets().length !== 1) return null
  return parsed
}

function result(status, body) { return { status, body } }
function iso(milliseconds) { return new Date(milliseconds).toISOString() }

async function getOwnedBooking(db, userId, bookingId) {
  return db.from('bookings').select(`
    id, practitioner_id, service_id, starts_at, ends_at, updated_at, status,
    booking_source, google_event_id,
    service:booking_services!inner(id, duration_min),
    practitioner:booking_practitioners!inner(id, owner_id, buffer_before_min, buffer_after_min, max_per_day, min_advance_hours, booking_horizon_days)
  `).eq('id', bookingId).eq('practitioner.owner_id', userId).maybeSingle()
}

async function findRescheduleReplay(db, userId, bookingId, key, startsAt) {
  const found = await db.from('rdv_booking_action_history')
    .select('id, booking_id, next_starts_at, next_ends_at, result')
    .eq('actor_id', userId).eq('idempotency_key', key).maybeSingle()
  if (found.error) return { error: true }
  if (!found.data) return { replay: false }
  const row = found.data
  const sameInstant = (left, right) => Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right)
  if (row.booking_id !== bookingId || !sameInstant(row.next_starts_at, startsAt)) {
    return { conflict: true }
  }
  return { replay: true, row }
}

export { getOwnedBooking as getOwnedAgendaBooking }

export async function rescheduleAgendaBooking({ supabase, userId, input, now = new Date(), fetchImpl = fetch }) {
  const bookingId = String(input?.booking_id || '')
  const key = String(input?.idempotency_key || '')
  if (!UUID_RE.test(bookingId) || !KEY_RE.test(key) || typeof input?.expected_updated_at !== 'string') return result(400, { error: 'invalid_request' })
  const targetLocal = parseParisWallTime(input.starts_at_local)
  if (!targetLocal) return result(400, { error: 'invalid_paris_local_time' })

  const lookup = await getOwnedBooking(supabase, userId, bookingId)
  if (lookup.error) return result(503, { error: 'booking_unavailable' })
  const booking = lookup.data
  if (!booking) return result(409, { error: 'booking_not_movable' })
  const startsAt = targetLocal.toUTC().toJSDate().toISOString()

  // A retry can arrive after PostgreSQL committed but its HTTP response was lost.
  // Resolve the owner's durable idempotency record before comparing the stale version
  // or recalculating availability, which may now describe a different slot state.
  const replay = await findRescheduleReplay(supabase, userId, booking.id, key, startsAt)
  if (replay.error) return result(503, { error: 'reschedule_unavailable' })
  if (replay.conflict) return result(409, { error: 'idempotency_conflict' })
  if (replay.replay) {
    const saved = replay.row.result || {}
    let sync = saved.google_sync || 'not_required'
    if (sync === 'pending') {
      const job = await processRdvCalendarSyncJob({
        supabase, userId, bookingId: booking.id,
        idempotencyKey: `rdv.google.update:${replay.row.id}`, fetchImpl,
      })
      sync = job.body?.status || 'retry'
    }
    return result(200, { ...saved, idempotent: true, google_sync: sync })
  }
  if (booking.status !== 'confirmed' || booking.booking_source !== 'mediumia') return result(409, { error: 'booking_not_movable' })

  const practitioner = booking.practitioner
  const durationMin = Number(booking.service?.duration_min)
  if (!practitioner || !Number.isInteger(durationMin) || durationMin < 1 || durationMin > 600) return result(503, { error: 'booking_configuration_unavailable' })
  const targetEnd = targetLocal.plus({ minutes: durationMin })
  if (!targetEnd.isValid || targetEnd.toISODate() !== targetLocal.toISODate()) return result(400, { error: 'invalid_target_duration' })
  const endsAt = targetEnd.toUTC().toJSDate().toISOString()
  if (booking.updated_at !== input.expected_updated_at) return result(409, { error: 'booking_changed' })

  const date = targetLocal.toISODate()
  const dayStart = parisDayBounds(date).start
  const dayEnd = parisDayBounds(date).end

  let availability
  try {
    availability = await loadAvailabilityData({ db: supabase, practitionerId: booking.practitioner_id, fromDate: date, toDate: date, now, excludeBookingId: booking.id })
  } catch {
    return result(503, { error: 'availability_unavailable' })
  }
  const google = await loadGoogleBusy({
    db: supabase, practitionerId: booking.practitioner_id,
    timeMin: new Date(dayStart).toISOString(), timeMax: new Date(dayEnd).toISOString(),
    excludeGoogleEventId: booking.google_event_id || null, fetchImpl,
  })
  if (!google.ok) return result(503, { error: 'google_availability_unavailable' })
  const slot = checkSlotAvailability({
    date, time: targetLocal.toFormat('HH:mm'), practitioner, durationMin,
    ...availability, googleBusy: google.busy, now,
  })
  if (!slot.free || iso(slot.start) !== startsAt || iso(slot.end) !== endsAt) return result(409, { error: slot.reason || 'slot_unavailable' })

  const saved = await supabase.rpc('rdv_admin_reschedule_booking', {
    p_owner_id: userId, p_booking_id: booking.id, p_expected_updated_at: input.expected_updated_at,
    p_starts_at: startsAt, p_ends_at: endsAt, p_idempotency_key: key,
  })
  if (saved.error) return result(503, { error: 'reschedule_unavailable' })
  if (!saved.data?.ok) {
    const status = ['booking_changed', 'booking_busy', 'payment_busy', 'google_sync_pending', 'slot_unavailable'].includes(saved.data?.error) ? 409 : 422
    return result(status, saved.data)
  }

  let sync = saved.data.google_sync || 'not_required'
  if (sync === 'pending') {
    const job = await processRdvCalendarSyncJob({ supabase, userId, bookingId: booking.id, fetchImpl })
    sync = job.body?.status || 'retry'
  }
  return result(200, { ...saved.data, google_sync: sync })
}

export async function processRdvCalendarSyncJob({ supabase, userId, bookingId, idempotencyKey, fetchImpl = fetch, moveEvent = moveBookingGoogleEvent, now = new Date() }) {
  if (!UUID_RE.test(String(bookingId || ''))) return result(400, { error: 'invalid_booking' })
  let query = supabase.from('rdv_calendar_sync_jobs').select('*').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1)
  if (idempotencyKey) query = query.eq('idempotency_key', idempotencyKey)
  const found = await query.maybeSingle()
  if (found.error || !found.data) return result(404, { error: 'sync_job_not_found' })
  const job = found.data
  if (job.status === 'synced' || job.status === 'superseded') return result(200, { status: job.status })
  if (job.status === 'review') return result(409, { status: 'review', error: job.last_error_code })
  if (job.status === 'running' && now.getTime() - new Date(job.claimed_at).getTime() < 120_000) return result(202, { status: 'running' })

  const claimTime = now.toISOString()
  let claim = supabase.from('rdv_calendar_sync_jobs').update({
    status: 'running', claimed_at: claimTime, attempt_count: Number(job.attempt_count || 0) + 1,
    updated_at: claimTime, last_error_code: null,
  }).eq('id', job.id)
  if (job.status === 'running') claim = claim.eq('claimed_at', job.claimed_at)
  else claim = claim.eq('status', job.status)
  const claimed = await claim.select('*').maybeSingle()
  if (claimed.error || !claimed.data) return result(202, { status: 'running' })

  const bookingResult = await getOwnedBooking(supabase, userId, bookingId)
  const booking = bookingResult.data
  if (bookingResult.error || !booking) return finishJob(supabase, claimed.data, 'review', 'booking_unavailable', now)
  if (booking.status !== 'confirmed' || booking.booking_source !== 'mediumia') return finishJob(supabase, claimed.data, 'superseded', 'booking_no_longer_confirmed', now)
  if (booking.starts_at !== job.target_starts_at || booking.ends_at !== job.target_ends_at) return finishJob(supabase, claimed.data, 'superseded', null, now)

  const moved = await moveEvent({
    supabase, practitionerId: job.practitioner_id, googleEventId: job.google_event_id,
    previous: { starts_at: job.previous_starts_at, ends_at: job.previous_ends_at },
    target: { starts_at: job.target_starts_at, ends_at: job.target_ends_at }, fetchImpl,
  })
  const status = moved.status === 'done' ? 'synced' : moved.status === 'manual_review' || claimed.data.attempt_count >= 8 ? 'review' : 'retry'
  return finishJob(supabase, claimed.data, status, moved.reason || null, now)
}

async function finishJob(supabase, job, status, errorCode, now) {
  const patch = {
    status, last_error_code: errorCode, updated_at: now.toISOString(),
    completed_at: ['synced', 'superseded'].includes(status) ? now.toISOString() : null,
  }
  const update = await supabase.from('rdv_calendar_sync_jobs').update(patch)
    .eq('id', job.id).eq('status', 'running').eq('claimed_at', job.claimed_at).select('status').maybeSingle()
  if (update.error || !update.data) return result(503, { status: 'retry', error: 'outbox_update_unavailable' })
  return result(status === 'synced' ? 200 : status === 'superseded' ? 200 : 503, { status, error: errorCode })
}

export async function getAgendaBookingHistory({ supabase, userId, bookingId }) {
  if (!UUID_RE.test(String(bookingId || ''))) return result(400, { error: 'invalid_booking' })
  const owned = await getOwnedBooking(supabase, userId, bookingId)
  if (owned.error) return result(503, { error: 'booking_unavailable' })
  if (!owned.data) return result(404, { error: 'booking_not_found' })
  const [moves, cancellations] = await Promise.all([
    supabase.from('rdv_booking_action_history').select('id, operation, previous_starts_at, previous_ends_at, next_starts_at, next_ends_at, result, created_at')
      .eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(50),
    supabase.from('lumia_action_intents').select('id, status, execution_result, created_at, executed_at')
      .eq('owner_id', userId).eq('target_source', 'mediumia_booking').eq('target_id', bookingId)
      .eq('action_type', 'mediumia.booking.cancel').order('created_at', { ascending: false }).limit(20),
  ])
  if (moves.error || cancellations.error) return result(503, { error: 'history_unavailable' })
  const history = [
    ...(moves.data || []).map(row => ({ ...row, kind: 'reschedule', source: 'agenda' })),
    ...(cancellations.data || []).map(row => ({ ...row, occurred_at: row.executed_at || row.created_at, kind: 'cancel', source: 'lumia' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return result(200, { history })
}
