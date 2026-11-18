import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sendReviewRequests } from '../lib/rdvReviewRequests.js'
import { setAgendaSessionOutcome } from '../lib/rdvSessionOutcomes.js'
import { mergeAgendaEvents } from '../lib/rdvUnifiedAgenda.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const bookingId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const startsAt = '2026-11-17T10:00:00.000Z'
const endsAt = '2026-11-17T11:00:00.000Z'
const now = new Date('2026-11-18T08:00:00.000Z')
const session = (overrides = {}) => ({
  id: bookingId, practitioner_id: ownerId, service_id: 'service-1',
  customer_first_name: 'Recette', customer_email: 'recette@example.invalid',
  starts_at: startsAt, ends_at: endsAt, timezone: 'Europe/Paris',
  status: 'confirmed', session_outcome: 'pending', review_request_sent_at: null,
  ...overrides,
})

// Minimal Supabase query test double, with condition checking both at lookup
// and at the atomic claim. It records every predicate for regression checks.
function dbForReview(initial, { changedBeforeClaim = false } = {}) {
  const row = { ...initial }
  const queries = []
  return {
    row, queries,
    from(table) {
      const filters = []
      const q = {
        select() { return q },
        eq(field, value) { filters.push([field, 'eq', value]); return q },
        is(field, value) { filters.push([field, 'is', value]); return q },
        lte(field, value) { filters.push([field, 'lte', value]); return q },
        gte(field, value) { filters.push([field, 'gte', value]); return q },
        update(patch) { q.patch = patch; return q },
        limit() {
          queries.push({ table, phase: 'lookup', filters: [...filters] })
          const eligible = filters.every(([key, op, val]) => (
            op === 'eq' ? row[key] === val : op === 'is' ? row[key] === val
            : op === 'lte' ? Date.parse(row[key]) <= Date.parse(val)
            : Date.parse(row[key]) >= Date.parse(val)
          ))
          return Promise.resolve({ data: eligible ? [{ ...row }] : [], error: null })
        },
        in() {
          if (table === 'booking_practitioners') return Promise.resolve({ data: [{ id: ownerId, slug: 'seb' }], error: null })
          return Promise.resolve({ data: [{ id: 'service-1', title: 'Désenvoûtement' }], error: null })
        },
        maybeSingle() {
          queries.push({ table, phase: 'claim', filters: [...filters] })
          if (changedBeforeClaim) row.session_outcome = 'to_reschedule'
          const eligible = filters.every(([key, op, val]) => (
            op === 'eq' ? row[key] === val : row[key] === val
          ))
          if (!eligible) return Promise.resolve({ data: null, error: null })
          Object.assign(row, q.patch)
          return Promise.resolve({ data: { id: bookingId }, error: null })
        },
      }
      return q
    },
  }
}

test('unverified, postponed, cancelled and no-show sessions never trigger automatic thanks', async () => {
  for (const changes of [
    { session_outcome: 'pending' },
    { session_outcome: 'to_reschedule' },
    { status: 'cancelled', session_outcome: 'completed' },
    { status: 'no_show', session_outcome: 'completed' },
  ]) {
    const db = dbForReview(session(changes))
    const sent = []
    const outcome = await sendReviewRequests(db, now, async mail => { sent.push(mail); return { status: 'sent' } })
    assert.equal(outcome.sent, 0)
    assert.equal(sent.length, 0)
    assert.ok(db.queries[0].filters.some(([key, , value]) => key === 'session_outcome' && value === 'completed'))
  }
})

test('only an explicitly completed consultation can receive a one-time request', async () => {
  const db = dbForReview(session({ session_outcome: 'completed' }))
  const sent = []
  const outcome = await sendReviewRequests(db, now, async mail => { sent.push(mail); return { status: 'sent' } })
  assert.equal(outcome.sent, 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].subject, /Merci pour votre confiance/)
  assert.equal(sent[0].idempotencyKey, `rdv-review-request/${bookingId}/${Date.parse(endsAt)}`)
  const claim = db.queries.find(record => record.phase === 'claim')
  assert.ok(claim.filters.some(([key, , value]) => key === 'session_outcome' && value === 'completed'))
  assert.ok(claim.filters.some(([key, , value]) => key === 'status' && value === 'confirmed'))
  assert.ok(claim.filters.some(([key, , value]) => key === 'ends_at' && value === endsAt))
  assert.equal(db.row.review_request_sent_at, now.toISOString())
})

test('reporting a session while the cron is preparing its claim prevents email', async () => {
  const db = dbForReview(session({ session_outcome: 'completed' }), { changedBeforeClaim: true })
  const sent = []
  const outcome = await sendReviewRequests(db, now, async mail => { sent.push(mail); return { status: 'sent' } })
  assert.equal(outcome.sent, 0)
  assert.deepEqual(sent, [])
})

test('owner-only outcome RPC validates inputs, keeps payment untouched, and reports errors', async () => {
  let called
  const supabase = { rpc: async (name, args) => {
    called = { name, args }
    return { data: { ok: true, outcome: 'to_reschedule' }, error: null }
  } }
  const params = { supabase, userId: ownerId, input: {
    booking_id: bookingId, outcome: 'to_reschedule',
    expected_updated_at: '2026-11-17T12:00:00.000Z',
  } }
  assert.equal((await setAgendaSessionOutcome(params)).status, 200)
  assert.equal(called.name, 'rdv_set_session_outcome')
  assert.equal(called.args.p_owner_id, ownerId)
  assert.deepEqual((await setAgendaSessionOutcome(params)).body, {
    ok: true, outcome: 'to_reschedule', already: false,
    client_email_sent: false, payment_changed: false,
  })
  const invalid = await setAgendaSessionOutcome({ ...params, input: { ...params.input, outcome: 'performed_without_approval' } })
  assert.equal(invalid.status, 400)
  const denied = await setAgendaSessionOutcome({ ...params, supabase: { rpc: async () => ({ data: { ok: false, error: 'booking_not_markable' }, error: null }) } })
  assert.equal(denied.status, 409)
})

test('migration audits outcomes, guards owner and clears old review marker only when dates move', () => {
  const sql = read('supabase/migrations/20261118130000_rdv_verified_session_reviews.sql')
  assert.match(sql, /session_outcome text NOT NULL DEFAULT 'pending'/)
  assert.match(sql, /session_outcome = 'completed'/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.rdv_set_session_outcome/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rdv_set_session_outcome[\s\S]*TO service_role/)
  assert.match(sql, /p\.owner_id = p_owner_id/)
  assert.match(sql, /v_booking\.ends_at > clock_timestamp\(\)/)
  assert.match(sql, /INSERT INTO public\.rdv_session_outcome_events/)
  assert.match(sql, /OLD\.starts_at IS DISTINCT FROM NEW\.starts_at/)
  assert.match(sql, /NEW\.review_request_sent_at := NULL/)
  assert.doesNotMatch(sql, /INSERT INTO public\.rdv_financial_entries/)
  assert.doesNotMatch(sql, /UPDATE public\.rdv_paypal_payments/)
})

test('agenda presents owner controls and the API requires authentication', () => {
  const agenda = read('src/components/rdv/UnifiedAgenda.jsx')
  const api = read('api/rdv-admin.js')
  assert.match(agenda, /Séance effectuée — autoriser le remerciement/)
  assert.match(agenda, /À reporter — bloquer le remerciement/)
  assert.match(agenda, /expected_updated_at: selected\.updated_at/)
  assert.match(api, /const auth = await requireAuth\(req\)/)
  assert.match(api, /req\.body\?\.op === 'session_outcome'/)
  const merged = mergeAgendaEvents({ bookings: [session()], googleEvents: [], linkedIds: new Set(), calendarId: 'google' })
  assert.equal(merged[0].session_outcome, 'pending')
})
