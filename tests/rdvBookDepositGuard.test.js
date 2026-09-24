import test from 'node:test'
import assert from 'node:assert/strict'

// Calls the real /api/rdv-book handler with a fake Supabase behind fetch: a service
// that requires a deposit cannot be booked there without payment.
process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'

const practitioner = { id: 'p1', name: 'Sébastien', timezone: 'Europe/Paris', is_active: true, booking_enabled: true, booking_horizon_days: 60, min_advance_hours: 0, buffer_before_min: 0, buffer_after_min: 0, max_per_day: null }
const service = { id: 's1', title: 'Guidance', duration_min: 60, price_cents: 8000, modality: ['in-person'], booking_mode: 'instant', reservation_payment_kind: 'arrhes', reservation_payment_cents: 2000 }
let createBookingCalled = false

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const one = (row) => new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.pathname.endsWith('/rpc/create_booking')) { createBookingCalled = true; return one({ booking_id: 'x' }) }
  if (url.pathname.endsWith('/booking_practitioners')) return one(practitioner)
  if (url.pathname.endsWith('/booking_services')) return one(service)
  if (url.pathname.endsWith('/gift_cards')) return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
}

const { default: handler } = await import('../api/rdv-book.js')

async function book(body) {
  let status = 0, payload = null
  const res = { setHeader() {}, status(c) { status = c; return this }, json(p) { payload = p; return this } }
  await handler({ method: 'POST', headers: {}, query: {}, body }, res)
  return { status, payload }
}

const base = { practitioner_slug: 'sebastien-seguin', service_slug: 'guidance', date: '2031-03-03', time: '10:00', customer: { firstName: 'Marie', lastName: 'Test', email: 'marie@exemple.fr' } }

test('a deposit service cannot be booked without paying online', async () => {
  const { status, payload } = await book(base)
  assert.equal(status, 409)
  assert.equal(payload.code, 'online_payment_required')
  assert.equal(createBookingCalled, false)
})

test('an unknown gift code is refused before any booking', async () => {
  const { status, payload } = await book({ ...base, gift_code: 'MDIA-AAAA-BBBB' })
  assert.equal(status, 409)
  assert.equal(payload.code, 'gift_code_invalid')
  assert.equal(createBookingCalled, false)
})
