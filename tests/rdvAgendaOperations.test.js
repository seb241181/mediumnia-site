import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { isAgendaTestSimulationAllowed, parseParisWallTime, processRdvCalendarSyncJob, rescheduleAgendaBooking } from '../lib/rdvAgendaOperations.js'
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

test('reschedule retry after a lost HTTP response replays the committed owner action before stale-version checks', async () => {
  const bookingId = '00000000-0000-4000-8000-000000000001'
  const historyId = '00000000-0000-4000-8000-000000000002'
  const calls = []
  const booking = {
    id: bookingId, practitioner_id: 'practitioner-1', service_id: 'service-1',
    starts_at: '2026-10-18T12:00:00.000Z', ends_at: '2026-10-18T13:00:00.000Z',
    updated_at: '2026-10-18T12:30:00.000Z', status: 'confirmed', booking_source: 'mediumia',
    google_event_id: 'google-1', service: { id: 'service-1', duration_min: 60 },
    practitioner: { id: 'practitioner-1', owner_id: 'owner-1' },
  }
  const history = {
    id: historyId, booking_id: bookingId,
    next_starts_at: '2026-10-18T13:30:00+00:00', next_ends_at: '2026-10-18T14:30:00+00:00',
    result: { ok: true, booking_id: bookingId, starts_at: '2026-10-18T13:30:00.000Z', ends_at: '2026-10-18T14:30:00.000Z', google_sync: 'pending' },
  }
  const job = {
    id: 'job-1', status: 'synced', booking_id: bookingId,
    idempotency_key: `rdv.google.update:${historyId}`,
  }
  const supabase = {
    from(table) {
      let filters = {}
      const query = {
        select() { return query },
        eq(key, value) { filters[key] = value; calls.push(['eq', table, key, value]); return query },
        async maybeSingle() {
          if (table === 'bookings') return { data: filters.id === bookingId && filters['practitioner.owner_id'] === 'owner-1' ? booking : null, error: null }
          if (table === 'rdv_booking_action_history') return { data: filters.actor_id === 'owner-1' && filters.idempotency_key === 'retry-key-123' ? history : null, error: null }
          if (table === 'rdv_calendar_sync_jobs') return { data: job, error: null }
          assert.fail(`unexpected query: ${table}`)
        },
        order() { return query }, limit() { return query },
      }
      return query
    },
    async rpc() { assert.fail('a committed idempotency replay must not mutate again') },
  }
  const replay = await rescheduleAgendaBooking({
    supabase, userId: 'owner-1', now: new Date('2026-10-18T10:00:00Z'),
    input: {
      booking_id: bookingId, idempotency_key: 'retry-key-123',
      expected_updated_at: '2026-10-18T12:00:00.000Z',
      starts_at_local: '2026-10-18T15:30',
    },
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.idempotent, true)
  assert.equal(replay.body.google_sync, 'synced')
  assert.ok(calls.some(call => call[1] === 'bookings' && call[2] === 'practitioner.owner_id'))
  assert.ok(calls.some(call => call[1] === 'rdv_booking_action_history' && call[2] === 'actor_id'))

  const conflictingReplay = await rescheduleAgendaBooking({
    supabase, userId: 'owner-1', now: new Date('2026-10-18T10:00:00Z'),
    input: { booking_id: bookingId, idempotency_key: 'retry-key-123', expected_updated_at: 'stale', starts_at_local: '2026-10-18T16:30' },
  })
  assert.equal(conflictingReplay.status, 409)
  assert.equal(conflictingReplay.body.error, 'idempotency_conflict')
})

test('reschedule fails closed when the authenticated user does not own the practitioner', async () => {
  const filters = {}
  let historyRead = false
  let mutation = false
  const supabase = {
    from(table) {
      const query = {
        select() { return query },
        eq(key, value) { filters[key] = value; return query },
        async maybeSingle() {
          assert.equal(table, 'bookings')
          return { data: null, error: null }
        },
      }
      if (table === 'rdv_booking_action_history') historyRead = true
      return query
    },
    async rpc() { mutation = true; return { data: null, error: null } },
  }
  const response = await rescheduleAgendaBooking({
    supabase, userId: 'not-owner', input: {
      booking_id: '00000000-0000-4000-8000-000000000001', idempotency_key: 'owner-check-123',
      expected_updated_at: '2026-10-18T12:00:00.000Z', starts_at_local: '2026-10-18T15:30',
    },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(filters, { id: '00000000-0000-4000-8000-000000000001', 'practitioner.owner_id': 'not-owner' })
  assert.equal(historyRead, false)
  assert.equal(mutation, false)
})

const agendaSimulationEnv = {
  RDV_AGENDA_TEST_SIMULATION: 'true',
  VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_nN2EVd745rBErLSi8PPo9qz6Lu5l',
  SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co',
}

function rescheduleFixtureDb({ email = 'qa-interface-mobile-001@example.invalid', googleEventId = null } = {}) {
  const tables = []
  const booking = {
    id: '00000000-0000-4000-8000-000000000111', practitioner_id: 'test-practitioner', service_id: 'test-service',
    starts_at: '2026-10-18T10:00:00.000Z', ends_at: '2026-10-18T11:00:00.000Z',
    updated_at: '2026-10-18T09:00:00.000Z', status: 'confirmed', booking_source: 'mediumia',
    customer_email: email, google_event_id: googleEventId,
    service: { id: 'test-service', duration_min: 60 },
    practitioner: {
      id: 'test-practitioner', slug: 'seb-test', owner_id: 'test-owner',
      buffer_before_min: 0, buffer_after_min: 0, max_per_day: null,
      min_advance_hours: 0, booking_horizon_days: 365,
    },
  }
  let rpcCalls = 0
  return {
    tables,
    booking,
    get rpcCalls() { return rpcCalls },
    from(table) {
      tables.push(table)
      const query = {
        select() { return query }, eq() { return query }, gte() { return query }, lte() { return query },
        lt() { return query }, neq() { return query }, in() { return query }, gt() { return query }, order() { return query },
        async maybeSingle() {
          if (table === 'bookings') return { data: booking, error: null }
          if (table === 'rdv_booking_action_history') return { data: null, error: null }
          return { data: null, error: null }
        },
        async single() { return { data: null, error: { code: 'PGRST116' } } },
        then(resolve, reject) {
          const data = table === 'booking_availability_rules'
            ? [{ day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }]
            : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return query
    },
    async rpc() {
      rpcCalls += 1
      return { data: { ok: true, booking_id: booking.id, starts_at: '2026-10-20T12:30:00.000Z', ends_at: '2026-10-20T13:30:00.000Z', google_sync: 'not_required' }, error: null }
    },
  }
}

test('agenda simulation is restricted to the TEST Preview, TEST Supabase and synthetic unlinked seb-test bookings', () => {
  const booking = { customer_email: 'qa-interface-mobile-001@example.invalid', google_event_id: null }
  const practitioner = { slug: 'seb-test' }
  assert.equal(isAgendaTestSimulationAllowed({ booking, practitioner, env: agendaSimulationEnv }), true)
  for (const changes of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'prj_mediumia_site' },
    { SUPABASE_URL: 'https://uotkpygeqqnekpolezts.supabase.co' },
    { SUPABASE_URL: 'http://wnbwhnqiulsdjcvkuwos.supabase.co' },
    { RDV_AGENDA_TEST_SIMULATION: 'false' },
  ]) {
    assert.equal(isAgendaTestSimulationAllowed({ booking, practitioner, env: { ...agendaSimulationEnv, ...changes } }), false)
  }
  assert.equal(isAgendaTestSimulationAllowed({ booking: { ...booking, google_event_id: 'google-event' }, practitioner, env: agendaSimulationEnv }), false)
  assert.equal(isAgendaTestSimulationAllowed({ booking: { ...booking, customer_email: 'customer@example.com' }, practitioner, env: agendaSimulationEnv }), false)
  assert.equal(isAgendaTestSimulationAllowed({ booking, practitioner: { slug: 'other' }, env: agendaSimulationEnv }), false)
})

test('TEST simulation skips only Google reads and retains database availability plus the idempotent RPC', async () => {
  const supabase = rescheduleFixtureDb()
  let fetchCalls = 0
  const response = await rescheduleAgendaBooking({
    supabase, userId: 'test-owner', env: agendaSimulationEnv, now: new Date('2026-10-18T08:00:00.000Z'),
    fetchImpl: async () => { fetchCalls += 1; throw new Error('external request forbidden in test') },
    input: {
      booking_id: supabase.booking.id, idempotency_key: 'agenda.test.simulation.1',
      expected_updated_at: supabase.booking.updated_at, starts_at_local: '2026-10-20T14:30',
    },
  })
  assert.equal(response.status, 200)
  assert.equal(supabase.rpcCalls, 1)
  assert.equal(fetchCalls, 0)
  for (const table of ['booking_availability_rules', 'booking_exceptions', 'bookings', 'rdv_booking_holds', 'booking_slot_offers']) {
    assert.ok(supabase.tables.includes(table), `missing availability check: ${table}`)
  }
  assert.equal(supabase.tables.includes('booking_calendar_connections'), false)
})

test('Google outage stays explicit and TEST simulation is unavailable in Production or for Google-linked bookings', async () => {
  for (const { env, googleEventId } of [
    { env: agendaSimulationEnv, googleEventId: 'google-event' },
    { env: { ...agendaSimulationEnv, VERCEL_ENV: 'production' }, googleEventId: null },
  ]) {
    const supabase = rescheduleFixtureDb({ googleEventId })
    let fetchCalls = 0
    const response = await rescheduleAgendaBooking({
      supabase, userId: 'test-owner', env, now: new Date('2026-10-18T08:00:00.000Z'),
      fetchImpl: async () => { fetchCalls += 1; throw new Error('external request forbidden in test') },
      input: {
        booking_id: supabase.booking.id, idempotency_key: 'agenda.test.google-fails',
        expected_updated_at: supabase.booking.updated_at, starts_at_local: '2026-10-20T14:30',
      },
    })
    assert.equal(response.status, 503)
    assert.equal(response.body.error, 'google_calendar_unavailable')
    assert.equal(supabase.rpcCalls, 0)
    assert.equal(fetchCalls, 0)
  }
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

test('orphaned pending Google outbox job can be owner-retried after interruption and reaches synced', async () => {
  const now = new Date('2026-10-18T10:00:00.000Z')
  const job = {
    id: 'job-1', booking_id: '00000000-0000-4000-8000-000000000001', practitioner_id: 'p-1',
    google_event_id: 'event-1', previous_starts_at: '2026-10-18T12:00:00.000Z', previous_ends_at: '2026-10-18T13:00:00.000Z',
    target_starts_at: '2026-10-18T13:00:00.000Z', target_ends_at: '2026-10-18T14:00:00.000Z',
    idempotency_key: 'job-key', status: 'pending', attempt_count: 0, claimed_at: null, completed_at: null,
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
  assert.equal(state.job.attempt_count, 2)
})
