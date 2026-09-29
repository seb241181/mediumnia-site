import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAppointmentReminderEmail, handledByBalanceReminder, sendAppointmentReminders } from '../lib/rdvAppointmentReminders.js'
import { SMS_PROVIDERS, buildAppointmentSms, normalizeFrenchMobile, sendAppointmentSmsReminders } from '../lib/rdvSmsReminders.js'
import { balanceSweepUpperBound, reminderWindow } from '../lib/parisReminderDays.js'
import { runDailySweep } from '../lib/rdvBalanceCronHandler.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Mardi 29 septembre 2026, 9 h à Paris (passage de la tâche quotidienne).
const NOW = new Date('2026-09-29T07:00:00Z')

test('J-3 email: date, time, service, Meet link only when given; never « acompte non remboursé »', () => {
  const visio = buildAppointmentReminderEmail({ firstName: 'Elea', serviceTitle: 'Guidance — Visio', startsAt: '2026-10-02T12:00:00Z', meetLink: 'https://meet.google.com/abc-defg-hij' })
  assert.equal(visio.subject, 'Rappel : votre rendez-vous du vendredi 2 octobre à 14 h 00')
  assert.match(visio.text, /Bonjour Elea,/)
  assert.match(visio.text, /Lien de visioconférence : https:\/\/meet\.google\.com\/abc-defg-hij/)
  assert.match(visio.html, /Rejoindre la visioconférence/)
  const cabinet = buildAppointmentReminderEmail({ firstName: '<b>x</b>', serviceTitle: 'Désenvoûtement — En présence', startsAt: '2026-10-02T08:00:00Z' })
  assert.doesNotMatch(cabinet.text, /visioconférence/)
  assert.doesNotMatch(cabinet.html, /<b>x<\/b>/)
  for (const mail of [visio, cabinet]) assert.doesNotMatch(mail.text + mail.html, /acompte|non rembours/i)
})

test('a video with a balance due is left to the existing balance reminder (same rule as the cron)', () => {
  const video = { modality: ['video'] }
  const withBalance = { booked_price_cents: 7000, reservation_payment_cents: 2000, balance_paid_at: null }
  assert.equal(handledByBalanceReminder({ booking: withBalance, service: video, paidCents: 2000 }), true)
  assert.equal(handledByBalanceReminder({ booking: withBalance, service: video, paidCents: 7000 }), false) // réglée
  assert.equal(handledByBalanceReminder({ booking: withBalance, service: { modality: ['in-person'] }, paidCents: 2000 }), false)
  assert.equal(handledByBalanceReminder({ booking: { booked_price_cents: null, reservation_payment_cents: null }, service: video, paidCents: 0 }), false) // ancien RDV
  const cron = read('lib/rdvBalanceCronHandler.js')
  for (const rule of ["item.service?.modality?.includes('video')", 'item.booking.reservation_payment_cents || 0) > 0', 'item.paidCents > 0', 'item.dueCents > 0', '!item.booking.balance_paid_at']) {
    assert.ok(cron.includes(rule), `règle du rappel de solde : ${rule}`)
  }
})

function fakeDb({ bookings = [], paid = {}, services = [], claimable = () => true, lookupError = null } = {}) {
  const calls = { updates: [], windows: {} }
  return {
    calls,
    from(table) {
      const filters = {}
      let update = null
      const q = {
        select() { return q },
        eq(k, v) { filters[k] = v; return q },
        is(k, v) { filters[`is:${k}`] = v; return q },
        in() { return q },
        gte(k, v) { calls.windows.gte = v; return q },
        lt(k, v) { calls.windows.lt = v; return q },
        gt(k, v) { calls.windows.gt = v; return q },
        lte(k, v) { calls.windows.lte = v; return q },
        limit() { return q },
        update(values) { update = values; calls.updates.push({ values, id: filters.id }); return q },
        maybeSingle() { return Promise.resolve({ data: claimable(filters.id) ? { id: filters.id } : null, error: null }) },
        then(resolve) {
          if (table === 'bookings' && !update) return resolve({ data: lookupError ? null : bookings, error: lookupError })
          if (table === 'booking_services') return resolve({ data: services, error: null })
          if (table === 'rdv_financial_entries') return resolve({ data: Object.entries(paid).map(([booking_id, gross_cents]) => ({ booking_id, gross_cents, direction: 'income' })), error: null })
          return resolve({ data: null, error: null })
        },
      }
      return q
    },
  }
}

const booking = (id, extra = {}) => ({ id, service_id: 'cab', customer_first_name: 'Marine', customer_email: `${id}@exemple.fr`, starts_at: '2026-10-02T06:00:00Z', timezone: 'Europe/Paris', created_at: '2026-09-05T10:00:00Z', booked_price_cents: null, reservation_payment_cents: null, ...extra })
const SERVICES = [{ id: 'cab', title: 'Guidance — En présence', modality: ['in-person'] }, { id: 'vis', title: 'Guidance — Visio', modality: ['video'] }]

test('one J-3 email per appointment; balance visios, fresh bookings and failures handled', async () => {
  const sent = []
  const originalFetch = globalThis.fetch
  process.env.RESEND_API_KEY = 'test'
  process.env.RESEND_FROM_EMAIL = 'MediumIA <rdv@exemple.fr>'
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push({ to: body.to, meet: /meet\.google\.com/.test(body.text) })
    return body.to === 'fail@exemple.fr' ? { ok: false, status: 500 } : { ok: true, json: async () => ({ id: 'e1' }) }
  }
  try {
    const db = fakeDb({
      services: SERVICES,
      paid: { balance: 2000, paidvisio: 7000 },
      bookings: [
        booking('old'),                                                                                  // ancien RDV sans montants : rappel simple
        booking('paidvisio', { service_id: 'vis', booked_price_cents: 7000, reservation_payment_cents: 7000, google_meet_link: 'https://meet.google.com/x' }),
        booking('balance', { service_id: 'vis', booked_price_cents: 7000, reservation_payment_cents: 2000 }), // e-mail de solde à la place
        booking('fresh', { created_at: '2026-09-29T05:00:00Z' }),
        booking('taken'),
        booking('fail'),
      ],
      claimable: (id) => id !== 'taken',
    })
    const result = await sendAppointmentReminders(db, NOW)
    assert.deepEqual(result, { sent: 2, failed: 1, balance: 1 })
    assert.deepEqual(sent, [{ to: 'old@exemple.fr', meet: false }, { to: 'paidvisio@exemple.fr', meet: true }, { to: 'fail@exemple.fr', meet: false }])
    assert.deepEqual(db.calls.updates.at(-1).values, { appointment_reminder_sent_at: null })
    assert.equal(db.calls.windows.gte, '2026-09-30T22:00:00.000Z') // jeudi 1er oct. 0 h à Paris (rattrapage J-2)
    assert.equal(db.calls.windows.lt, '2026-10-02T22:00:00.000Z')  // samedi 3 oct. 0 h à Paris
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
  }
})

test('before the SQL is applied, the daily task simply skips the J-3 email', async () => {
  const result = await sendAppointmentReminders(fakeDb({ lookupError: { code: '42703', message: 'column appointment_reminder_sent_at does not exist' } }), NOW)
  assert.deepEqual(result, { skipped: 'migration_pending', sent: 0 })
})

test('SMS J-1: nothing is read or sent while no SMS provider is plugged in', async () => {
  assert.deepEqual(SMS_PROVIDERS, {})
  let touched = false
  const db = { from() { touched = true; throw new Error('should not query') } }
  assert.deepEqual(await sendAppointmentSmsReminders(db, { now: NOW, env: {} }), { skipped: 'provider_not_configured', sent: 0 })
  assert.deepEqual(await sendAppointmentSmsReminders(db, { now: NOW, env: { SMS_PROVIDER: 'inconnu' } }), { skipped: 'provider_not_configured', sent: 0 })
  assert.equal(touched, false)
})

test('SMS J-1: French mobiles only, one short message', () => {
  assert.equal(normalizeFrenchMobile('06 12 34 56 78'), '+33612345678')
  assert.equal(normalizeFrenchMobile('+33 7 12 34 56 78'), '+33712345678')
  assert.equal(normalizeFrenchMobile('0033612345678'), '+33612345678')
  assert.equal(normalizeFrenchMobile('03 20 00 00 00'), null) // fixe
  assert.equal(normalizeFrenchMobile(''), null)
  const sms = buildAppointmentSms({ firstName: 'Marie Dupont', startsAt: '2026-09-30T12:00:00Z' })
  assert.equal(sms, 'Bonjour Marie, petit rappel de votre rendez-vous MediumIA demain a 14h00 avec Sebastien. A bientot.')
  assert.ok(sms.length <= 160)
})

test('the daily task runs the J-3 email and the (inactive) SMS step; the SQL only adds two columns', () => {
  const cron = read('lib/rdvBalanceCronHandler.js')
  assert.ok(cron.indexOf('await runDailySweep(supabase)') < cron.indexOf('await sendAppointmentReminders(supabase)'))
  assert.match(cron, /smsReminders = await sendAppointmentSmsReminders\(supabase\)/)
  const sql = read('supabase/migrations/20260929130000_rdv_appointment_reminder.sql')
  assert.match(sql, /add column if not exists appointment_reminder_sent_at timestamptz/)
  assert.match(sql, /add column if not exists appointment_sms_reminder_sent_at timestamptz/)
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b|drop table/i)
})

// Mardi 29 septembre, passage de 9 h à Paris : J-3 = vendredi 2 octobre.
async function withResend(handler, fn) {
  const originalFetch = globalThis.fetch
  process.env.RESEND_API_KEY = 'test'
  process.env.RESEND_FROM_EMAIL = 'MediumIA <rdv@exemple.fr>'
  globalThis.fetch = handler
  try { return await fn() } finally {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
  }
}

test('J-3 means the Paris calendar day: Friday 14 h and Friday 8 h are both reminded on Tuesday 9 h', async () => {
  const days = reminderWindow(NOW)
  assert.equal(days.targetDay, '2026-10-02')
  const sent = []
  const db = fakeDb({
    services: SERVICES,
    bookings: [
      booking('ven14', { starts_at: '2026-10-02T12:00:00Z' }), // vendredi 14 h (77 h avant)
      booking('ven08', { starts_at: '2026-10-02T06:00:00Z' }), // vendredi 8 h (71 h avant)
      booking('sam10', { starts_at: '2026-10-03T08:00:00Z' }), // samedi : pas encore
    ],
  })
  const result = await withResend(async (url, init) => { sent.push(JSON.parse(init.body).to); return { ok: true, json: async () => ({ id: 'e' }) } },
    () => sendAppointmentReminders(db, NOW))
  assert.deepEqual(sent, ['ven14@exemple.fr', 'ven08@exemple.fr'])
  assert.equal(result.sent, 2)
})

function balanceDb({ bookings, paid = {}, services = SERVICES }) {
  const rpcCalls = []
  const db = fakeDb({ bookings, paid, services })
  db.rpcCalls = rpcCalls
  db.rpc = (name, args) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: name === 'claim_rdv_balance_reminder' ? true : { ok: true }, error: null }) }
  return db
}

test('the balance reminder can leave on the morning of J-3 even at more than 72 h, and retries after a failed send', async () => {
  assert.equal(balanceSweepUpperBound(NOW).toISOString(), '2026-10-02T22:00:00.000Z') // fin du vendredi à Paris
  const visio = booking('ven14', { service_id: 'vis', starts_at: '2026-10-02T12:00:00Z', booked_price_cents: 7000, reservation_payment_cents: 2000, balance_reminder_sent_at: null })

  // 1er passage (mardi, 77 h avant) : Resend échoue → la réservation est libérée, rien n'est finalisé.
  const failing = balanceDb({ bookings: [visio], paid: { ven14: 2000 } })
  const first = await withResend(async () => ({ ok: false, status: 500 }), () => runDailySweep(failing, NOW))
  assert.deepEqual(first.counts, { reminder_failed: 1 })
  assert.deepEqual(failing.rpcCalls.map((c) => c.name), ['claim_rdv_balance_reminder', 'release_rdv_balance_reminder'])

  // 2e passage (mercredi 9 h, 53 h avant, avant H-48) : nouvel essai, cette fois envoyé.
  const retry = balanceDb({ bookings: [visio], paid: { ven14: 2000 } })
  const second = await withResend(async () => ({ ok: true, json: async () => ({ id: 'e2' }) }), () => runDailySweep(retry, new Date('2026-09-30T07:00:00Z')))
  assert.deepEqual(second.counts, { reminder_sent: 1 })
  assert.deepEqual(retry.rpcCalls.map((c) => c.name), ['claim_rdv_balance_reminder', 'finalize_rdv_balance_reminder'])
})

test('never both: a visio with a balance gets the balance email only, even when that email failed', async () => {
  const visio = booking('ven14', { service_id: 'vis', starts_at: '2026-10-02T12:00:00Z', booked_price_cents: 7000, reservation_payment_cents: 2000 })
  const cabinet = booking('cab14', { starts_at: '2026-10-02T12:00:00Z' })
  const sent = []
  const db = balanceDb({ bookings: [visio, cabinet], paid: { ven14: 2000 } })
  await withResend(async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push({ to: body.to, subject: body.subject })
    return body.to === 'ven14@exemple.fr' ? { ok: false, status: 500 } : { ok: true, json: async () => ({ id: 'e' }) }
  }, async () => {
    await runDailySweep(db, NOW)               // rappel de solde d'abord (échoue ici)
    await sendAppointmentReminders(db, NOW)    // puis rappel général
  })
  const toVisio = sent.filter((m) => m.to === 'ven14@exemple.fr')
  assert.equal(toVisio.length, 1)
  assert.match(toVisio[0].subject, /solde/)
  assert.deepEqual(sent.filter((m) => m.to === 'cab14@exemple.fr').length, 1)
})
