import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { partitionBookings, filterRequests, isFullySettled } from '../src/components/rdv/rdvCoulissesHelpers.js'
import { getRequestCounts } from '../lib/rdvRequestCounts.js'
import { getManualCancellationPreview } from '../lib/rdvManualCancellationPreview.js'

const pid = '11111111-1111-4111-8111-111111111111'
const bid = '22222222-2222-4222-8222-222222222222'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Coulisses: unpaid, partial, unknown and overpaid remain visible; exact full payment folds', () => {
  const full = { id: 'paid', status: 'confirmed', total_cents: 7000, paid_cents: 7000, remaining_cents: 0 }
  const partial = { ...full, id: 'partial', paid_cents: 2000, remaining_cents: 5000 }
  const zero = { ...full, id: 'free', total_cents: 0, paid_cents: 0 }
  const over = { ...full, id: 'over', paid_cents: 9000 }
  const unknown = { id: 'unknown', status: 'confirmed' }
  const cancelled = { ...full, id: 'cancelled', status: 'cancelled' }
  const groups = partitionBookings([full, partial, zero, over, unknown, cancelled])
  assert.deepEqual(groups.settled, [full])
  assert.deepEqual(groups.main, [partial, zero, over, unknown, cancelled])
  assert.equal(isFullySettled({ ...full, total_cents: '7000' }), false)
})

test('Coulisses: a refund restores a fully paid appointment to main list', () => {
  const booking = { id: bid, status: 'confirmed' }
  assert.equal(partitionBookings([booking], { [bid]: { total_cents: 7000, paid_cents: 7000, remaining_cents: 0 } }).settled.length, 1)
  assert.equal(partitionBookings([booking], { [bid]: { total_cents: 7000, paid_cents: 5000, remaining_cents: 2000 } }).main.length, 1)
  assert.equal(partitionBookings([booking], {}).main.length, 1)
})

test('Coulisses: request shortcuts filter without altering the complete list', () => {
  const requests = ['pending', 'contacted', 'scheduled'].map((status, id) => ({ id, status }))
  assert.equal(filterRequests(requests, 'all'), requests)
  for (const status of ['pending', 'contacted', 'scheduled']) {
    assert.deepEqual(filterRequests(requests, status), requests.filter(request => request.status === status))
  }
  assert.equal(requests.length, 3)
})

test('request counts use exact HEAD counts, scope practitioner and do not rely on capped rows', async () => {
  const calls = []
  const db = { from(table) {
    const filters = {}
    const q = { select(fields, options) { calls.push({ table, fields, options, filters }); return q },
      eq(key, value) { filters[key] = value; return q },
      then(resolve) { resolve({ count: { pending: 130, contacted: 7, scheduled: 12 }[filters.status], error: null }) } }
    return q
  } }
  assert.deepEqual(await getRequestCounts(db, pid), { pending: 130, contacted: 7, scheduled: 12 })
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.filters.practitioner_id, pid)
    assert.deepEqual(call.options, { head: true, count: 'exact' })
  }
})

test('failed counts remain unknown, not a false zero', async () => {
  const q = { select() { return q }, eq() { return q }, then(resolve) { resolve({ error: { code: 'unavailable' }, count: null }) } }
  assert.deepEqual(await getRequestCounts({ from: () => q }, pid), { pending: null, contacted: null, scheduled: null })
})

function readOnlyDb(overrides = {}) {
  const tables = {
    booking_practitioners: { id: pid },
    bookings: { id: bid, status: 'confirmed', booking_source: 'mediumia', starts_at: '2026-10-17T12:00:00Z', google_event_id: 'fixture-event' },
    rdv_booking_holds: [{ id: 'hold-test' }],
    rdv_financial_entries: [{ id: 'entry-test', direction: 'income', gross_cents: 2000 }],
    rdv_paypal_payments: [{ id: 'payment-test', status: 'captured' }],
    rdv_balance_payments: [], rdv_payment_refunds: [], rdv_deposit_transfers: [], ...overrides,
  }
  const calls = []
  const db = { calls, from(table) {
    const call = { table, filters: [] }
    calls.push(call)
    const result = () => tables[table] instanceof Error ? { data: null, error: { code: 'unavailable' } } : { data: structuredClone(tables[table]), error: null }
    const query = { select() { return query }, eq(key, value) { call.filters.push([key, value]); return query },
      in(key, value) { call.filters.push([key, value]); return query }, or(value) { call.or = value; return query },
      async maybeSingle() { return result() }, then(resolve) { resolve(result()) } }
    // No insert/update/delete/rpc method: accidental mutations fail the tests.
    return query
  } }
  return db
}
const preview = db => getManualCancellationPreview({ db, userId: 'owner', method: 'GET', practitionerId: pid, bookingId: bid })

test('manual cancellation preparation: owner scoped, retains payments/history, no external call', async () => {
  const db = readOnlyDb()
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => assert.fail('network forbidden in cancellation preparation')
  try {
    const result = await preview(db)
    assert.equal(result.status, 200)
    assert.equal(result.body.execution_enabled, false)
    assert.equal(result.body.requires_explicit_confirmation, true)
    assert.equal(result.body.requires_financial_review, true)
    assert.equal(result.body.finance.net_recorded_cents, 2000)
    assert.equal(result.body.finance.history_policy, 'preserve_all')
    assert.equal(result.body.finance.automatic_refund, false)
    assert.equal(result.body.google.status, 'not_executed')
    assert.equal(result.body.customer_notification, 'disabled')
    assert.ok(db.calls[0].filters.some(([key, value]) => key === 'owner_id' && value === 'owner'))
    assert.ok(db.calls.find(call => call.table === 'bookings').filters.some(([key, value]) => key === 'practitioner_id' && value === pid))
  } finally { globalThis.fetch = originalFetch }
})

test('cancellation preparation: non-owner cannot read booking or financial history', async () => {
  const db = readOnlyDb({ booking_practitioners: null })
  assert.equal((await preview(db)).status, 403)
  assert.deepEqual(db.calls.map(call => call.table), ['booking_practitioners'])
})

test('cancellation preparation: no authentication, invalid IDs and POST/DELETE execution fail closed', async () => {
  const db = { from: () => assert.fail('no lookup expected') }
  assert.equal((await getManualCancellationPreview({ db, method: 'GET' })).status, 401)
  assert.equal((await getManualCancellationPreview({ db, method: 'GET', userId: 'owner', practitionerId: 'bad', bookingId: bid })).status, 400)
  for (const method of ['POST', 'DELETE', 'PUT']) {
    assert.equal((await getManualCancellationPreview({ db, method, userId: 'owner', practitionerId: pid, bookingId: bid })).status, 405)
  }
})

test('cancellation preparation: uncertain capture or refund never authorizes cancellation', async () => {
  const result = await preview(readOnlyDb({ rdv_paypal_payments: [{ status: 'capturing' }], rdv_payment_refunds: [{ status: 'pending' }] }))
  assert.deepEqual(result.body.blockers, ['payment_state_uncertain', 'refund_in_progress'])
  assert.equal(result.body.execution_enabled, false)
})

test('cancellation preparation: financial/owner lookup failures cannot become no-payment', async () => {
  assert.equal((await preview(readOnlyDb({ rdv_financial_entries: new Error('offline') }))).status, 503)
  assert.equal((await preview(readOnlyDb({ booking_practitioners: new Error('offline') }))).status, 503)
})

test('cancellation preparation: cancelled/external booking and transfers require review', async () => {
  const result = await preview(readOnlyDb({ bookings: { id: bid, status: 'cancelled', booking_source: 'reservio' },
    rdv_deposit_transfers: [{ status: 'pending' }] }))
  assert.deepEqual(result.body.blockers, ['booking_not_confirmed', 'external_booking_requires_review', 'transfer_requires_review'])
})

test('Coulisses wiring: owner-only preparation, closed native details, real filtered requests and refresh', () => {
  assert.match(read('api/rdv-admin.js'), /case 'booking-cancel-preview'/)
  assert.match(read('api/rdv-admin.js'), /request_counts: requestCounts\[p.id\]/)
  const folded = read('src/components/rdv/SettledBookings.jsx')
  assert.match(folded, /<details/)
  assert.doesNotMatch(folded, /\bopen[= >]/)
  const dashboard = read('src/components/rdv/RdvDashboard.jsx')
  assert.match(dashboard, /action: 'requests', practitioner_id: practitionerId, status: statusFilter/)
  assert.match(dashboard, /requestsHeading.current\?\.focus/)
  assert.match(read('src/components/rdv/UpcomingBookings.jsx'), /mediumia:finance-saved/)
  const dialog = read('src/components/rdv/OwnerCancellationPreview.jsx')
  assert.match(dialog, /type="checkbox"/)
  assert.match(dialog, /Annulation non activée/)
  assert.doesNotMatch(dialog, /method: '(POST|DELETE|PUT)'/)
})

test('native upcoming rows retain the existing collection event through prebuild', () => {
  const script = read('scripts/apply-rdv-manual-payments.mjs')
  assert.match(script, /if \(source.includes\('<UpcomingBookings'\)\)/)
  assert.match(script, /rdv_native_upcoming_payment_controls_missing/)
  const upcoming = read('src/components/rdv/UpcomingBookings.jsx')
  assert.match(upcoming, /new CustomEvent\('mediumia:manual-payment', \{ detail: \{ bookingId: booking.id \} \}\)/)
  assert.match(upcoming, /document.getElementById\('mediumia-accounting'\)/)
  assert.match(upcoming, /balance\?\.remaining_cents > 0/)
})
