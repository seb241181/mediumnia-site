import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityProjection, syncAvailabilityCalendar, AVAILABILITY_SOURCE } from '../lib/availabilityCalendarSync.js'

const days = [{ date: '2026-12-05', status: 'free_slots', exceptionType: 'modified', slots: [{ start: Date.parse('2026-12-05T08:30:00Z'), end: Date.parse('2026-12-05T09:30:00Z'), available: true }, { start: 0, end: 0, available: false }] }, { date: '2026-12-16', status: 'exception_closed', slots: [] }]

test('projection is transparent, client-free and distinguishes exceptional/closed', () => {
  const out = availabilityProjection({ days })
  assert.equal(out.length, 2); assert.equal(out[0].summary, 'Disponibilité exceptionnelle'); assert.equal(out[1].summary, 'Jour fermé — MediumIA')
  assert.ok(out.every((e) => !JSON.stringify(e).match(/client|email|phone/i)))
})

test('sync is idempotent and cannot target seb', async () => {
  const desired = availabilityProjection({ days })
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  await assert.rejects(() => syncAvailabilityCalendar({ targetCalendarId: 'seb', sourceCalendarId: 'seb', desired, accessToken: 'x', fetchImpl: fake }), /dedicated_target/)
  const existing = desired.map((d) => ({ id: d.id, extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }))
  const res = await syncAvailabilityCalendar({ targetCalendarId: 'test', sourceCalendarId: 'seb', desired, existing, accessToken: 'x', fetchImpl: fake })
  assert.deepEqual(res, { created: 0, unchanged: 2, deleted: 0, errors: [] }); assert.equal(calls.length, 0)
})

test('sync creates only the dedicated target events and removes stale owned events', async () => {
  const desired = availabilityProjection({ days }).slice(0, 1)
  const stale = { id: 'old', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await syncAvailabilityCalendar({ targetCalendarId: 'availability-test', sourceCalendarId: 'seb', desired, existing: [stale], accessToken: 'x', fetchImpl: fake })
  assert.equal(r.created, 1); assert.equal(r.deleted, 1); assert.equal(calls[0].init.method, 'POST'); assert.match(calls[0].init.body, /transparent/)
})
