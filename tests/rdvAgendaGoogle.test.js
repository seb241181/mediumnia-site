import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { encrypt } from '../lib/googleOAuth.js'
import { listAgendaGoogleEvents } from '../lib/googleCalendarEvents.js'

const start = '2026-10-18T00:00:00Z', end = '2026-10-19T00:00:00Z'
function connection(data) {
  const q = { select() { return q }, eq() { return q }, async single() { return { data } } }
  return { from() { return q } }
}
function connected() {
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = '1'.repeat(64)
  return connection({ google_calendar_id: 'test-calendar', access_token_enc: encrypt('test-local-not-a-real-token'), token_expiry: new Date(Date.now() + 3600000).toISOString() })
}
test('Google reader paginates using GET only and never exposes credentials', async () => {
  const requests = []
  const result = await listAgendaGoogleEvents({ supabase: connected(), practitionerId: 'test', start, end, fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), options })
    return { ok: true, json: async () => requests.length === 1 ? { items: [{ id: 'first' }], nextPageToken: 'second' } : { items: [{ id: 'last' }] } }
  } })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'second')
  assert.equal(requests[0].url.searchParams.get('timeMin'), start)
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(result.events.length, 2)
  assert.equal(result.accessToken, undefined)
  assert.equal(JSON.stringify(result).includes('test-local-not-a-real-token'), false)
})
test('Google non-connected needs no external request', async () => {
  const result = await listAgendaGoogleEvents({ supabase: connection(null), practitionerId: 'test', start, end, fetchImpl() { throw Error('must not fetch') } })
  assert.equal(result.status, 'not_connected')
})
test('Google failed second page discards incomplete set', async () => {
  let count = 0
  const result = await listAgendaGoogleEvents({ supabase: connected(), practitionerId: 'test', start, end, fetchImpl: async () => {
    count++
    return count === 1 ? { ok: true, json: async () => ({ items: [{ id: 'first' }], nextPageToken: 'next' }) } : { ok: false }
  } })
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(result.events, [])
})
test('Google timeout is reported as unavailable without leaking exception', async () => {
  const result = await listAgendaGoogleEvents({ supabase: connected(), practitionerId: 'test', start, end, fetchImpl: async () => { throw Error('private-test-message') } })
  assert.deepEqual(result, { status: 'unavailable', events: [] })
})
test('Google pagination cap is explicit, not a silently complete calendar', async () => {
  const result = await listAgendaGoogleEvents({ supabase: connected(), practitionerId: 'test', start, end, fetchImpl: async () => ({ ok: true, json: async () => ({ items: [], nextPageToken: 'repeat' }) }) })
  assert.deepEqual(result, { status: 'limit_exceeded', events: [] })
})
