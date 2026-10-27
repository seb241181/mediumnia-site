import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pendingVisioBookings } from '../lib/rdvUnpaidVisio.js'

const bookings = [
  { id: 'video-unpaid', modality: 'video', status: 'confirmed' },
  { id: 'video-paid', modality: 'video', status: 'confirmed' },
  { id: 'phone-unpaid', modality: 'phone', status: 'confirmed' },
  { id: 'cabinet-unpaid', modality: 'in-person', status: 'confirmed' },
  { id: 'unknown-unpaid', modality: null, status: 'confirmed' },
  { id: 'cancelled', modality: 'video', status: 'cancelled' },
]
const balances = Object.fromEntries(bookings.map(b => [b.id, { total_cents: 7000, remaining_cents: b.id === 'video-paid' ? 0 : 5000 }]))

test('upcoming work list retains only videoconferences with a real outstanding balance', () => {
  assert.deepEqual(pendingVisioBookings(bookings, balances).map(b => b.id), ['video-unpaid'])
  assert.deepEqual(pendingVisioBookings(bookings, { ...balances, 'video-unpaid': { total_cents: 7000, remaining_cents: 0 } }), [])
  assert.deepEqual(pendingVisioBookings(bookings, {}), [])
})

test('upcoming visios use verified selected modality and the existing owner-only booking balances ledger', () => {
  const api = fs.readFileSync('api/rdv-admin.js', 'utf8')
  const dashboard = fs.readFileSync('src/components/rdv/RdvDashboard.jsx', 'utf8')
  const panel = fs.readFileSync('src/components/rdv/UpcomingVisioToCollect.jsx', 'utf8')
  assert.match(api, /resolveAgendaModality\(\{/)
  assert.match(api, /confirmed_booking_id, requested_modality/)
  assert.match(api, /converted_booking_id, selected_modality/)
  assert.match(api, /upcoming_bookings: upcomingWithModality/)
  assert.match(dashboard, /<UpcomingVisioToCollect/)
  assert.match(panel, /action: 'booking-balances'/)
  assert.match(panel, /mediumia:finance-saved/)
  assert.match(panel, /focus', refresh/)
  assert.match(panel, /if \(bookingIds\.some\(id => !result\[id\] \|\| result\[id\]\.total_cents <= 0\)\)/)
  assert.match(panel, /Reste à régler/)
  assert.match(panel, /Le.*reste.*dans l’agenda/)
})
