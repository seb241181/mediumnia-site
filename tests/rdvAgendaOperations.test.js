import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { parseParisWallTime, processRdvCalendarSyncJob } from '../lib/rdvAgendaOperations.js'
import { moveBookingGoogleEvent } from '../lib/googleCalendarEvents.js'
import { encrypt } from '../lib/googleOAuth.js'

test('Paris wall-time parser accepts a unique local time and returns its UTC instant', () => {
  const value = parseParisWallTime('2026-10-18T14:30')
  assert.ok(value)
  assert.equal(value.toUTC().toISO(), '2026-10-18T12:30:00.000Z')
})

test('Paris wall-time parser rejects nonexistent, ambiguous and malformed DST times', () => {
  assert.equal(parseParisWallTime('2026-03-29T02:30'), null)
  assert.equal(parseParisWallTime('2026-10-25T02:30'), null)
  assert.equal(parseParisWallTime('2026-10-18T14:30:00'), null)
  assert.equal(parseParisWallTime('2026-02-30T14:30'), null)
})

test('agenda reschedule migration persists action and Google outbox atomically with owner-only service execution', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261018165006_rdv_agenda_operations.sql', import.meta.url), 'utf8')
  assert.match(sql, /PERFORM public\.lumia_require_service_role\(\)/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(v_practitioner_id::text\)\)/)
  assert.match(sql, /FOR UPDATE NOWAIT/)
  assert.match(sql, /WHERE actor_id = p_owner_id AND idempotency_key = p_idempotency_key/)
  assert.match(sql, /CHECK \(status IN \('pending', 'running', 'retry', 'synced', 'superseded', 'review'\)\)/)
  assert.match(sql, /INSERT INTO public\.rdv_booking_action_history[\s\S]*INSERT INTO public\.rdv_calendar_sync_jobs/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rdv_admin_reschedule_booking[\s\S]*TO service_role/)
  assert.doesNotMatch(sql, /sendEmail|paypal_capture|refund/i)
})

function googleDb() {
  return { from(table) {
    assert.equal(table, 'booking_calendar_connections')
    const query = {
      select() { return query },
      eq() { return query },
      async single() { return { data: { access_token_enc: encrypt('test-access'), token_expiry: '2099-01-01T00:00:00.000Z', google_calendar_id: 'test-calendar' }, error: null } },
    }
    return query
  } }
}

test('uncertain Google PATCH is reconciled by GET before any second update', async () => {
  const previous = { starts_at: '2026-10-18T12:30:00.000Z', ends_at: '2026-10-18T13:30:00.000Z' }
  const target = { starts_at: '2026-10-18T13:30:00.000Z', ends_at: '2026-10-18T14:30:00.000Z' }
  const oldKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = '1'.repeat(64)
  try {
    let patchCount = 0
    let moved = false
    const fetchImpl = async (_url, options = {}) => {
      if (!options.method) return new Response(JSON.stringify({
        start: { dateTime: moved ? target.starts_at : previous.starts_at },
        end: { dateTime: moved ? target.ends_at : previous.ends_at }, etag: '"etag-1"',
      }), { status: 200 })
      patchCount += 1
      moved = true
      throw new Error('connection lost after request')
    }
    const first = await moveBookingGoogleEvent({ supabase: googleDb(), practitionerId: 'owner-safe', googleEventId: 'event-safe', previous, target, fetchImpl })
    assert.equal(first.status, 'retry')
    const second = await moveBookingGoogleEvent({ supabase: googleDb(), practitionerId: 'owner-safe', googleEventId: 'event-safe', previous, target, fetchImpl })
    assert.equal(second.status, 'done')
    assert.equal(second.idempotent, true)
    assert.equal(patchCount, 1)
  } finally {
    if (oldKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = oldKey
  }
})

test('permanent Google permission refusal enters manual review instead of retrying indefinitely', async () => {
  const oldKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = '2'.repeat(64)
  try {
    const fetchImpl = async (_url, options = {}) => options.method
      ? new Response('', { status: 403 })
      : new Response(JSON.stringify({ start: { dateTime: '2026-10-18T12:30:00.000Z' }, end: { dateTime: '2026-10-18T13:30:00.000Z' }, etag: '"etag"' }), { status: 200 })
    const result = await moveBookingGoogleEvent({
      supabase: googleDb(), practitionerId: 'owner-safe', googleEventId: 'event-safe',
      previous: { starts_at: '2026-10-18T12:30:00.000Z', ends_at: '2026-10-18T13:30:00.000Z' },
      target: { starts_at: '2026-10-18T13:30:00.000Z', ends_at: '2026-10-18T14:30:00.000Z' }, fetchImpl,
    })
    assert.deepEqual(result, { status: 'manual_review', reason: 'google_patch_403' })
  } finally {
    if (oldKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = oldKey
  }
})

test('durable Google outbox keeps retry after a temporary failure and then reaches synced', async () => {
  const now = new Date('2026-10-18T10:00:00.000Z')
  const job = {
    id: 'job-1', booking_id: '00000000-0000-4000-8000-000000000001', practitioner_id: 'p-1',
    google_event_id: 'event-1', previous_starts_at: '2026-10-18T12:00:00.000Z', previous_ends_at: '2026-10-18T13:00:00.000Z',
    target_starts_at: '2026-10-18T13:00:00.000Z', target_ends_at: '2026-10-18T14:00:00.000Z',
    idempotency_key: 'job-key', status: 'retry', attempt_count: 1, claimed_at: null, completed_at: null,
  }
  const booking = { ...job, id: job.booking_id, starts_at: job.target_starts_at, ends_at: job.target_ends_at, status: 'confirmed', booking_source: 'mediumia' }
  const state = { job: { ...job } }
  const supabase = { from(table) {
    let patch = null
    const filters = {}
    const q = {
      select() { return q }, eq(key, value) { filters[key] = value; return q }, order() { return q }, limit() { return q },
      update(value) { patch = value; return q },
      async maybeSingle() {
        if (table === 'bookings') return { data: booking, error: null }
        if (!patch) return { data: { ...state.job }, error: null }
        if (filters.id !== state.job.id || (filters.status && filters.status !== state.job.status)
          || (filters.claimed_at && filters.claimed_at !== state.job.claimed_at)) return { data: null, error: null }
        state.job = { ...state.job, ...patch }
        return { data: { ...state.job }, error: null }
      },
    }
    return q
  } }
  let calls = 0
  const moveEvent = async () => ++calls === 1 ? { status: 'retry', reason: 'network_uncertain' } : { status: 'done' }
  const first = await processRdvCalendarSyncJob({ supabase, userId: 'owner', bookingId: job.booking_id, now, moveEvent })
  assert.equal(first.body.status, 'retry')
  assert.equal(state.job.status, 'retry')
  const second = await processRdvCalendarSyncJob({ supabase, userId: 'owner', bookingId: job.booking_id, now: new Date(now.getTime() + 1000), moveEvent })
  assert.equal(second.body.status, 'synced')
  assert.equal(state.job.status, 'synced')
  assert.equal(state.job.attempt_count, 3)
})
