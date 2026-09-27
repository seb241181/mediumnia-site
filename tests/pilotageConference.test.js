import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  getPilotageConferenceStats,
  isTestRegistration,
  parisDayKey,
  parisMidnight,
  pickCurrentEvent,
  registrationChannel,
  summarizeConferenceRegistrations,
} from '../lib/pilotageConference.js'

const EVENT = {
  id: 'evt-1',
  slug: 'premiere-conference-mediumia',
  title: 'Et si la médiumnité devenait accessible ?',
  starts_at: '2026-10-22T17:00:00.000Z',
  ends_at: '2026-10-22T18:00:00.000Z',
  status: 'registration_open',
  capacity: 100,
}

// 27 septembre 2026, 10 h à Paris (UTC+2).
const NOW = new Date('2026-09-27T08:00:00.000Z')

function row(overrides = {}) {
  return {
    status: 'registered',
    email_normalized: 'marie@gmail.com',
    source: 'conference_page:facebook',
    created_at: '2026-09-27T07:30:00.000Z',
    preparation_sent_at: '2026-09-27T07:30:05.000Z',
    zoom_sent_at: '2026-09-27T07:30:05.000Z',
    attended_at: null,
    ...overrides,
  }
}

// Faux client Supabase : filtre event_id, pagine avec range() et renvoie le
// nombre exact comme PostgREST, avec un plafond de lignes par réponse.
function fakeSupabase({ admins = [{ id: 'p1' }], events = [EVENT], registrations = [], maxRows = 1000, failOn = null } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const state = { table, filters: [], range: null }
      const builder = {
        select() { return builder },
        eq(col, value) { state.filters.push([col, value]); return builder },
        in() { return builder },
        order() { return builder },
        limit() { return builder },
        range(from, to) { state.range = [from, to]; return builder },
        then(resolve, reject) {
          calls.push(state)
          if (failOn === table) return Promise.resolve({ data: null, error: { code: 'XX000' } }).then(resolve, reject)
          if (table === 'booking_practitioners') return Promise.resolve({ data: admins, error: null }).then(resolve, reject)
          if (table === 'conference_events') return Promise.resolve({ data: events, error: null }).then(resolve, reject)
          const eventId = state.filters.find(([col]) => col === 'event_id')?.[1]
          const matching = registrations.filter(r => (r.event_id || 'evt-1') === eventId)
          const [from, to] = state.range || [0, matching.length - 1]
          const page = matching.slice(from, Math.min(to + 1, from + maxRows))
          return Promise.resolve({ data: page, error: null, count: matching.length }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

test('Paris day boundaries follow Europe/Paris, including daylight saving changes', () => {
  assert.equal(parisMidnight(NOW).toISOString(), '2026-09-26T22:00:00.000Z')
  assert.equal(parisMidnight(NOW, -1).toISOString(), '2026-09-25T22:00:00.000Z')
  // Dimanche 25 octobre 2026 : passage à l'heure d'hiver à 3 h.
  assert.equal(parisMidnight(new Date('2026-10-25T20:00:00.000Z')).toISOString(), '2026-10-24T22:00:00.000Z')
  assert.equal(parisMidnight(new Date('2026-10-26T09:00:00.000Z')).toISOString(), '2026-10-25T23:00:00.000Z')
  // 23 h 30 UTC le 26 = 1 h 30 le 27 à Paris.
  assert.equal(parisDayKey('2026-09-26T23:30:00.000Z'), '2026-09-27')
})

test('valid registrations exclude cancelled, test and invalid rows', () => {
  const stats = summarizeConferenceRegistrations({
    event: EVENT,
    now: NOW,
    rows: [
      row(),
      row({ email_normalized: 'paul@orange.fr', source: 'conference_page', created_at: '2026-09-26T21:30:00.000Z' }), // 23 h 30 le 26 à Paris → hier
      row({ email_normalized: 'lea@free.fr', status: 'attended', source: 'conference_page:instagram', created_at: '2026-09-20T10:00:00.000Z', preparation_sent_at: null }),
      row({ email_normalized: 'annule@gmail.com', status: 'cancelled' }),
      row({ email_normalized: 'essai@example.com' }),
      row({ email_normalized: 'seb@gmail.com', source: 'conference_page:test' }),
      row({ email_normalized: 'pas-un-email', source: 'conference_page' }),
    ],
  })
  assert.equal(stats.total, 3)
  assert.equal(stats.today, 1)
  assert.equal(stats.yesterday, 1)
  assert.equal(stats.last_7_days, 2)
  assert.equal(stats.cancelled, 1)
  assert.equal(stats.excluded_tests, 2)
  assert.equal(stats.excluded_invalid, 1)
  // Les places suivent exactement la règle du formulaire : tout ce qui n'est pas annulé.
  assert.equal(stats.seats_taken, 6)
  assert.equal(stats.remaining, 94)
  assert.equal(stats.fill_rate, 0.06)
  assert.equal(stats.preparation_sent, 2)
  assert.equal(stats.preparation_missing, 1)
  assert.equal(stats.attended, 1)
  assert.deepEqual(stats.by_channel, [
    { channel: 'direct', count: 1 },
    { channel: 'facebook', count: 1 },
    { channel: 'instagram', count: 1 },
  ])
  assert.equal(stats.daily.length, 14)
  assert.deepEqual(stats.daily.at(-1), { date: '2026-09-27', total: 1 })
  assert.deepEqual(stats.daily.at(-2), { date: '2026-09-26', total: 1 })
  assert.equal(stats.event.registration_open, true)
  assert.equal(stats.last_registration_at, '2026-09-27T07:30:00.000Z')
})

test('no capacity means no remaining seats or fill rate is invented', () => {
  const stats = summarizeConferenceRegistrations({ event: { ...EVENT, capacity: null }, rows: [row()], now: NOW })
  assert.equal(stats.capacity, null)
  assert.equal(stats.remaining, null)
  assert.equal(stats.fill_rate, null)
})

test('test and channel helpers never flag real addresses', () => {
  assert.equal(isTestRegistration({ email_normalized: 'contest.lover@gmail.com', source: 'conference_page:facebook' }), false)
  assert.equal(isTestRegistration({ email_normalized: 'marie@testament.fr', source: 'conference_page' }), false)
  assert.equal(isTestRegistration({ email_normalized: 'x@example.org', source: 'conference_page' }), true)
  assert.equal(isTestRegistration({ email_normalized: 'x@gmail.com', source: 'conference_page:demo' }), true)
  assert.equal(registrationChannel('conference_page:tiktok'), 'tiktok')
  assert.equal(registrationChannel('conference_page'), 'direct')
  assert.equal(registrationChannel(null), 'direct')
})

test('the tracked conference is the next one, never a draft or a cancelled one', () => {
  const events = [
    { ...EVENT, id: 'old', starts_at: '2026-06-01T17:00:00Z', ends_at: '2026-06-01T18:00:00Z', status: 'ended' },
    { ...EVENT, id: 'draft', starts_at: '2026-10-01T17:00:00Z', ends_at: null, status: 'draft' },
    EVENT,
    { ...EVENT, id: 'later', starts_at: '2027-01-01T17:00:00Z', ends_at: null, status: 'registration_open' },
  ]
  assert.equal(pickCurrentEvent(events, NOW).id, 'evt-1')
  assert.equal(pickCurrentEvent(events, new Date('2027-03-01T00:00:00Z')).id, 'later')
})

test('production stats read every page from Supabase, whatever the row cap', async () => {
  const registrations = Array.from({ length: 2345 }, (_, i) => row({ email_normalized: `personne${i}@gmail.com` }))
  registrations.push(row({ email_normalized: 'ailleurs@gmail.com', event_id: 'evt-2' }))
  const supabase = fakeSupabase({ registrations, maxRows: 500 })
  const result = await getPilotageConferenceStats({ supabase, userId: 'u1', env: { VERCEL_ENV: 'production' }, now: NOW })
  assert.equal(result.status, 200)
  assert.equal(result.body.preview, false)
  assert.equal(result.body.total, 2345)
  assert.ok(supabase.calls.filter(call => call.table === 'conference_registrations').length >= 3)
  // Aucun prénom, e-mail ni identifiant ne sort de l'API.
  const payload = JSON.stringify(result.body)
  assert.doesNotMatch(payload, /@gmail\.com|first_name|email/)
})

test('production stats are admin-only and fail closed', async () => {
  const forbidden = await getPilotageConferenceStats({ supabase: fakeSupabase({ admins: [] }), userId: 'u2', env: { VERCEL_ENV: 'production' }, now: NOW })
  assert.equal(forbidden.status, 403)
  const brokenAccess = await getPilotageConferenceStats({ supabase: fakeSupabase({ failOn: 'booking_practitioners' }), userId: 'u1', env: { VERCEL_ENV: 'production' }, now: NOW })
  assert.equal(brokenAccess.status, 500)
  const brokenData = await getPilotageConferenceStats({ supabase: fakeSupabase({ failOn: 'conference_registrations' }), userId: 'u1', env: { VERCEL_ENV: 'production' }, now: NOW })
  assert.equal(brokenData.status, 500)
  assert.equal(brokenData.body.total, undefined)
  const wrongMethod = await getPilotageConferenceStats({ supabase: fakeSupabase(), userId: 'u1', method: 'POST', env: { VERCEL_ENV: 'production' }, now: NOW })
  assert.equal(wrongMethod.status, 405)
})

test('preview never reads Supabase and labels its demo numbers', async () => {
  const supabase = fakeSupabase()
  const result = await getPilotageConferenceStats({ supabase, userId: 'u1', env: { VERCEL_ENV: 'preview' }, now: NOW })
  assert.equal(result.status, 200)
  assert.equal(result.body.preview, true)
  assert.equal(supabase.calls.length, 0)
})

test('pilotage wires the conference card to the live admin endpoint with polling', async () => {
  const [admin, card, pilotage] = await Promise.all([
    readFile(new URL('../api/rdv-admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/rdv/ConferenceRegistrationsCard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/rdv/PilotageDashboard.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(admin, /case 'conference-stats':[\s\S]+getPilotageConferenceStats/)
  assert.match(card, /action=conference-stats/)
  assert.match(card, /CONFERENCE_REFRESH_MS = 30_000/)
  assert.match(card, /visibilitychange/)
  assert.match(card, /INSCRIPTIONS CONFÉRENCE/)
  assert.doesNotMatch(card, /localStorage|sessionStorage/)
  assert.match(pilotage, /<ConferenceRegistrationsCard session=\{session\} demoMode=\{demoMode\} \/>/)
})
