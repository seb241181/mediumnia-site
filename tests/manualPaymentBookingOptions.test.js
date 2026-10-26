import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPaymentBookings } from '../src/components/rdv/manualPaymentBookingOptions.js'

test('previous sessions come first and the next appointment cannot replace them', () => {
  const now = new Date('2026-10-26T20:00:00+01:00')
  const bookings = [
    { id: 'tomorrow', starts_at: '2026-10-27T09:00:00+01:00' },
    { id: 'morning', starts_at: '2026-10-26T09:30:00+01:00' },
    { id: 'yesterday', starts_at: '2026-10-25T11:00:00+01:00' },
    { id: 'later', starts_at: '2026-10-28T10:00:00+01:00' },
    { id: 'morning', starts_at: '2026-10-26T09:30:00+01:00' },
  ]
  const result = groupPaymentBookings(bookings, now)
  assert.deepEqual(result.recent.map(b => b.id), ['morning', 'yesterday'])
  assert.deepEqual(result.upcoming.map(b => b.id), ['tomorrow', 'later'])
})

test('invalid or absent appointments are ignored and no booking is preselected', () => {
  const res = groupPaymentBookings([{ id: 'bad', starts_at: 'not-a-date' }, { id: 'missing' }, null], new Date('2026-10-26T09:00:00Z'))
  assert.equal(res.recent.length, 0)
  assert.equal(res.upcoming.length, 0)
})
