import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parisDayBounds, summarizeDay } from '../lib/rdvDayPayments.js'
import { defaultPaymentDate, parseAmount } from '../src/components/rdv/dailyPaymentsHelpers.js'

const services = [{ id: 's1', title: 'Guidance', price_cents: 7000, vat_rate_bps: 2000 }]
const booking = (id, startsAt, extra = {}) => ({
  id, service_id: 's1', status: 'confirmed', booking_source: 'mediumia', booked_price_cents: 7000,
  customer_first_name: 'Marie', customer_last_name: id, starts_at: startsAt, ends_at: startsAt.replace('T08', 'T09'), ...extra,
})
const entry = (id, bookingId, method, gross, occurredAt, kind = 'balance') => {
  const net = Math.round((gross * 10000) / 12000)
  return { id, booking_id: bookingId, payment_method: method, entry_kind: kind, direction: 'income', occurred_at: occurredAt, gross_cents: gross, net_cents: net, vat_cents: gross - net }
}

test('Paris day bounds follow summer and winter time', () => {
  assert.deepEqual(parisDayBounds('2026-09-23'), { start: '2026-09-22T22:00:00.000Z', end: '2026-09-23T22:00:00.000Z' })
  assert.deepEqual(parisDayBounds('2026-12-01'), { start: '2026-11-30T23:00:00.000Z', end: '2026-12-01T23:00:00.000Z' })
  assert.deepEqual(parisDayBounds('2026-10-25'), { start: '2026-10-24T22:00:00.000Z', end: '2026-10-25T23:00:00.000Z' }) // 25 h
  assert.deepEqual(parisDayBounds('2026-03-29'), { start: '2026-03-28T23:00:00.000Z', end: '2026-03-29T22:00:00.000Z' }) // 23 h
})

test('online payments are pre-filled and only the remainder is left to collect', () => {
  const { start, end } = parisDayBounds('2026-09-23')
  const result = summarizeDay(
    [booking('a', '2026-09-23T08:00:00+00:00'), booking('b', '2026-09-23T12:00:00+00:00'), booking('c', '2026-09-23T14:00:00+00:00')],
    services,
    [
      // Arrhes paid online two weeks earlier, balance in cash today.
      entry('e1', 'a', 'paypal', 2000, '2026-09-09T10:00:00+00:00', 'arrhes'),
      entry('e2', 'a', 'cash', 5000, '2026-09-23T09:00:00+00:00'),
      // Fully paid online.
      entry('e3', 'b', 'paypal', 7000, '2026-09-20T10:00:00+00:00', 'full_payment'),
      // Split payment today: card then nothing yet.
      entry('e4', 'c', 'card', 3000, '2026-09-23T15:00:00+00:00'),
    ],
    start,
    end,
  )
  const [a, b, c] = result.bookings
  assert.equal(a.remaining_cents, 0)
  assert.equal(a.payments[0].online, true)
  assert.equal(a.payments[0].entry_kind, 'arrhes')
  assert.equal(b.remaining_cents, 0)
  assert.equal(c.remaining_cents, 4000)
  assert.equal(result.remaining_cents, 4000)

  // Day totals only count money received that day, split by method with VAT.
  assert.equal(result.collected.totals.gross_cents, 8000)
  assert.equal(result.collected.by_method.cash.gross_cents, 5000)
  assert.equal(result.collected.by_method.card.gross_cents, 3000)
  assert.equal(result.collected.by_method.paypal.count, 0)
  assert.equal(result.collected.totals.net_cents + result.collected.totals.vat_cents, 8000)
  assert.equal(result.collected.by_method.cash.vat_cents, 833)
})

test('refunds reduce what was collected and non-confirmed bookings have nothing to collect', () => {
  const { start, end } = parisDayBounds('2026-09-23')
  const result = summarizeDay(
    [booking('r', '2026-09-23T08:00:00+00:00', { status: 'rescheduled' })],
    services,
    [{ ...entry('e5', 'r', 'cash', 2000, '2026-09-23T09:00:00+00:00'), direction: 'refund', entry_kind: 'refund' }],
    start,
    end,
  )
  assert.equal(result.bookings[0].remaining_cents, 0)
  assert.equal(result.collected.totals.gross_cents, -2000)
})

test('payment date and amount helpers', () => {
  const now = new Date('2026-09-23T16:00:00Z')
  assert.equal(defaultPaymentDate({ starts_at: '2026-09-23T08:00:00Z', ends_at: '2026-09-23T09:00:00Z' }, now).toISOString(), '2026-09-23T09:00:00.000Z')
  assert.equal(defaultPaymentDate({ starts_at: '2026-09-23T15:30:00Z', ends_at: '2026-09-23T16:30:00Z' }, now), now)
  assert.equal(parseAmount('50,5'), 5050)
  assert.equal(parseAmount('1 250,00'), 125000)
  assert.equal(parseAmount('0'), null)
  assert.equal(parseAmount('abc'), null)
})

test('the day view is wired to the owner-only admin API and reuses the audited finance write', () => {
  const api = fs.readFileSync(new URL('../api/rdv-admin.js', import.meta.url), 'utf8')
  const ui = fs.readFileSync(new URL('../src/components/rdv/DailyPayments.jsx', import.meta.url), 'utf8')
  assert.match(api, /case 'day-payments':/)
  assert.match(fs.readFileSync(new URL('../lib/rdvDayPayments.js', import.meta.url), 'utf8'), /\.eq\('owner_id', userId\)/)
  assert.match(ui, /\/api\/rdv-admin\?action=finance/)
  assert.match(ui, /client_request_id: crypto\.randomUUID\(\)/)
  for (const label of ['Carte bancaire', 'Espèces', 'Chèque', 'Virement']) assert.match(ui, new RegExp(label))
})
