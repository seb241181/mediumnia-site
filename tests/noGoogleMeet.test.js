import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { syncBookingToGoogleCalendar } from '../lib/googleCalendarEvents.js'
import { encrypt } from '../lib/googleOAuth.js'
import { buildRdvDepositConfirmation } from '../lib/rdvDepositConfirmationEmail.js'
import { buildRdvBalancePaidConfirmation } from '../lib/rdvBalanceEmail.js'
import { isVideoOnly, visioLabel } from '../lib/visioChannel.js'

// Règle métier : visio de Sébastien = WhatsApp ou FaceTime, JAMAIS Google Meet.
// Aucun appel réseau réel : Google est simulé.

const ROOT = new URL('../', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function googleStub() {
  const sent = []
  const updates = []
  const supabase = {
    from(table) {
      const q = {
        select() { return q }, eq() { return q },
        single() {
          return Promise.resolve({ data: table === 'booking_calendar_connections'
            ? { access_token_enc: encrypt('jeton-test'), refresh_token_enc: null, token_expiry: '2099-01-01T00:00:00Z', google_calendar_id: 'test@group.calendar.google.com' }
            : null })
        },
        update(values) { updates.push({ table, values }); return q },
        then(ok, ko) { return Promise.resolve({ data: null, error: null }).then(ok, ko) },
      }
      return q
    },
  }
  return { sent, updates, supabase }
}

async function withGoogle(answer, fn) {
  const prevKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64)
  const realFetch = globalThis.fetch
  const stub = googleStub()
  globalThis.fetch = async (url, opts = {}) => {
    stub.sent.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    return answer(String(url), opts)
  }
  try { return await fn(stub) } finally {
    globalThis.fetch = realFetch
    if (prevKey === undefined) delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
    else process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = prevKey
  }
}

const EVENT = { title: 'Guidance — Visio — Test', startsAt: '2026-10-13T12:00:00Z', endsAt: '2026-10-13T13:00:00Z', description: 'Visio — canal à confirmer' }

test('calendar sync never asks Google for a conference, even if an old caller still passes createConference', async () => {
  await withGoogle(() => new Response(JSON.stringify({ id: 'evt1', hangoutLink: 'https://meet.google.com/ignore-me' }), { status: 200 }), async ({ sent, updates, supabase }) => {
    const result = await syncBookingToGoogleCalendar({ supabase, practitionerId: 'p1', bookingId: '11111111-0000-4000-8000-000000000001', currentGoogleEventId: null, createConference: true, event: EVENT })
    assert.deepEqual(result, { status: 'synced', google_event_id: 'evt1' })
    assert.equal(sent.length, 1)
    assert.doesNotMatch(sent[0].url, /conferenceDataVersion/)
    assert.equal('conferenceData' in sent[0].body, false)
    // Même si Google renvoyait un lien, il n'est ni enregistré ni renvoyé.
    assert.deepEqual(updates, [{ table: 'bookings', values: { google_event_id: 'evt1' } }])
  })
})

test('existing event (409): read without conference data, Meet link never stored', async () => {
  await withGoogle((url, opts) => (opts.method === 'POST'
    ? new Response('{}', { status: 409 })
    : new Response(JSON.stringify({ id: 'evt-old', hangoutLink: 'https://meet.google.com/old' }), { status: 200 })), async ({ sent, updates, supabase }) => {
    const result = await syncBookingToGoogleCalendar({ supabase, practitionerId: 'p1', bookingId: '11111111-0000-4000-8000-000000000002', currentGoogleEventId: null, event: EVENT })
    assert.deepEqual(result, { status: 'synced', google_event_id: 'evt-old' })
    for (const call of sent) assert.doesNotMatch(call.url, /conferenceDataVersion/)
    assert.deepEqual(updates, [{ table: 'bookings', values: { google_event_id: 'evt-old' } }])
  })
})

test('visio labels: WhatsApp, FaceTime or channel to confirm — never another tool', () => {
  assert.equal(visioLabel('whatsapp'), 'Visio — WhatsApp')
  assert.equal(visioLabel('facetime'), 'Visio — FaceTime')
  assert.equal(visioLabel('a_preciser'), 'Visio — canal à confirmer')
  assert.equal(visioLabel('meet'), 'Visio — canal à confirmer')
  assert.equal(visioLabel(), 'Visio — canal à confirmer')
  assert.equal(isVideoOnly(['video']), true)
  assert.equal(isVideoOnly(['video', 'in-person']), false)
  assert.equal(isVideoOnly(['in-person']), false)
})

test('deposit / full-payment confirmation: « Visio — canal à confirmer », no Meet link or button', () => {
  for (const depositCents of [2000, 7000]) {
    const mail = buildRdvDepositConfirmation({ firstName: 'Claire', serviceTitle: 'Guidance — Visio', startsAt: '2026-10-13T12:00:00Z', servicePriceCents: 7000, depositCents, cancelUrl: 'https://mediumia.fr/rdv/annuler#t', visio: visioLabel('a_preciser') })
    assert.match(mail.text, /Modalité : Visio — canal à confirmer/)
    assert.match(mail.text, /WhatsApp ou FaceTime/)
    assert.match(mail.html, /Visio — canal à confirmer/)
    assert.doesNotMatch(mail.text + mail.html, /meet\.google|Rejoindre la visioconférence|Lien de visioconférence/)
  }
  const cabinet = buildRdvDepositConfirmation({ firstName: 'Paul', serviceTitle: 'Guidance — En présence', startsAt: '2026-10-13T12:00:00Z', servicePriceCents: 7000, depositCents: 2000, cancelUrl: 'https://mediumia.fr/x' })
  assert.doesNotMatch(cabinet.text + cabinet.html, /Visio|visioconférence/)
})

test('balance paid confirmation: visio channel, never an old Meet link', () => {
  const mail = buildRdvBalancePaidConfirmation({ firstName: 'Claire', serviceTitle: 'Guidance — Visio', startsAt: '2026-10-13T12:00:00Z', paidCents: 5000, visio: visioLabel('a_preciser'), meetLink: 'https://meet.google.com/old' })
  assert.match(mail.text, /Modalité : Visio — canal à confirmer/)
  assert.doesNotMatch(mail.text + mail.html, /meet\.google|Rejoindre la visioconférence/)
})

test('paid booking finalization and instant booking: no conference request, visio channel instead', () => {
  const deposit = stripComments(read('lib/rdvDepositApiHandler.js'))
  assert.match(deposit, /const visio = isVideo \? visioLabel\('a_preciser'\) : null/)
  assert.match(deposit, /hold:rdv_booking_holds\(selected_modality\)/)
  assert.match(deposit, /\.\.\.\(visio \? \[visio\] : \[\]\),\s+`Identifiant MediumIA : \$\{booking\.id\}`/)
  const book = stripComments(read('api/rdv-book.js'))
  assert.match(book, /\.\.\.\(isVideoOnly\(service\.modality\) \? \[visioLabel\('a_preciser'\)\] : \[\]\)/)
})

function codeFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) return codeFiles(rel)
    return /\.(m?js|jsx)$/.test(name) && !/\.bak/.test(name) ? [rel] : []
  })
}

test('global audit: no Google Meet creation or link anywhere in api/, lib/, src/, scripts/ (code, comments excluded)', () => {
  const forbidden = /createConference|conferenceData|conferenceDataVersion|hangoutsMeet|hangoutLink|google_meet_link|meetLink|meet\.google|Rejoindre la visioconférence|Meet →/
  const offenders = []
  for (const dir of ['api', 'lib', 'src', 'scripts']) {
    for (const file of codeFiles(dir)) {
      const lines = stripComments(read(file)).split('\n')
      lines.forEach((line, i) => { if (forbidden.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`) })
    }
  }
  assert.deepEqual(offenders, [])
})
