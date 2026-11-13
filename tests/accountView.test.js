import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bookingCalendarLinks,
  describeAmounts,
  describeMode,
  describePayment,
  describeStatus,
  emailCodeErrorMessage,
  formatBookingDate,
  formatBookingTime,
  formatEuros,
  isUnknownAccountError,
  listAllPayments,
} from '../src/lib/accountView.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const NOW = new Date('2026-11-11T10:00:00Z')

const booking = (overrides = {}) => ({
  id: 'b1',
  startsAt: '2026-12-01T09:00:00.000Z',
  endsAt: '2026-12-01T10:00:00.000Z',
  timezone: 'Europe/Paris',
  status: 'confirmed',
  serviceTitle: 'Guidance',
  durationMin: 60,
  practitionerName: 'Sébastien Seguin',
  mode: 'video',
  videoChannel: 'whatsapp',
  contact: { firstName: 'Alice', lastName: 'Martin', phone: '+33600000001' },
  amounts: { priceCents: 9000, depositPaidCents: 3000, balancePaidCents: 0, fullPaymentCents: 0, refundedCents: 0, paidCents: 3000, dueCents: 6000, paymentPending: false },
  payments: [{ kind: 'arrhes', direction: 'income', method: 'paypal', occurredAt: '2026-11-02T08:00:00Z', amountCents: 3000 }],
  cancellation: null,
  ...overrides,
})

test('dates et montants en français, heure de Paris', () => {
  assert.equal(formatBookingDate('2026-12-01T09:00:00.000Z'), 'Mardi 1 décembre 2026')
  assert.equal(formatBookingTime('2026-12-01T09:00:00.000Z'), '10 h 00')
  assert.equal(formatEuros(9000), '90 €')
  assert.equal(formatEuros(4550), '45,50 €')
  assert.equal(formatEuros(null), '—')
})

test('à distance : WhatsApp ou FaceTime, avec le numéro donné à la réservation', () => {
  const whatsapp = describeMode(booking())
  assert.equal(whatsapp.label, 'À distance — WhatsApp')
  assert.equal(whatsapp.note, 'Le jour de votre rendez-vous, Sébastien vous contactera directement via WhatsApp, au +33600000001.')
  assert.equal(describeMode(booking({ videoChannel: 'facetime' })).label, 'À distance — FaceTime')
})

test('canal ou mode inconnu : information neutre, rien d’inventé', () => {
  const unknownChannel = describeMode(booking({ videoChannel: null, contact: {} }))
  assert.equal(unknownChannel.label, 'À distance')
  assert.equal(unknownChannel.note, 'Le jour de votre rendez-vous, Sébastien vous contactera directement via WhatsApp ou FaceTime.')
  assert.deepEqual(describeMode(booking({ mode: 'in-person' })), { label: 'En présence', note: null })
  assert.deepEqual(describeMode(booking({ mode: null, videoChannel: null })), { label: 'Mode de consultation non enregistré', note: null })
})

test('aucun lien de visioconférence nulle part', () => {
  const sources = [read('src/lib/accountView.js'), read('src/components/account/AccountPage.jsx')].join('\n')
  assert.equal(/meet\.google|google_meet|zoom|teams\.microsoft/i.test(sources), false)
  const links = bookingCalendarLinks(booking(), NOW)
  assert.equal(/meet|zoom/i.test(decodeURIComponent(links.ics) + decodeURIComponent(links.google)), false)
})

test('arrhes encaissées, reste à régler et message selon le mode', () => {
  const video = describeAmounts(booking())
  assert.deepEqual(video.lines.map((l) => [l.key, l.value]), [['price', '90 €'], ['deposit', '30 €'], ['due', '60 €']])
  assert.match(video.note, /lien sécurisé/)
  assert.match(describeAmounts(booking({ mode: 'in-person' })).note, /le jour du rendez-vous/)
  const settled = describeAmounts(booking({ amounts: { ...booking().amounts, balancePaidCents: 6000, paidCents: 9000, dueCents: 0 } }))
  assert.deepEqual(settled.lines.map((l) => l.key), ['price', 'deposit', 'balance', 'due'])
  assert.match(settled.note, /entièrement réglée/)
})

test('paiement PayPal en attente : jamais présenté comme encaissé', () => {
  const pending = describeAmounts(booking({ amounts: { ...booking().amounts, depositPaidCents: 0, paidCents: 0, dueCents: 9000, paymentPending: true }, payments: [] }))
  assert.match(pending.note, /pas encore encaissé/)
  assert.deepEqual(pending.lines.map((l) => [l.key, l.value]), [['price', '90 €'], ['due', '90 €']])
  assert.equal(pending.lines.some((l) => /encaiss|réglé/i.test(l.label) && l.key !== 'due'), false)
})

test('rendez-vous annulé ou ancien : pas de reste dû, prix inconnu signalé', () => {
  const cancelled = booking({ status: 'cancelled', cancellation: { at: '2026-11-05T08:00:00Z', origin: 'client' }, amounts: { ...booking().amounts, refundedCents: 3000, paidCents: 0, dueCents: null } })
  assert.deepEqual(describeAmounts(cancelled).lines.map((l) => l.key), ['price', 'deposit', 'refund'])
  assert.equal(describeStatus(cancelled, NOW).label, 'Annulé')
  assert.match(describeStatus(cancelled, NOW).detail, /par vos soins le 5 novembre 2026/)
  assert.match(describeStatus(booking({ status: 'cancelled', cancellation: { at: null, origin: 'unpaid_balance' } }), NOW).detail, /solde/)
  const old = describeAmounts(booking({ amounts: { ...booking().amounts, priceCents: null, depositPaidCents: 0, dueCents: null } }))
  assert.deepEqual(old.lines, [{ key: 'price', label: 'Prix de la prestation', value: 'Non enregistré' }])
  assert.equal(describeStatus(booking(), NOW).label, 'Confirmé')
  assert.equal(describeStatus(booking({ startsAt: '2026-10-01T09:00:00Z', endsAt: '2026-10-01T10:00:00Z' }), NOW).label, 'Terminé')
})

test('règlements : moyen de paiement réel, remboursements, ordre récent d’abord', () => {
  assert.deepEqual(describePayment({ kind: 'balance', direction: 'income', method: 'transfer', occurredAt: '2026-11-03T08:00:00Z', amountCents: 6000 }),
    { label: 'Solde', method: 'Virement', date: '3 novembre 2026', amount: '60 €', refund: false })
  assert.equal(describePayment({ kind: 'refund', direction: 'refund', method: 'paypal', amountCents: 3000 }).amount, '− 30 €')
  assert.equal(describePayment({ kind: 'arrhes', direction: 'income', method: 'other', amountCents: 3000 }).method, null)
  assert.equal(describePayment({ kind: 'full_payment', direction: 'income', method: 'gift_card', amountCents: 9000 }).method, 'Carte cadeau')
  const all = listAllPayments({
    upcoming: [booking()],
    past: [booking({ id: 'b0', payments: [{ kind: 'full_payment', direction: 'income', method: 'cash', occurredAt: '2026-09-01T08:00:00Z', amountCents: 9000 }] })],
  })
  assert.deepEqual(all.map((p) => p.label), ['Arrhes', 'Règlement intégral'])
  assert.deepEqual(listAllPayments({}), [])
})

test('ajout au calendrier : horaires exacts et rappel de l’espace client', () => {
  const links = bookingCalendarLinks(booking(), NOW)
  const ics = decodeURIComponent(links.ics)
  assert.match(ics, /DTSTART:20261201T090000Z/)
  assert.match(ics, /DTEND:20261201T100000Z/)
  assert.match(ics, /UID:b1@mediumia\.fr/)
  assert.match(ics, /WhatsApp/)
  assert.match(links.google, /dates=20261201T090000Z%2F20261201T100000Z/)
  assert.equal(bookingCalendarLinks({ startsAt: 'n/a' }), null)
})

test('connexion par code : messages clairs, existence du compte non révélée', () => {
  assert.match(emailCodeErrorMessage(new Error('Token has expired or is invalid')), /pas valable ou a expiré/)
  assert.match(emailCodeErrorMessage(new Error('For security purposes, you can only request this after 50 seconds')), /Patientez/)
  assert.equal(isUnknownAccountError(new Error('Signups not allowed for otp')), true)
  assert.equal(isUnknownAccountError(new Error('rate limit')), false)
  const page = read('src/components/account/AccountPage.jsx')
  assert.match(page, /isUnknownAccountError\(sendError\)/)
  assert.match(page, /Si un espace MediumIA correspond à/)
})

test('la page est branchée, sans création automatique de compte', () => {
  const auth = read('src/lib/useAuth.js')
  assert.match(auth, /shouldCreateUser: createAccount/)
  assert.match(auth, /createAccount = false/)
  const page = read('src/components/account/AccountPage.jsx')
  assert.match(page, /requestCode\(false\)/)
  assert.match(page, /Créer mon espace MediumIA gratuitement/)
  assert.match(page, /accountAction=overview/)
  assert.match(page, /Authorization: `Bearer \$\{token\}`/)
  assert.match(read('src/main.jsx'), /pathname === '\/mon-espace'/)
  assert.ok(JSON.parse(read('vercel.json')).rewrites.some((rule) => rule.source === '/mon-espace' && rule.destination === '/index.html'))
  assert.match(read('src/components/GlobalAccount.jsx'), /pathname\.startsWith\('\/mon-espace'\)/)
})
