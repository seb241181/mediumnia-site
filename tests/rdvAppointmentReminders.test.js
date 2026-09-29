import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAppointmentReminderEmail, reminderDayLabel, sendAppointmentReminders } from '../lib/rdvAppointmentReminders.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Mardi 29 septembre 2026, 9 h à Paris (passage de la tâche quotidienne).
const NOW = new Date('2026-09-29T07:00:00Z')

test('the reminder says « demain » or « aujourd’hui » in Paris time', () => {
  assert.equal(reminderDayLabel('2026-09-30T12:00:00Z', NOW), 'demain')
  assert.equal(reminderDayLabel('2026-09-29T16:00:00Z', NOW), 'aujourd’hui')
  assert.equal(reminderDayLabel('2026-09-30T21:30:00Z', NOW), 'demain') // 23 h 30 à Paris
  assert.equal(reminderDayLabel('2026-09-30T22:30:00Z', NOW), 'jeudi 1 octobre') // 0 h 30 le 1er à Paris
})

test('the reminder email: date, time, service, Meet link when there is one, one reminder only', () => {
  const visio = buildAppointmentReminderEmail({ firstName: 'Kellie', serviceTitle: 'Guidance — Visio', startsAt: '2026-09-30T12:00:00Z', meetLink: 'https://meet.google.com/abc-defg-hij', now: NOW })
  assert.equal(visio.subject, 'Rappel : votre rendez-vous demain à 14 h 00')
  assert.match(visio.text, /Bonjour Kellie,/)
  assert.match(visio.text, /Guidance — Visio/)
  assert.match(visio.text, /Lien de visioconférence : https:\/\/meet\.google\.com\/abc-defg-hij/)
  assert.match(visio.html, /Rejoindre la visioconférence/)
  assert.match(visio.text, /Vous ne recevrez qu’un seul rappel/)
  const cabinet = buildAppointmentReminderEmail({ firstName: '<b>x</b>', serviceTitle: 'Désenvoûtement — En présence', startsAt: '2026-09-30T08:00:00Z', now: NOW })
  assert.doesNotMatch(cabinet.text, /visioconférence/)
  assert.doesNotMatch(cabinet.html, /<b>x<\/b>/)
})

function fakeDb({ bookings = [], claimable = () => true, lookupError = null } = {}) {
  const calls = { updates: [] }
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
        gt() { return q },
        lte() { return q },
        limit() { return q },
        update(values) { update = values; calls.updates.push({ values, id: filters.id }); return q },
        maybeSingle() { return Promise.resolve({ data: claimable(filters.id) ? { id: filters.id } : null, error: null }) },
        then(resolve) {
          if (table === 'bookings' && !update) return resolve({ data: lookupError ? null : bookings, error: lookupError })
          if (table === 'booking_services') return resolve({ data: [{ id: 's1', title: 'Guidance' }], error: null })
          return resolve({ data: null, error: null })
        },
      }
      return q
    },
  }
}

const booking = (id, extra = {}) => ({ id, service_id: 's1', customer_first_name: 'Kellie', customer_email: `${id}@exemple.fr`, starts_at: '2026-09-30T12:00:00Z', timezone: 'Europe/Paris', created_at: '2026-09-05T10:00:00Z', ...extra })

test('one reminder per appointment: claimed before sending, fresh bookings skipped, failures released', async () => {
  const sent = []
  const originalFetch = globalThis.fetch
  process.env.RESEND_API_KEY = 'test'
  process.env.RESEND_FROM_EMAIL = 'MediumIA <rdv@exemple.fr>'
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    sent.push(body.to)
    return body.to === 'fail@exemple.fr' ? { ok: false, status: 500 } : { ok: true, json: async () => ({ id: 'e1' }) }
  }
  try {
    const db = fakeDb({
      bookings: [
        booking('old'),                                              // ancien RDV sans arrhes : rappel
        booking('fresh', { created_at: '2026-09-29T05:00:00Z' }),    // réservé il y a 2 h : pas de rappel
        booking('taken'),                                            // déjà réservé par un autre passage
        booking('fail'),                                             // envoi en échec : ligne libérée
        booking('nomail', { customer_email: null }),
      ],
      claimable: (id) => id !== 'taken',
    })
    const result = await sendAppointmentReminders(db, NOW)
    assert.deepEqual(result, { sent: 1, failed: 1 })
    assert.deepEqual(sent, ['old@exemple.fr', 'fail@exemple.fr'])
    assert.deepEqual(db.calls.updates.at(-1).values, { appointment_reminder_sent_at: null })
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
  }
})

test('before the SQL is applied, the daily task simply skips reminders', async () => {
  const result = await sendAppointmentReminders(fakeDb({ lookupError: { code: '42703', message: 'column appointment_reminder_sent_at does not exist' } }), NOW)
  assert.deepEqual(result, { skipped: 'migration_pending', sent: 0 })
})

test('the daily task sends reminders and the SQL only adds a column', () => {
  const cron = read('lib/rdvBalanceCronHandler.js')
  assert.match(cron, /reminders = await sendAppointmentReminders\(supabase\)/)
  const sql = read('supabase/migrations/20260929130000_rdv_appointment_reminder.sql')
  assert.match(sql, /add column if not exists appointment_reminder_sent_at timestamptz/)
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b|drop table/i)
})
