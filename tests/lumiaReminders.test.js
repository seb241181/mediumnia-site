import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sendAppointmentReminders } from '../lib/rdvAppointmentReminders.js'
import { SMS_PROVIDERS, sendAppointmentSmsReminders } from '../lib/rdvSmsReminders.js'
import { runDailySweep } from '../lib/rdvBalanceCronHandler.js'
import { reminderEligibleBookings } from '../lib/lumiaBookings.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Mardi 29 septembre 2026, 9 h à Paris : J-3 = vendredi 2 octobre, J-1 = mercredi 30.
const NOW = new Date('2026-09-29T07:00:00Z')

// Base simulée : bookings (MediumIA, Lumia « manual », « manual » ordinaire) et
// demandes d'agent reliées. Aucun réseau réel (Resend et SMS simulés).
function fakeDb({ bookings, linked = [] }) {
  const calls = { tables: [], bookingFilters: [] }
  return {
    calls,
    from(table) {
      calls.tables.push(table)
      const filters = {}
      let update = null
      const q = {
        select() { return q },
        eq(k, v) { filters[k] = v; if (table === 'bookings' && !update) calls.bookingFilters.push([k, v]); return q },
        is(k, v) { filters[`is:${k}`] = v; return q },
        not(k, op, v) { filters[`not:${k}`] = [op, v]; return q },
        in(k, v) { filters[`in:${k}`] = v; if (table === 'bookings') calls.bookingFilters.push([`in:${k}`, v]); return q },
        gte() { return q }, lt() { return q }, gt() { return q }, lte() { return q }, limit() { return q }, order() { return q },
        update(values) { update = values; return q },
        maybeSingle() { return Promise.resolve({ data: { id: filters.id }, error: null }) },
        then(resolve) {
          if (table === 'bookings' && !update) {
            const sources = filters['in:booking_source']
            const rows = bookings.filter((b) => (sources ? sources.includes(b.booking_source) : filters.booking_source ? b.booking_source === filters.booking_source : true))
            return resolve({ data: rows, error: null })
          }
          if (table === 'booking_requests') {
            const ids = filters['in:confirmed_booking_id'] || []
            assert.deepEqual(filters['not:intake_agent'], ['is', null], 'seulement les demandes d’agent')
            return resolve({ data: linked.filter((r) => ids.includes(r.confirmed_booking_id)), error: null })
          }
          if (table === 'booking_services') return resolve({ data: [{ id: 'cab', title: 'Guidance — En présence', modality: ['in-person'] }], error: null })
          return resolve({ data: [], error: null })
        },
      }
      return q
    },
    rpc() { return Promise.resolve({ data: null, error: null }) },
  }
}

const base = { service_id: 'cab', customer_first_name: 'Test', timezone: 'Europe/Paris', created_at: '2026-09-01T10:00:00Z', booked_price_cents: null, reservation_payment_cents: null }
const BOOKINGS = (startsAt) => [
  { ...base, id: 'medium', booking_source: 'mediumia', customer_email: 'medium@exemple.fr', customer_phone: '0611111111', starts_at: startsAt },
  { ...base, id: 'lumia', booking_source: 'manual', customer_email: 'lumia@exemple.fr', customer_phone: '0622222222', starts_at: startsAt },
  { ...base, id: 'saisie', booking_source: 'manual', customer_email: 'saisie@exemple.fr', customer_phone: '0633333333', starts_at: startsAt },
  { ...base, id: 'reservio', booking_source: 'reservio', customer_email: 'reservio@exemple.fr', customer_phone: '0644444444', starts_at: startsAt },
]
const LINKED = [{ confirmed_booking_id: 'lumia', requested_modality: 'in-person', video_channel: null }]

async function withResend(fn) {
  const sent = []
  const originalFetch = globalThis.fetch
  process.env.RESEND_API_KEY = 'test'
  process.env.RESEND_FROM_EMAIL = 'MediumIA <rdv@exemple.fr>'
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body).to); return { ok: true, json: async () => ({ id: 'e' }) } }
  try { await fn(); return sent } finally {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
  }
}

test('J-3 e-mail: MediumIA yes, Lumia manual linked to a request yes, ordinary manual and Reservio no', async () => {
  const db = fakeDb({ bookings: BOOKINGS('2026-10-02T12:00:00Z'), linked: LINKED })
  const sent = await withResend(() => sendAppointmentReminders(db, NOW))
  assert.deepEqual(sent, ['medium@exemple.fr', 'lumia@exemple.fr'])
  assert.ok(db.calls.bookingFilters.some(([k, v]) => k === 'in:booking_source' && v.join() === 'mediumia,manual'))
})

test('SMS J-1: same rule (provider simulated, nothing really sent)', async () => {
  const texts = []
  SMS_PROVIDERS.simulated = async ({ to, text }) => { texts.push({ to, text }); return { status: 'sent' } }
  try {
    const db = fakeDb({ bookings: BOOKINGS('2026-09-30T12:00:00Z'), linked: LINKED })
    const result = await sendAppointmentSmsReminders(db, { now: NOW, env: { SMS_PROVIDER: 'simulated' } })
    assert.deepEqual(texts.map((t) => t.to), ['+33611111111', '+33622222222'])
    // Le texte est bien construit à partir des champs de la base (prénom, heure de Paris).
    assert.equal(texts[0].text, 'Bonjour Test, petit rappel de votre rendez-vous MediumIA demain a 14h00 avec Sebastien. A bientot.')
    assert.equal(result.sent, 2)
  } finally { delete SMS_PROVIDERS.simulated }
})

test('ordinary manual bookings are not added; a lookup error adds no manual booking at all', async () => {
  const db = fakeDb({ bookings: BOOKINGS('2026-10-02T12:00:00Z'), linked: [] })
  const { eligible } = await reminderEligibleBookings(db, BOOKINGS('2026-10-02T12:00:00Z'))
  assert.deepEqual(eligible.map((b) => b.id), ['medium'])
  const broken = { from() { const q = { select: () => q, in: () => q, not: () => Promise.resolve({ data: null, error: { code: '42703' } }) }; return q } }
  const fallback = await reminderEligibleBookings(broken, BOOKINGS('2026-10-02T12:00:00Z'))
  assert.deepEqual(fallback.eligible.map((b) => b.id), ['medium'])
})

test('balance cron: Lumia manual bookings are never swept (MediumIA payment flow only)', async () => {
  const db = fakeDb({ bookings: BOOKINGS('2026-10-02T12:00:00Z'), linked: LINKED })
  const sweep = await runDailySweep(db, NOW)
  assert.ok(db.calls.bookingFilters.some(([k, v]) => k === 'booking_source' && v === 'mediumia'))
  assert.ok(!db.calls.tables.includes('booking_requests'), 'le circuit du solde ne cherche pas de demande Lumia')
  assert.ok(!sweep.results.some((r) => ['lumia', 'saisie'].includes(r.bookingId)))
  const cron = read('lib/rdvBalanceCronHandler.js')
  assert.match(cron, /\.eq\('booking_source', 'mediumia'\)/)
  assert.doesNotMatch(cron, /lumiaBookings|reminderEligibleBookings/)
  assert.match(read('lib/rdvBalanceApiHandler.js'), /\.eq\('booking_source', 'mediumia'\)/)
})
