import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getManualPaymentBookingContext, getManualPaymentBookings } from '../lib/rdvManualPaymentsAdmin.js'
import { groupPaymentBookings } from '../src/components/rdv/manualPaymentBookingOptions.js'

function fakeSupabase(tables, calls, { cap = Infinity, fails = () => false } = {}) {
  return {
    from(table) {
      const filters = []
      const request = { table, in: null, limit: null, cursor: null }
      const query = {
        select() { return this },
        eq(key, value) { filters.push(row => row[key] === value); return this },
        in(key, values) { request.in = values; filters.push(row => values.includes(row[key])); return this },
        order(key) { assert.equal(key, 'id'); return this },
        limit(size) { request.limit = size; return this },
        gt(key, value) { assert.equal(key, 'id'); request.cursor = value; filters.push(row => row[key] > value); return this },
        maybeSingle() { return this.then(result => ({ ...result, data: result.data?.[0] ?? null })) },
        then(resolve) {
          calls.push(request)
          if (fails(request)) return Promise.resolve(resolve({ error: { code: 'unavailable' } }))
          const data = (tables[table] || []).filter(row => filters.every(filter => filter(row)))
            .sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.min(request.limit ?? Infinity, cap))
          return Promise.resolve(resolve({ data }))
        },
      }
      return query
    },
  }
}

const practitionerId = 'practitioner-1'
const userId = 'owner'
const owner = { id: practitionerId, owner_id: userId }
const booking = (id, values = {}) => ({
  id, practitioner_id: practitionerId, service_id: 'service-1', status: 'confirmed',
  starts_at: '2025-11-27T09:00:00+01:00', booked_price_cents: 8000, ...values,
})
const entry = (id, booking_id, gross_cents, values = {}) => ({
  id, booking_id, practitioner_id: practitionerId, payment_method: 'cash', direction: 'income', gross_cents, ...values,
})
const service = { id: 'service-1', practitioner_id: practitionerId, price_cents: 7000 }
const tables = (bookings, entries) => ({
  booking_practitioners: [owner], bookings, booking_services: [service], rdv_financial_entries: entries,
})

test('old and same-day confirmed bookings are returned by ledger balance across both page types', async () => {
  const calls = []
  const bookings = [
    booking('a-old', { booked_price_cents: null }),
    booking('b-settled'),
    booking('c-refunded'),
    booking('d-cancelled', { status: 'cancelled' }),
    booking('e-no-show', { status: 'no_show' }),
    booking('f-other', { practitioner_id: 'another-practitioner' }),
    ...Array.from({ length: 106 }, (_, i) => booking('i-' + String(i).padStart(3, '0'))),
    booking('x-morning', { starts_at: '2026-11-27T09:00:00+01:00' }),
    booking('y-afternoon', { starts_at: '2026-11-27T16:00:00+01:00' }),
  ]
  const entries = [
    ...Array.from({ length: 503 }, (_, i) => entry('a-' + String(i).padStart(3, '0'), 'b-settled', 1)),
    entry('a-999', 'b-settled', 7497),
    entry('b', 'c-refunded', 8000, { payment_method: 'gift_card' }),
    entry('c', 'c-refunded', 500, { direction: 'refund' }),
    entry('d', 'a-old', 7000, { practitioner_id: 'another-practitioner' }),
  ]
  // A lower server cap must not be interpreted as the end of the dataset.
  const supabase = fakeSupabase(tables(bookings, entries), calls, { cap: 70 })
  const result = await getManualPaymentBookings({ supabase, userId, practitionerId })
  assert.equal(result.status, 200)
  const ids = result.body.bookings.map(b => b.id)
  for (const id of ['a-old', 'c-refunded', 'x-morning', 'y-afternoon']) assert.ok(ids.includes(id))
  for (const id of ['b-settled', 'd-cancelled', 'e-no-show', 'f-other']) assert.ok(!ids.includes(id))
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 110)
  assert.ok(calls.filter(c => c.table === 'bookings' && c.cursor).length >= 2)
  assert.ok(calls.filter(c => c.table === 'rdv_financial_entries' && c.cursor).length >= 7)
  assert.ok(calls.filter(c => c.table === 'rdv_financial_entries').every(c => c.in.length <= 100 && c.limit === 500))

  const groups = groupPaymentBookings(result.body.bookings, new Date('2026-11-27T12:00:00+01:00'))
  assert.equal(groups.recent[0].id, 'x-morning')
  assert.deepEqual(groups.upcoming.map(b => b.id), ['y-afternoon'])
})

test('another owner cannot read booking or payment pages', async () => {
  const calls = []
  const result = await getManualPaymentBookings({
    supabase: fakeSupabase(tables([], []), calls), userId: 'other-owner', practitionerId,
  })
  assert.equal(result.status, 403)
  assert.deepEqual(calls.map(c => c.table), ['booking_practitioners'])
})

test('an entry page error makes the entire collection list unavailable', async () => {
  const calls = []
  const supabase = fakeSupabase(tables([booking('a')], [entry('a', 'a', 100)]), calls, {
    fails: request => request.table === 'rdv_financial_entries' && request.cursor !== null,
  })
  const result = await getManualPaymentBookings({ supabase, userId, practitionerId })
  assert.deepEqual(result, { status: 500, body: { error: 'finance_lookup_error' } })
})

test('the selected booking context counts every entry before proposing an amount', async () => {
  const calls = []
  const supabase = fakeSupabase(tables([booking('a')], [
    entry('a', 'a', 2000, { payment_method: 'paypal' }),
    entry('b', 'a', 6000),
    entry('c', 'a', 500, { direction: 'refund' }),
  ]), calls, { cap: 1 })
  const result = await getManualPaymentBookingContext({ supabase, userId, practitionerId, bookingId: 'a' })
  assert.equal(result.status, 200)
  assert.equal(result.body.booking.remaining_cents, 500)
  assert.equal(calls.filter(c => c.table === 'rdv_financial_entries').length, 4)
})

test('the mobile payment choice precedes gift cards and keeps the H-48 restriction', () => {
  const source = readFileSync(new URL('../src/components/rdv/RdvDepositCheckout.jsx', import.meta.url), 'utf8')
  const visual = source.indexOf('Choisissez le montant à régler')
  assert.ok(visual > 0 && visual < source.indexOf('<GiftCardRedeem'))
  assert.match(source, /<fieldset[^>]*>[\s\S]*?Verser les arrhes[\s\S]*?Régler la totalité/)
  assert.match(source, /checked=\{paymentChoice === 'arrhes'\} disabled=\{fullPaymentRequired\}/)
  assert.match(source, /const fullPaymentRequired = canPayInFull[\s\S]*?48 \* 3_600_000/)
})
