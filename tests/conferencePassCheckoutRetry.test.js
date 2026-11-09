/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Refus, annulation et reprise du paiement du Pass, sans aucun appel PayPal réel :
// - côté navigateur : boutons réaffichés après un échec, mais jamais avant réconciliation ;
// - côté serveur : aucune capture sans approbation, jamais de seconde capture ;
// - parcours Live à 499 € simulé (API PayPal Live interceptée, aucun appel réseau).

process.env.PAYPAL_CLIENT_ID = 'test-client'
process.env.PAYPAL_CLIENT_SECRET = 'test-secret'

const { needsButtonsRender, reconcileApprovedOrder } = await import('../src/lib/conferencePassCheckout.js')
const { handleConferencePassPayPal } = await import('../lib/conferencePassPayPal.js')
const page = fs.readFileSync(new URL('../src/components/ConferencePassPage.jsx', import.meta.url), 'utf8')

import { fakeConferenceDb } from './helpers/conferencePassFakeDb.js'

const ORDER = 'ORDERAPPROVED1234'
const NEW = 'NEWORDER12345678B'

function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })
}

function fakeSupabase(options = {}) {
  return fakeConferenceDb(options)
}

function fakeRes() {
  return { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

async function callApi(action, { body = {}, query = {}, supabase, paypal }) {
  const calls = []
  const realFetch = globalThis.fetch
  const realError = console.error
  console.error = () => {}
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method || 'GET', body: String(init.body || '').startsWith('{') ? JSON.parse(init.body) : null })
    if (/api-m\.(sandbox\.)?paypal\.com\/v1\/oauth2\/token$/.test(u)) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    const order = u.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)$/)
    if (order && paypal.orders?.[order[1]]) return new Response(JSON.stringify(paypal.orders[order[1]]), { status: 200 })
    if (/\/v2\/checkout\/orders$/.test(u) && init.method === 'POST') return new Response(JSON.stringify({ id: NEW, status: 'CREATED' }), { status: 201 })
    if (/\/capture$/.test(u)) return new Response(JSON.stringify(paypal.capture || { name: 'UNEXPECTED' }), { status: paypal.capture ? 201 : 500 })
    throw new Error(`réseau interdit dans ce test : ${u}`)
  }
  try {
    const res = fakeRes()
    await handleConferencePassPayPal({ method: action === 'status' ? 'GET' : 'POST', body, query }, res, action, { supabase })
    return { res, paypal: calls }
  } finally {
    globalThis.fetch = realFetch
    console.error = realError
  }
}

const SANDBOX_PASS = {
  id: '11111111-1111-4111-8111-111111111111', event_id: 'e', registration_id: 'r', status: 'reserved', paypal_order_id: ORDER,
  paypal_capture_id: null, paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR', reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX',
  redeemed_at: null, expires_at: '2099-01-01T00:00:00Z', terms_version: 'v', terms_accepted_at: '2026-11-08T20:00:00Z',
  immediate_access_accepted_at: '2026-11-08T20:00:00Z', user_id: null, entitlement_id: null,
}
const captures = (calls) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/capture'))

// ---------------------------------------------------------------- navigateur

test('boutons PayPal : réaffichés quand le conteneur est remonté ou après une erreur, pas en double', () => {
  const container = {}
  const first = { token: 'pass', container, attempt: 0 }
  assert.equal(needsButtonsRender(null, first), true)
  assert.equal(needsButtonsRender(first, { ...first }), false, 'même conteneur, même essai : pas de second rendu')
  assert.equal(needsButtonsRender(first, { ...first, container: {} }), true, 'retour à « valid » après un échec : conteneur neuf')
  assert.equal(needsButtonsRender(first, { ...first, attempt: 1 }), true, 'erreur PayPal alors que l’état était déjà « valid »')
  assert.equal(needsButtonsRender(first, { ...first, container: null }), false)
})

test('réconciliation après approbation : payée -> succès, sans relecture d’état', async () => {
  let statusCalls = 0
  const r = await reconcileApprovedOrder(ORDER, { capture: async () => ({ access: { status: 'provisioned' } }), status: async () => { statusCalls += 1 } })
  assert.equal(r.outcome, 'paid')
  assert.equal(statusCalls, 0)
})

test('réconciliation : capture incertaine -> jamais de boutons tant qu’un paiement est possible', async () => {
  const failing = async () => { throw new Error('paypal_capture_failed') }
  assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ captured: true, redeemed: false }) })).outcome, 'uncertain', 'capture enregistrée sans accès')
  assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => { throw new Error('offline') } })).outcome, 'uncertain', 'serveur injoignable')
  assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ passStatus: 'redeemed' }) })).outcome, 'uncertain')
  assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ passStatus: 'reserved', captured: false, redeemed: false }) })).outcome, 'uncertain', 'état PayPal absent : vérification')
  for (const paypalStatus of ['COMPLETED', 'APPROVED', 'UNKNOWN']) {
    assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ passStatus: 'reserved', paypalStatus }) })).outcome, 'uncertain', `PayPal ${paypalStatus} : jamais de bouton`)
  }
  assert.equal((await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ passStatus: 'reserved', paypalStatus: 'CREATED', paymentRecorded: true }) })).outcome, 'uncertain', 'encaissement enregistré chez nous')
  for (const paypalStatus of ['CREATED', 'PAYER_ACTION_REQUIRED', 'VOIDED', 'NOT_FOUND']) {
    const retry = await reconcileApprovedOrder(ORDER, { capture: failing, status: async () => ({ passStatus: 'reserved', captured: false, redeemed: false, paymentRecorded: false, paypalStatus }) })
    assert.equal(retry.outcome, 'retry', `PayPal ${paypalStatus} et rien chez nous : nouvel essai, revérifié par le serveur`)
  }
  let attempts = 0
  await reconcileApprovedOrder(ORDER, { capture: async () => { attempts += 1; throw new Error('x') }, status: async () => ({}) })
  assert.equal(attempts, 1, 'une seule confirmation par réconciliation')
})

test('page : la confirmation échouée passe par la réconciliation, jamais directement aux boutons', () => {
  assert.match(page, /onApprove: async \(data, actions\) => \{\s*setState\('payment'\)\s*try \{\s*await captureExistingOrder\(data\.orderID\)\s*\} catch \(err\) \{/)
  assert.match(page, /err\?\.message === 'paypal_instrument_declined' && actions\?\.restart[\s\S]{0,80}return actions\.restart\(\)[\s\S]{0,40}\}\s*await settleApprovedOrder\(data\.orderID/)
  assert.match(page, /if \(data\.completed\) \{[\s\S]{0,140}captureExistingOrder\(data\.id\)\.catch\(\(\) => settleApprovedOrder\(data\.id/, 'commande déjà payée : vérification si l’activation échoue')
  assert.match(page, /err\?\.message === 'paypal_order_verification_required'[\s\S]{0,80}setState\('verification_required'\)/)
  assert.match(page, /if \(!needsButtonsRender\(renderedRef\.current, target\)\) return/)
  assert.match(page, /\[state, config, passToken, consentsOk, attempt\]/)
  assert.match(page, /onError: \(err\) => \{[\s\S]{0,600}setAttempt\(\(value\) => value \+ 1\)/)
  assert.equal(page.match(/ref=\{paypalRef\}/g).length, 1, 'un seul conteneur PayPal')
  const validBlock = page.slice(page.indexOf("{['valid', 'payment'].includes(visibleState) && ("))
  assert.match(page, /className=\{visibleState === 'payment' \? 'hidden' : ''\}/, 'conteneur PayPal masqué mais monté pendant la confirmation')
  assert.ok(validBlock.includes('ref={paypalRef}'), 'conteneur PayPal uniquement dans l’état « valid »')
  const uncertain = page.slice(page.indexOf("{visibleState === 'uncertain' && ("), page.indexOf("{['success', 'already_provisioned']"))
  assert.ok(!uncertain.includes('paypalRef') && uncertain.includes('Vérifier mon paiement'))
  assert.match(page, /Ne payez pas une seconde fois/)
})

// ---------------------------------------------------------------- serveur

test('annulation ou refus Pay Later avant approbation : aucune capture, aucun accès, Pass intact', async () => {
  const supabase = fakeSupabase({ pass: SANDBOX_PASS })
  const { res, paypal } = await withEnv({ PAYPAL_ENV: 'sandbox', VERCEL_ENV: undefined }, () =>
    callApi('capture', { body: { orderId: ORDER }, supabase, paypal: { orders: { [ORDER]: { id: ORDER, status: 'CREATED' } } } }))
  assert.equal(res.body.error, 'paypal_order_not_approved')
  assert.equal(captures(paypal).length, 0)
  assert.ok(!supabase.calls.some((c) => ['redeem_conference_pass_after_payment', 'release_conference_pass_checkout'].includes(c.rpc)))
  assert.ok(!supabase.calls.some((c) => c.from === 'mediumia_entitlements'), 'aucun droit Formation touché')
})

test('reprise après réponse perdue : commande déjà COMPLETED chez PayPal -> jamais recapturée', async () => {
  const completed = { id: ORDER, status: 'COMPLETED', purchase_units: [{ reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' } }] } }] }
  const supabase = fakeSupabase({ pass: SANDBOX_PASS })
  const { paypal } = await withEnv({ PAYPAL_ENV: 'sandbox', VERCEL_ENV: undefined }, () =>
    callApi('capture', { body: { orderId: ORDER }, supabase, paypal: { orders: { [ORDER]: completed } } }))
  assert.equal(captures(paypal).length, 0, 'aucune seconde capture')
  assert.ok(paypal.some((c) => c.method === 'GET' && c.url.endsWith(`/orders/${ORDER}`)), 'la commande est relue chez PayPal')
})

test('reprise d’un Pass déjà payé et activé : réponse idempotente, aucun appel PayPal', async () => {
  const supabase = fakeSupabase({ pass: { ...SANDBOX_PASS, status: 'redeemed', paypal_capture_id: 'CAP1', redeemed_at: '2026-11-08T21:00:00Z' } })
  const { res, paypal } = await withEnv({ PAYPAL_ENV: 'sandbox', VERCEL_ENV: undefined }, () =>
    callApi('capture', { body: { orderId: ORDER }, supabase, paypal: {} }))
  assert.deepEqual(res.body, { status: 'COMPLETED', alreadyProvisioned: true, access: { status: 'provisioned' } })
  assert.equal(paypal.filter((c) => c.url.includes('paypal.com')).length, 0)
})

test('nouvel essai après échec : une commande encore payée est rapprochée au lieu d’en créer une autre', async () => {
  const supabase = fakeSupabase({ pass: SANDBOX_PASS, validate: { ok: true, offerEnabled: true, offerAmountCents: 49900 } })
  const { res, paypal } = await withEnv({ PAYPAL_ENV: 'sandbox', VERCEL_ENV: undefined }, () =>
    callApi('create', { body: { passToken: 'p'.repeat(43), termsAccepted: true, immediateAccessAccepted: true }, supabase, paypal: { orders: { [ORDER]: { id: ORDER, status: 'COMPLETED' } } } }))
  assert.deepEqual(res.body, { id: ORDER, env: 'sandbox', completed: true })
  assert.equal(paypal.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders')).length, 0)
})

test('parcours Live simulé à 499 € : montant, devise, référence et environnement exacts', async () => {
  const supabase = fakeSupabase({
    pass: { ...SANDBOX_PASS, status: 'opened', paypal_order_id: null, paypal_env: null, amount_cents: null, reference_id: null },
    validate: { ok: true, offerEnabled: true, offerAmountCents: 49900 },
  })
  const { res, paypal } = await withEnv({ VERCEL_ENV: 'production', PAYPAL_ENV: 'live', PAYPAL_CONFERENCE_PASS_ENABLED: 'true' }, () =>
    callApi('create', { body: { passToken: 'p'.repeat(43), termsAccepted: true, immediateAccessAccepted: true }, supabase, paypal: {} }))
  assert.equal(res.statusCode, 201, JSON.stringify(res.body))
  assert.deepEqual(res.body, { id: NEW, env: 'live', reused: false })
  const order = paypal.find((c) => c.method === 'POST' && c.url === 'https://api-m.paypal.com/v2/checkout/orders')
  assert.ok(order, 'commande adressée à l’API Live (interceptée)')
  assert.equal(order.body.intent, 'CAPTURE')
  assert.deepEqual(order.body.purchase_units[0].amount, { currency_code: 'EUR', value: '499.00' })
  assert.equal(order.body.purchase_units[0].reference_id, 'MEDIUMIA_CONFERENCE_PASS')
  const reserve = supabase.calls.find((c) => c.rpc === 'reserve_conference_pass_checkout').args
  assert.deepEqual([reserve.p_paypal_env, reserve.p_amount_cents, reserve.p_currency, reserve.p_reference_id], ['live', 49900, 'EUR', 'MEDIUMIA_CONFERENCE_PASS'])
  assert.ok(!paypal.some((c) => c.url.includes('sandbox')), 'aucun mélange Sandbox / Live')
})
