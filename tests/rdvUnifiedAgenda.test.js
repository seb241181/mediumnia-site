import test from 'node:test'
import assert from 'node:assert/strict'
import { agendaRange, mergeAgendaEvents, getUnifiedAgenda } from '../lib/rdvUnifiedAgenda.js'

const practitioner = '00000000-0000-4000-8000-000000000001'
const query = { practitioner_id: practitioner, from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }
const booking = { id: practitioner, starts_at: '2026-10-18T09:00:00Z', ends_at: '2026-10-18T10:00:00Z', status: 'confirmed', google_event_id: 'linked' }
const event = id => ({ id, summary: 'Fictif', start: { date: '2026-10-18' }, end: { date: '2026-10-19' } })
function db({ owner = true, ownerError = false, linksError = false, bookingsError = false, syncJobs = [] } = {}) {
  const calls = []
  return { calls, from(table) {
    const q = { select() { return q }, eq(...args) { calls.push([table, ...args]); return q }, lt() { return q }, gt() { return q },
      order() { return table === 'rdv_calendar_sync_jobs' ? { data: syncJobs, error: null } : q },
      async maybeSingle() { return { data: owner ? { id: practitioner } : null, error: ownerError } },
      async range() { return { data: [booking], error: bookingsError } },
      in() { return table === 'rdv_calendar_sync_jobs' ? q : { data: [{ google_event_id: 'outside' }], error: linksError } },
    }
    return q
  } }
}
const balances = async () => ({ status: 200, body: { balances: { [practitioner]: { total_cents: 5000, paid_cents: 2000, remaining_cents: 3000 } } } })
const google = async () => ({ status: 'ready', calendarId: 'test', events: [event('linked'), event('outside'), event('external')] })

test('agenda bounds require explicit UTC, positive interval and at most 62 days', () => {
  assert.ok(agendaRange(query.from, query.to))
  for (const [a, b] of [[query.to, query.from], [query.from, query.from], ['invalid', query.to], ['2026-10-01', query.to], [query.from, '2027-01-01T00:00:00Z']]) assert.equal(agendaRange(a, b), null)
})
test('merge suppresses linked, cancelled and duplicate Google events, not matching titles', () => {
  const events = mergeAgendaEvents({ bookings: [booking], googleEvents: [event('linked'), event('external'), event('external'), { ...event('cancelled'), status: 'cancelled' }], linkedIds: new Set(['linked']), calendarId: 'test' })
  assert.equal(events.length, 2)
  assert.equal(events[1].allDay || events[0].allDay, true)
  const external = events.find(e => e.source === 'google')
  assert.equal(external.end, '2026-10-19')
  assert.equal(external.payment, null)
  assert.deepEqual(external.permissions, { move: false, cancel: false, refund: false })
})
test('non-owner refused before any Google or financial access', async () => {
  const result = await getUnifiedAgenda({ supabase: db({ owner: false }), userId: 'other', query, loadGoogle() { throw Error('forbidden') }, loadBalances() { throw Error('forbidden') } })
  assert.equal(result.status, 403)
})
test('owner query failure is not represented as empty agenda', async () => {
  assert.equal((await getUnifiedAgenda({ supabase: db({ ownerError: true }), userId: 'owner', query })).status, 503)
})
test('booking lookup failure aborts before external access', async () => {
  assert.equal((await getUnifiedAgenda({ supabase: db({ bookingsError: true }), userId: 'owner', query })).status, 503)
})
test('owner scoped links exclude moved bookings outside the requested window', async () => {
  const supabase = db()
  const result = await getUnifiedAgenda({ supabase, userId: 'owner', query, loadGoogle: google, loadBalances: balances })
  assert.equal(result.status, 200)
  assert.equal(result.body.events.length, 2)
  assert.equal(result.body.events.find(e => e.source === 'mediumia').payment.provider_verified, false)
  assert.ok(supabase.calls.some(c => c[0] === 'booking_practitioners' && c[1] === 'owner_id' && c[2] === 'owner'))
  assert.ok(supabase.calls.filter(c => c[0] === 'bookings').every(c => c[1] === 'practitioner_id' && c[2] === practitioner))
})
test('failed link lookup fails closed instead of offering unsafe Google-only actions', async () => {
  assert.equal((await getUnifiedAgenda({ supabase: db({ linksError: true }), userId: 'owner', query, loadGoogle: google, loadBalances: balances })).status, 503)
})
test('Google outage retains MediumIA events and reports missing source', async () => {
  const result = await getUnifiedAgenda({ supabase: db(), userId: 'owner', query, loadGoogle: async () => ({ status: 'unavailable' }), loadBalances: balances })
  assert.equal(result.body.events.length, 1)
  assert.equal(result.body.sources.google, 'unavailable')
})
test('finance outage never becomes a zero balance or an unpaid assertion', async () => {
  const result = await getUnifiedAgenda({ supabase: db(), userId: 'owner', query, loadGoogle: google, loadBalances: async () => ({ status: 503 }) })
  assert.equal(result.body.sources.finance, 'unavailable')
  assert.equal(result.body.events.find(e => e.source === 'mediumia').payment, null)
})
test('invalid practitioner and range cause no database access', async () => {
  assert.equal((await getUnifiedAgenda({ supabase: {}, userId: 'owner', query: { ...query, practitioner_id: 'bad' } })).status, 400)
})
