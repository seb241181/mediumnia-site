import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityProjection, syncAvailabilityCalendar, AVAILABILITY_SOURCE } from '../lib/availabilityCalendarSync.js'

const days = [{ date: '2026-12-05', status: 'free_slots', exceptionType: 'modified', slots: [{ start: Date.parse('2026-12-05T08:30:00Z'), end: Date.parse('2026-12-05T09:30:00Z'), available: true }, { start: 0, end: 0, available: false }] }, { date: '2026-12-16', status: 'exception_closed', slots: [] }]

test('projection is transparent, client-free and distinguishes exceptional/closed', () => {
  const out = availabilityProjection({ days })
  assert.equal(out.length, 2); assert.equal(out[0].summary, 'Disponibilité exceptionnelle'); assert.equal(out[1].summary, 'Jour fermé — MediumIA')
  assert.equal(out[0].colorId, '3'); assert.equal(out[1].colorId, '8')
  assert.ok(out.every((e) => !JSON.stringify(e).match(/client|email|phone/i)))
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  return syncAvailabilityCalendar({ targetCalendarId: 'availability-secondary', sourceCalendarId: 'seb', desired: out, existing: [], accessToken: 'x', fetchImpl: fake })
    .then(() => {
      for (const call of calls) {
        const body = JSON.parse(call.init.body)
        assert.equal(body.visibility, 'private')
        assert.equal(body.transparency, 'transparent')
      }
    })
})

test('regular bookable slots also use violet while exceptional closures stay gray', () => {
  const [slot] = availabilityProjection({ days: [{ date: '2027-01-05', status: 'free_slots', slots: [{ start: Date.parse('2027-01-05T08:30:00Z'), end: Date.parse('2027-01-05T09:30:00Z'), available: true }] }] })
  assert.equal(slot.summary, 'Disponible')
  assert.equal(slot.colorId, '3')
})

test('sync is idempotent and cannot target seb', async () => {
  const desired = availabilityProjection({ days })
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  await assert.rejects(() => syncAvailabilityCalendar({ targetCalendarId: 'seb', sourceCalendarId: 'seb', desired, accessToken: 'x', fetchImpl: fake }), /dedicated_target/)
  await assert.rejects(() => syncAvailabilityCalendar({ targetCalendarId: 'primary', sourceCalendarId: 'seb', desired, accessToken: 'x', fetchImpl: fake }), /dedicated_target/)
  const existing = desired.map((d) => ({ id: d.id, extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }))
  const res = await syncAvailabilityCalendar({ targetCalendarId: 'test', sourceCalendarId: 'seb', desired, existing, accessToken: 'x', fetchImpl: fake })
  assert.deepEqual(res, { created: 0, updated: 0, unchanged: 2, deleted: 0, errors: [] }); assert.equal(calls.length, 0)
})

test('sync creates only the dedicated target events and removes stale owned events', async () => {
  const desired = availabilityProjection({ days }).slice(0, 1)
  const stale = { id: 'old', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await syncAvailabilityCalendar({ targetCalendarId: 'availability-test', sourceCalendarId: 'seb', desired, existing: [stale], accessToken: 'x', fetchImpl: fake })
  assert.equal(r.created, 1); assert.equal(r.deleted, 1); assert.equal(calls[0].init.method, 'POST'); assert.match(calls[0].init.body, /transparent/)
})

test('sync patches its own event when the visual projection changes', async () => {
  const desired = availabilityProjection({ days }).slice(0, 1)
  const existing = { id: desired[0].id, summary: 'Disponible', colorId: '10', transparency: 'transparent', visibility: 'private', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await syncAvailabilityCalendar({ targetCalendarId: 'availability-test', sourceCalendarId: 'seb', desired, existing: [existing], accessToken: 'x', fetchImpl: fake })
  assert.equal(r.updated, 1); assert.equal(calls[0].init.method, 'PATCH'); assert.match(calls[0].init.body, /"colorId":"6"/)
})

test('a failed creation never deletes a previously published availability', async () => {
  const desired = availabilityProjection({ days }).slice(0, 1)
  const stale = { id: 'old', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE } } }
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: false, status: 503 } }
  const r = await syncAvailabilityCalendar({ targetCalendarId: 'availability-test', sourceCalendarId: 'seb', desired, existing: [stale], accessToken: 'x', fetchImpl: fake })
  assert.equal(r.deleted, 0); assert.equal(r.errors.length, 1); assert.equal(calls.length, 1)
})

test('a cancelled Google tombstone is reinserted with a new Google id but the same source key', async () => {
  const desired = availabilityProjection({ days }).slice(0, 1)
  const tombstone = { id: desired[0].id, status: 'cancelled', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE, mediumia_key: desired[0].key } } }
  const calls = []
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } }
  const r = await syncAvailabilityCalendar({ targetCalendarId: 'availability-test', sourceCalendarId: 'seb', desired, existing: [tombstone], accessToken: 'x', fetchImpl: fake })
  const body = JSON.parse(calls[0].init.body)
  assert.equal(r.created, 1); assert.equal(calls[0].init.method, 'POST'); assert.equal(body.id, undefined); assert.equal(body.extendedProperties.private.mediumia_key, desired[0].key)
})
