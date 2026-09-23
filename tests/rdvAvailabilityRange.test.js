import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// The month view (?from=&days=) must say "free" exactly on the days where the
// day view (?date=) returns at least one available slot. Supabase and Google are
// replaced by an in-memory fake behind global fetch.

process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64)

const { encrypt } = await import('../lib/googleOAuth.js')
const { default: handler } = await import('../api/rdv-availability.js')

const iso = (s) => new Date(s).toISOString()
const tables = {
  booking_practitioners: [{ id: 'p1', slug: 'sebastien-seguin', timezone: 'Europe/Paris', is_active: true, booking_enabled: true, min_advance_hours: 0, buffer_before_min: 15, buffer_after_min: 15, max_per_day: 2 }],
  booking_calendar_connections: [{ practitioner_id: 'p1', is_active: true, access_token_enc: encrypt('token'), refresh_token_enc: 'unused', token_expiry: iso('2999-01-01'), google_calendar_id: 'cal@test' }],
  booking_services: [{ practitioner_id: 'p1', slug: 'consultation', is_active: true, duration_min: 60 }],
  // Lundi → vendredi 09:00-12:00 et 14:00-17:00 (0 = lundi côté base).
  booking_availability_rules: [0, 1, 2, 3, 4].flatMap((day) => [
    { practitioner_id: 'p1', day_of_week: day, start_time: '09:00', end_time: '12:00' },
    { practitioner_id: 'p1', day_of_week: day, start_time: '14:00', end_time: '17:00' },
  ]),
  booking_exceptions: [
    { practitioner_id: 'p1', exception_date: '2031-03-04', exception_type: 'closed', slots: null },
    { practitioner_id: 'p1', exception_date: '2031-03-08', exception_type: 'modified', slots: [{ start_time: '10:00', end_time: '11:00' }] },
  ],
  bookings: [
    // Journée pleine (max_per_day = 2).
    { practitioner_id: 'p1', status: 'confirmed', starts_at: iso('2031-03-05T08:00:00Z'), ends_at: iso('2031-03-05T09:00:00Z') },
    { practitioner_id: 'p1', status: 'confirmed', starts_at: iso('2031-03-05T13:00:00Z'), ends_at: iso('2031-03-05T14:00:00Z') },
    // Le samedi modifié n'a qu'un créneau, pris.
    { practitioner_id: 'p1', status: 'confirmed', starts_at: iso('2031-03-08T09:00:00Z'), ends_at: iso('2031-03-08T10:00:00Z') },
    { practitioner_id: 'p1', status: 'cancelled', starts_at: iso('2031-03-10T08:00:00Z'), ends_at: iso('2031-03-10T09:00:00Z') },
  ],
}
// Google : le jeudi 6 est entièrement occupé, le vendredi 7 seulement le matin.
const googleBusy = [
  { start: iso('2031-03-06T07:00:00Z'), end: iso('2031-03-06T17:00:00Z') },
  { start: iso('2031-03-07T07:00:00Z'), end: iso('2031-03-07T11:00:00Z') },
]
let freeBusyCalls = 0

function matches(row, key, raw) {
  const [op, ...rest] = raw.split('.')
  const value = rest.join('.')
  const cell = String(row[key])
  if (op === 'eq') return cell === value
  if (op === 'gte') return cell >= value
  if (op === 'lte') return cell <= value
  if (op === 'lt') return cell < value
  throw new Error(`unsupported filter ${op}`)
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === 'www.googleapis.com') {
    freeBusyCalls += 1
    const { timeMin, timeMax } = JSON.parse(init.body)
    const busy = googleBusy.filter((b) => b.start < timeMax && b.end > timeMin)
    return new Response(JSON.stringify({ calendars: { 'cal@test': { busy } } }), { status: 200 })
  }
  const table = url.pathname.replace('/rest/v1/', '')
  let rows = tables[table] || []
  for (const [key, raw] of url.searchParams) {
    if (['select', 'order', 'limit'].includes(key)) continue
    rows = rows.filter((row) => matches(row, key, raw))
  }
  const headers = new Headers(init.headers)
  const single = (headers.get('accept') || '').includes('vnd.pgrst.object')
  if (single) {
    if (rows.length !== 1) return new Response(JSON.stringify({ message: 'not single' }), { status: 406 })
    return new Response(JSON.stringify(rows[0]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function call(query) {
  let status = 0
  let body = null
  const res = {
    setHeader() {},
    status(code) { status = code; return this },
    json(payload) { body = payload; return this },
  }
  await handler({ method: 'GET', query }, res)
  return { status, body }
}

test('month view agrees with the day view on every day of the range', async () => {
  const from = '2031-03-03'
  const range = await call({ practitioner: 'sebastien-seguin', service_slug: 'consultation', from, days: '14' })
  assert.equal(range.status, 200)
  assert.equal(range.body.mode, 'live')
  assert.equal(freeBusyCalls, 1, 'one Google FreeBusy call for the whole range')

  const expected = {}
  for (const date of Object.keys(range.body.days)) {
    const day = await call({ practitioner: 'sebastien-seguin', service_slug: 'consultation', date })
    expected[date] = Array.isArray(day.body.slots) && day.body.slots.some((s) => s.available)
  }
  assert.deepEqual(range.body.days, expected)

  // Sanity: the fixtures cover each rule.
  assert.equal(range.body.days['2031-03-03'], true)   // lundi libre
  assert.equal(range.body.days['2031-03-04'], false)  // fermeture exceptionnelle
  assert.equal(range.body.days['2031-03-05'], false)  // max_per_day atteint
  assert.equal(range.body.days['2031-03-06'], false)  // Google occupé toute la journée
  assert.equal(range.body.days['2031-03-07'], true)   // après-midi libre
  assert.equal(range.body.days['2031-03-08'], false)  // samedi modifié, créneau pris
  assert.equal(range.body.days['2031-03-09'], false)  // dimanche sans règle
  assert.equal(range.body.days['2031-03-10'], true)   // réservation annulée ignorée
})

test('month view rejects oversized or malformed ranges', async () => {
  assert.equal((await call({ practitioner: 'sebastien-seguin', service_slug: 'consultation', from: '2031-03-03', days: '32' })).status, 400)
  assert.equal((await call({ practitioner: 'sebastien-seguin', service_slug: 'consultation', from: '03/03/2031', days: '7' })).status, 400)
  assert.equal((await call({ practitioner: 'sebastien-seguin', from: '2031-03-03', days: '7' })).status, 400)
})

test('calendar loads a month in one request and falls back to per-day checks', () => {
  const page = fs.readFileSync(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8')
  assert.match(page, /from: toDateStr\(candidates\[0\]\)/)
  assert.match(page, /loadMonthAtOnce\(\)/)
})
