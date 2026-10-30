import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeHolds, openOffers, generateSlots } from '../lib/rdvAvailability.js'
import { parisUTCOffsetMs } from '../lib/googleOAuth.js'

const publicApi = readFileSync(new URL('../api/rdv-availability.js', import.meta.url), 'utf8')

test('public range and day availability read payment holds and slot offers fail-closed', () => {
  assert.match(publicApi, /loadAvailabilityData\(\{\s*db: supabase, practitionerId: practitioner\.id, fromDate: from, toDate: to/)
  assert.match(publicApi, /loadAvailabilityData\(\{\s*db: supabase, practitionerId: practitioner\.id, fromDate: date, toDate: date/)
  assert.match(publicApi, /const heldSlots = activeHolds\(holds, snapshotNow\)/)
  assert.match(publicApi, /const offeredSlots = openOffers\(offers, snapshotNow\)/)
  assert.match(publicApi, /const dayHolds = activeHolds\(availability\.holds, new Date\(\)\)/)
  assert.match(publicApi, /const dayOffers = openOffers\(availability\.offers, new Date\(\)\)/)
  assert.equal((publicApi.match(/mode: 'error', slots: \[\], notice: 'Impossible de vérifier les disponibilités pour le moment\.'/g) || []).length, 2)
  assert.equal((publicApi.match(/\.\.\.dayBookings, \.\.\.dayHolds, \.\.\.dayOffers/g) || []).length, 2)
  assert.equal((publicApi.match(/dayBookings\.length \+ dayHolds\.length >= practitioner\.max_per_day/g) || []).length, 2)
})

test('an expired payment_pending releases, but payment_capturing remains blocking until PayPal reconciliation', () => {
  const now = new Date('2026-10-30T10:00:00Z')
  const date = '2026-11-10'
  const slot = { starts_at: '2026-11-10T08:30:00Z', ends_at: '2026-11-10T09:30:00Z', expires_at: '2026-10-19T08:33:58Z' }
  const holds = [
    { ...slot, status: 'payment_pending' },
    { ...slot, status: 'payment_capturing' },
    { ...slot, status: 'payment_captured' },
  ]
  assert.equal(activeHolds([holds[0]], now).length, 0)
  assert.equal(activeHolds(holds, now).length, 2)
  const rules = [{ start_time: '09:30:00', end_time: '10:30:00' }]
  const offset = parisUTCOffsetMs(date)
  const busy = activeHolds(holds, now).map(h => ({
    start: new Date(h.starts_at).getTime(),
    end: new Date(h.ends_at).getTime(),
  }))
  assert.equal(generateSlots(date, rules, [], busy, offset, 60, 0, 0)[0].available, false)
  assert.equal(generateSlots(date, rules, [], [], offset, 60, 0, 0)[0].available, true)
})

test('only open, unexpired personal slot offers block the public calendar', () => {
  const now = new Date('2026-10-30T10:00:00Z')
  const slot = { starts_at: '2026-11-10T08:30:00Z', ends_at: '2026-11-10T09:30:00Z' }
  assert.deepEqual(openOffers([
    { ...slot, status: 'open', expires_at: '2026-11-01T00:00:00Z' },
    { ...slot, status: 'open', expires_at: '2026-10-29T00:00:00Z' },
    { ...slot, status: 'used', expires_at: '2026-11-01T00:00:00Z' },
  ], now).length, 1)
})
