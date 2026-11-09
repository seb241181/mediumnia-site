/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fakeConferenceDb, OLD_CHECKOUT } from './helpers/conferencePassFakeDb.js'

// Garde-fous anti double encaissement du Pass, sans aucun appel PayPal réel :
// libération après 404 sous conditions, clés de capture, refus, encaissement tracé
// avant l'activation, état réel chez PayPal, deux onglets, jeton du Pass conservé.

process.env.PAYPAL_ENV = 'sandbox'
process.env.PAYPAL_CLIENT_ID = 'test-client'
process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
delete process.env.VERCEL_ENV

const { handleConferencePassPayPal, captureRequestId } = await import('../lib/conferencePassPayPal.js')
const { takePassToken, forgetPassToken } = await import('../src/lib/conferencePassToken.js')

const OLD = 'OLDORDER12345678A'
const TOKEN = 'p'.repeat(43)
const PASS = {
  id: '11111111-1111-4111-8111-111111111111', event_id: 'e', registration_id: 'r', status: 'reserved', paypal_order_id: OLD,
  paypal_capture_id: null, paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR', reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX',
  redeemed_at: null, expires_at: '2099-01-01T00:00:00Z', reserved_at: OLD_CHECKOUT, terms_version: 'v',
  terms_accepted_at: '2026-11-01T12:20:06Z', immediate_access_accepted_at: '2026-11-01T12:20:06Z', user_id: null, entitlement_id: null,
}
const NOT_FOUND = { name: 'RESOURCE_NOT_FOUND', debug_id: 'dbg', details: [{ issue: 'INVALID_RESOURCE_ID' }] }

function fakeRes() {
  return { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

// PayPal simulé : une même PayPal-Request-Id renvoie toujours la même commande.
function fakePaypal({ orders = {}, capture } = {}) {
  const calls = []
  const byRequestId = new Map()
  const handler = async (url, init = {}) => {
    const u = String(url)
    const headers = init.headers || {}
    calls.push({ url: u, method: init.method || 'GET', requestId: headers['PayPal-Request-Id'] })
    if (u.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    const one = u.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)$/)
    if (one) {
      const order = orders[one[1]]
      if (!order) return new Response(JSON.stringify(NOT_FOUND), { status: 404 })
      return new Response(JSON.stringify(order), { status: 200 })
    }
    if (u.endsWith('/v2/checkout/orders') && init.method === 'POST') {
      const key = headers['PayPal-Request-Id']
      if (!byRequestId.has(key)) byRequestId.set(key, `NEWORDER${byRequestId.size + 1}`.padEnd(17, 'X'))
      return new Response(JSON.stringify({ id: byRequestId.get(key), status: 'CREATED' }), { status: 201 })
    }
    if (u.endsWith('/capture')) {
      if (capture === 'network') throw new TypeError('fetch failed')
      return new Response(JSON.stringify(capture.body), { status: capture.status })
    }
    throw new Error(`réseau interdit : ${u}`)
  }
  return { calls, handler, created: () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders')) }
}

async function call(action, { db, paypal, body = {}, query = {}, method = 'POST' }) {
  const realFetch = globalThis.fetch
  const realError = console.error
  const logs = []
  console.error = (...a) => logs.push(a.join(' '))
  globalThis.fetch = paypal.handler
  try {
    const res = fakeRes()
    await handleConferencePassPayPal({ method, body, query }, res, action, { supabase: db })
    return { res, logs }
  } finally {
    globalThis.fetch = realFetch
    console.error = realError
  }
}
const create = (db, paypal) => call('create', { db, paypal, body: { passToken: TOKEN, termsAccepted: true, immediateAccessAccepted: true } })
const released = (db) => db.calls.some((c) => c.rpc === 'release_conference_pass_checkout')

// ------------------------------------------------ libération après 404 : jamais sur un simple doute

test('404 sur une commande ancienne, sans trace d’encaissement : Pass libéré, une nouvelle commande', async () => {
  const db = fakeConferenceDb({ pass: PASS })
  const paypal = fakePaypal()
  const { res } = await create(db, paypal)
  assert.equal(res.statusCode, 201)
  assert.ok(released(db))
  assert.equal(paypal.created().length, 1)
})

test('404 mais commande récente (< 6 h) : vérification demandée, rien libéré ni créé', async () => {
  const db = fakeConferenceDb({ pass: PASS, checkoutStartedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() })
  const paypal = fakePaypal()
  const { res } = await create(db, paypal)
  assert.deepEqual([res.statusCode, res.body.error], [409, 'paypal_order_verification_required'])
  assert.ok(!released(db))
  assert.equal(paypal.created().length, 0)
})

test('404 mais encaissement tracé, achat enregistré, lecture impossible ou date inconnue : toujours bloqué', async () => {
  const cases = [
    { paymentRecordedFor: [OLD] },
    { purchasesFor: [OLD] },
    { failEvidence: true },
    { checkoutStartedAt: null, pass: { ...PASS, reserved_at: null } },
  ]
  for (const options of cases) {
    const db = fakeConferenceDb({ pass: PASS, ...options })
    const paypal = fakePaypal()
    const { res } = await create(db, paypal)
    assert.equal(res.body.error, 'paypal_order_verification_required', JSON.stringify(options))
    assert.ok(!released(db))
    assert.equal(paypal.created().length, 0)
  }
})

test('deux onglets sur le même Pass bloqué : même clé d’idempotence, une seule commande', async () => {
  const db = fakeConferenceDb({ pass: PASS })
  const paypal = fakePaypal()
  const [a, b] = await Promise.all([create(db, paypal), create(db, paypal)])
  const ids = new Set([a.res.body.id, b.res.body.id].filter(Boolean))
  assert.equal(ids.size, 1, `une seule commande retenue : ${JSON.stringify([a.res.body, b.res.body])}`)
  assert.equal(new Set(paypal.created().map((c) => c.requestId)).size, 1, 'même PayPal-Request-Id')
  assert.equal(db.state.pass.paypal_order_id, [...ids][0])
})

// ------------------------------------------------ capture : clés, refus, incertitude, trace avant activation

const APPROVED = { id: OLD, status: 'APPROVED', create_time: '2026-11-09T10:00:00Z', update_time: '2026-11-09T10:01:00Z', purchase_units: [{ reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX' }] }
const COMPLETED = { ...APPROVED, status: 'COMPLETED', purchase_units: [{ reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' } }] } }] }

test('clé de capture : identique tant que l’approbation est la même, nouvelle seulement après réapprobation', () => {
  assert.equal(captureRequestId(APPROVED), captureRequestId({ ...APPROVED }))
  assert.notEqual(captureRequestId(APPROVED), captureRequestId({ ...APPROVED, update_time: '2026-11-09T10:05:00Z' }))
  assert.ok(captureRequestId(APPROVED).length <= 108)
})

test('refus du moyen de paiement à l’encaissement : erreur dédiée, aucun accès, aucune trace d’encaissement', async () => {
  const db = fakeConferenceDb({ pass: PASS })
  const paypal = fakePaypal({ orders: { [OLD]: APPROVED }, capture: { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] } } })
  const { res } = await call('capture', { db, paypal, body: { orderId: OLD } })
  assert.deepEqual([res.statusCode, res.body.error], [422, 'paypal_instrument_declined'])
  assert.equal(db.events.filter((e) => e.event_name === 'payment_completed').length, 0)
  assert.ok(!db.calls.some((c) => c.rpc === 'mediumia_grant_purchase_atomic' || c.rpc === 'redeem_conference_pass_after_payment'))
})

test('capture au résultat incertain (réseau, 5xx) : erreur prudente ; nouvel essai sous la même clé', async () => {
  for (const capture of ['network', { status: 503, body: { name: 'SERVICE_UNAVAILABLE' } }]) {
    const db = fakeConferenceDb({ pass: PASS })
    const paypal = fakePaypal({ orders: { [OLD]: APPROVED }, capture })
    const first = await call('capture', { db, paypal, body: { orderId: OLD } })
    assert.equal(first.res.body.error, 'paypal_capture_uncertain')
    const again = await call('capture', { db, paypal, body: { orderId: OLD } })
    assert.equal(again.res.body.error, 'paypal_capture_uncertain')
    const keys = paypal.calls.filter((c) => c.url.endsWith('/capture')).map((c) => c.requestId)
    assert.equal(keys.length, 2)
    assert.equal(new Set(keys).size, 1, 'jamais de nouvelle clé sans nouvelle approbation')
  }
})

test('encaissement réussi : tracé avant l’activation, même si la validation ou l’activation échoue ensuite', async () => {
  const db = fakeConferenceDb({ pass: PASS })
  const paypal = fakePaypal({ orders: { [OLD]: COMPLETED } })
  const { res } = await call('capture', { db, paypal, body: { orderId: OLD } })
  assert.ok(res.body.error, 'activation simulée en échec (inscription absente)')
  const trace = db.events.find((e) => e.event_name === 'payment_completed')
  assert.deepEqual(trace?.metadata, { stage: 'captured', orderId: OLD, captureId: 'CAP1' })
  // Plus jamais de libération ni de nouvelle commande pour ce Pass, même si PayPal répondait 404.
  const blocked = await create(db, fakePaypal())
  assert.equal(blocked.res.body.error, 'paypal_order_verification_required')
  assert.ok(!released(db))
})

test('état du paiement : lu chez PayPal, pas seulement dans notre base', async () => {
  const paid = await call('status', { db: fakeConferenceDb({ pass: PASS }), paypal: fakePaypal({ orders: { [OLD]: COMPLETED } }), query: { orderId: OLD }, method: 'GET' })
  assert.equal(paid.res.body.paypalStatus, 'COMPLETED')
  assert.equal(paid.res.body.captured, false, 'notre base ne le sait pas encore')
  const recorded = await call('status', { db: fakeConferenceDb({ pass: PASS, paymentRecordedFor: [OLD] }), paypal: fakePaypal({ orders: { [OLD]: APPROVED } }), query: { orderId: OLD }, method: 'GET' })
  assert.deepEqual([recorded.res.body.paypalStatus, recorded.res.body.paymentRecorded], ['APPROVED', true])
  const gone = await call('status', { db: fakeConferenceDb({ pass: PASS }), paypal: fakePaypal(), query: { orderId: OLD }, method: 'GET' })
  assert.equal(gone.res.body.paypalStatus, 'NOT_FOUND')
})

// ------------------------------------------------ jeton du Pass conservé dans l'onglet

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}

test('jeton du Pass : retiré de l’adresse, conservé dans l’onglet, retrouvé après annulation ou rechargement', () => {
  const storage = memoryStorage()
  const replaced = []
  const history = { replaceState: (_s, _t, url) => replaced.push(url) }
  const path = '/pass/mediumia/conference-22-octobre'
  const now = Date.parse('2026-11-09T10:00:00Z')
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: `#pass=${TOKEN}` }, history, storage, now }), TOKEN)
  assert.deepEqual(replaced, [path], 'fragment retiré de l’adresse')
  assert.ok(![...storage.m.values()].join('').includes('#'), 'aucune adresse complète stockée')
  // Rechargement, retour de PayPal, double exécution d'un effet React : adresse sans fragment.
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: '' }, history, storage, now: now + 3_600_000 }), TOKEN)
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: '' }, history, storage, now: now + 3_600_000 }), TOKEN)
  // Autre page de Pass : jamais le jeton d'une autre conférence.
  assert.equal(takePassToken({ location: { pathname: '/pass/mediumia/autre', search: '', hash: '' }, history, storage, now }), '')
  // Pass payé / utilisé / expiré : oublié.
  forgetPassToken({ location: { pathname: path }, storage })
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: '' }, history, storage, now }), '')
})

test('jeton du Pass : périmé, invalide ou stockage indisponible -> comme sans jeton, sans erreur', () => {
  const storage = memoryStorage()
  const path = '/pass/mediumia/x'
  takePassToken({ location: { pathname: path, search: '', hash: `#pass=${TOKEN}` }, history: { replaceState() {} }, storage, now: 0 })
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: '' }, history: null, storage, now: 32 * 86_400_000 }), '', 'plus d’un mois : oublié')
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: '#pass=<script>' }, history: { replaceState() {} }, storage, now: 0 }), '')
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  assert.equal(takePassToken({ location: { pathname: path, search: '', hash: `#pass=${TOKEN}` }, history: { replaceState() {} }, storage: broken, now: 0 }), TOKEN, 'navigation privée : jeton du lien utilisable')
  assert.doesNotThrow(() => forgetPassToken({ location: { pathname: path }, storage: broken }))
})

test('page : Sandbox seulement pour le pays acheteur forcé ; jeton jamais relu depuis l’adresse seule', () => {
  const page = fs.readFileSync(new URL('../src/components/ConferencePassPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /const sandboxCountry = env === 'sandbox' \? '&buyer-country=FR' : ''/)
  assert.doesNotMatch(page, /function readPassToken/)
  assert.match(page, /const token = takePassToken\(\)/)
  assert.match(page, /forgetPassToken\(\)\s*setState\(result\.alreadyProvisioned/)
  assert.match(page, /if \(code === 'expired' \|\| code === 'already_redeemed'\) forgetPassToken\(\)/)
})
