/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  accountSpaceEmailBlock,
  accountSpaceUrl,
  applyHoldContactModeToBooking,
  normalizeVideoChannel,
  saveBookingContactMode,
  saveHoldVideoChannel,
  singleModality,
} from '../lib/rdvContactMode.js'
import { visioContactNote } from '../lib/visioChannel.js'
import { validPhone } from '../src/lib/rdvContact.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Faux client Supabase : enregistre les écritures, renvoie la ligne fournie.
function fakeSupabase({ hold = null, fail = false } = {}) {
  const writes = []
  const chain = (table) => {
    const state = { table, values: null }
    const api = {
      update(values) { state.values = values; return api },
      select() { return api },
      eq() { return api },
      is() { return api },
      order() { return api },
      limit() { return api },
      maybeSingle: async () => ({ data: hold, error: null }),
      then(resolve) {
        if (fail) return resolve({ error: { message: 'column does not exist' } })
        writes.push({ table: state.table, values: state.values })
        return resolve({ error: null })
      },
    }
    return api
  }
  return { writes, from: chain }
}

test('seul un choix explicite WhatsApp ou FaceTime est retenu', () => {
  assert.equal(normalizeVideoChannel(' WhatsApp '), 'whatsapp')
  assert.equal(normalizeVideoChannel('facetime'), 'facetime')
  for (const value of ['zoom', 'meet', 'a_preciser', '', null, 42]) assert.equal(normalizeVideoChannel(value), null)
  assert.equal(singleModality(['video']), 'video')
  assert.equal(singleModality(['video', 'in-person']), null)
  assert.equal(singleModality(null), null)
})

test('blocage : le canal n’est mémorisé que pour une consultation à distance', async () => {
  const db = fakeSupabase()
  assert.equal(await saveHoldVideoChannel(db, 'h1', { selectedModality: 'video', videoChannel: 'facetime' }), true)
  assert.deepEqual(db.writes, [{ table: 'rdv_booking_holds', values: { video_channel: 'facetime' } }])
  assert.equal(await saveHoldVideoChannel(db, 'h1', { selectedModality: 'in-person', videoChannel: 'facetime' }), false)
  assert.equal(await saveHoldVideoChannel(db, 'h1', { selectedModality: 'video', videoChannel: 'zoom' }), false)
  assert.equal(db.writes.length, 1)
})

test('colonne absente ou base en panne : jamais d’exception, le paiement continue', async () => {
  assert.equal(await saveHoldVideoChannel(fakeSupabase({ fail: true }), 'h1', { selectedModality: 'video', videoChannel: 'whatsapp' }), false)
  assert.equal(await saveBookingContactMode(fakeSupabase({ fail: true }), 'b1', { modality: 'video', videoChannel: 'whatsapp' }), false)
  const broken = { from() { throw new Error('indisponible') } }
  assert.equal(await saveHoldVideoChannel(broken, 'h1', { selectedModality: 'video', videoChannel: 'whatsapp' }), false)
  assert.deepEqual(await applyHoldContactModeToBooking(broken, 'b1'), { modality: null, videoChannel: null })
})

test('après paiement : le choix du blocage est recopié sur le rendez-vous', async () => {
  const db = fakeSupabase({ hold: { selected_modality: 'video', video_channel: 'whatsapp' } })
  assert.deepEqual(await applyHoldContactModeToBooking(db, 'b1'), { modality: 'video', videoChannel: 'whatsapp' })
  assert.deepEqual(db.writes, [{ table: 'bookings', values: { modality: 'video', video_channel: 'whatsapp' } }])
  const inPerson = fakeSupabase({ hold: { selected_modality: 'in-person', video_channel: 'whatsapp' } })
  assert.deepEqual(await applyHoldContactModeToBooking(inPerson, 'b1'), { modality: 'in-person', videoChannel: null })
  assert.deepEqual(inPerson.writes[0].values, { modality: 'in-person', video_channel: null })
  assert.deepEqual(await applyHoldContactModeToBooking(fakeSupabase(), 'b1'), { modality: null, videoChannel: null })
})

test('message de contact : WhatsApp ou FaceTime, jamais de lien', () => {
  assert.equal(visioContactNote('WhatsApp', '+33600000001'), 'Le jour de votre rendez-vous, Sébastien vous contactera directement via WhatsApp, au +33600000001.')
  assert.equal(visioContactNote('FaceTime'), 'Le jour de votre rendez-vous, Sébastien vous contactera directement via FaceTime.')
  assert.equal(visioContactNote(null), null)
})

test('rappel de l’espace client dans les e-mails', () => {
  const previous = { ...process.env }
  try {
    delete process.env.VERCEL_ENV
    process.env.BOOKING_PUBLIC_URL = 'https://mediumia.fr/'
    assert.equal(accountSpaceUrl(), 'https://mediumia.fr/mon-espace')
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_BRANCH_URL = 'test-branche.vercel.app'
    assert.equal(accountSpaceUrl(), 'https://test-branche.vercel.app/mon-espace')
  } finally {
    for (const key of ['VERCEL_ENV', 'VERCEL_BRANCH_URL', 'BOOKING_PUBLIC_URL']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]
    }
  }
  const block = accountSpaceEmailBlock('https://mediumia.fr/mon-espace')
  assert.match(block.html, /href="https:\/\/mediumia\.fr\/mon-espace"/)
  assert.ok(block.text.includes('https://mediumia.fr/mon-espace'))
  assert.deepEqual(accountSpaceEmailBlock(null), { html: '', text: [] })
  for (const file of ['lib/rdvDepositConfirmationEmail.js', 'lib/rdvAppointmentReminders.js', 'api/rdv-book.js']) {
    assert.match(read(file), /accountSpaceEmailBlock/, file)
  }
})

test('formulaire : canal et téléphone obligatoires à distance seulement', () => {
  assert.equal(validPhone('06 12 34 56 78'), true)
  assert.equal(validPhone('0612'), false)
  assert.equal(validPhone(''), false)
  const form = read('src/components/rdv/RdvPublic.jsx')
  assert.match(form, /isVideo && !form\.videoChannel/)
  assert.match(form, /isVideo && !validPhone\(form\.phone\)/)
  assert.match(form, /isVideo=\{selectedModality === 'video'\}/)
  assert.match(form, /videoChannel: contactForm\.videoChannel \|\| null/)
})

test('compte : proposé, jamais imposé ni créé avant le paiement', () => {
  const form = read('src/components/rdv/RdvPublic.jsx')
  const choices = read('src/components/rdv/RdvContactChoices.jsx')
  const invite = read('src/components/account/AccountInvite.jsx')
  assert.match(choices, /Créer mon espace MediumIA gratuitement/)
  assert.match(choices, /Continuer sans créer de compte/)
  assert.match(choices, /Déjà un espace \? Se connecter/)
  // Le choix n'est pas une condition de validation et ne déclenche rien.
  assert.ok(form.indexOf('function validate() {') > form.indexOf('function ContactForm('))
  assert.equal(/wantsAccount/.test(form.slice(form.indexOf('function validate() {'), form.indexOf('return e', form.indexOf('function validate() {')))), false)
  assert.equal(/sendEmailCode|signInWithOtp|signUp/.test(choices), false)
  assert.equal(/sendEmailCode|signInWithOtp|signUp/.test(form), false)
  // Personne connectée : pas d'invitation.
  assert.match(form, /accountEmail\s*\n?\s*\? <SignedInNotice/)
  // Après confirmation : envoi du code uniquement sur un clic.
  assert.match(invite, /onClick=\{send\}/)
  assert.match(invite, /createAccount: true/)
  assert.equal(/useEffect/.test(invite), false)
  assert.equal(/meet\.google|zoom|teams\.microsoft/i.test(choices + invite), false)
})

test('repères des scripts de build préservés', () => {
  const deposit = read('lib/rdvDepositApiHandler.js')
  assert.ok(deposit.includes('`Arrhes réglées : ${(booking.reservation_payment_cents / 100).toFixed(2)} EUR`,'))
  assert.ok(deposit.includes('balanceReminderEnabled: Array.isArray(service.modality)'))
  assert.match(read('src/components/rdv/RdvPublic.jsx'), /function CalendarGrid/)
})
