/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'

// Un Pass dont la première commande PayPal n'a jamais été payée restait bloqué :
// après expiration de la commande chez PayPal (404), chaque nouvel essai échouait
// avec paypal_order_fetch_failed. Le Pass doit être libéré et une nouvelle commande créée,
// sans jamais libérer quoi que ce soit si PayPal ne prouve pas l'absence de la commande.

process.env.PAYPAL_ENV = 'sandbox'
process.env.PAYPAL_CLIENT_ID = 'test-client'
process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
delete process.env.VERCEL_ENV

const { handleConferencePassPayPal, isExpiredPaypalOrder, describePaypalError } = await import('../lib/conferencePassPayPal.js')
import fs from 'node:fs'

import { fakeConferenceDb } from './helpers/conferencePassFakeDb.js'

const OLD = 'OLDORDER12345678A'
const NEW = 'NEWORDER12345678B'

function fakeSupabase(passOverrides = {}, dbOptions = {}) {
  return fakeConferenceDb({
    ...dbOptions,
    pass: {
      id: '11111111-1111-4111-8111-111111111111', event_id: 'e', registration_id: 'r', status: 'reserved',
      paypal_order_id: OLD, paypal_capture_id: null, paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR',
      reference_id: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX', redeemed_at: null, expires_at: '2099-01-01T00:00:00Z',
      reserved_at: '2026-11-01T12:20:06Z',
      terms_accepted_at: '2026-11-01T12:20:06Z', immediate_access_accepted_at: '2026-11-01T12:20:06Z', ...passOverrides,
    },
  })
}

function fakeRes() {
  return { statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

async function attempt({ lookup, passOverrides, db } = {}) {
  const supabase = fakeSupabase(passOverrides, db)
  const paypal = []
  const logs = []
  const realFetch = globalThis.fetch
  const realError = console.error
  console.error = (...args) => logs.push(args.join(' '))
  globalThis.fetch = async (url, init = {}) => {
    paypal.push({ url: String(url), method: init.method || 'GET', body: String(init.body || '').startsWith('{') ? JSON.parse(init.body) : null })
    if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    if (String(url).endsWith(`/v2/checkout/orders/${OLD}`)) {
      if (lookup.network) throw new TypeError('fetch failed')
      return new Response(JSON.stringify(lookup.body), { status: lookup.status })
    }
    if (String(url).endsWith('/v2/checkout/orders') && init.method === 'POST') return new Response(JSON.stringify({ id: NEW, status: 'CREATED' }), { status: 201 })
    throw new Error(`unexpected ${url}`)
  }
  try {
    const res = fakeRes()
    await handleConferencePassPayPal({ method: 'POST', body: { passToken: 'p'.repeat(43), termsAccepted: true, immediateAccessAccepted: true }, query: {} }, res, 'create', { supabase })
    return { res, supabase, paypal, logs }
  } finally {
    globalThis.fetch = realFetch
    console.error = realError
  }
}

const created = (paypal) => paypal.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders')).length

test('commande expirée chez PayPal (404) : Pass libéré puis nouvelle commande, paiement de nouveau possible', async () => {
  const { res, supabase, paypal } = await attempt({ lookup: { status: 404, body: { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] } } })
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.id, NEW)
  const release = supabase.calls.find((c) => c.rpc === 'release_conference_pass_checkout')
  assert.deepEqual(release.args, { p_paypal_order_id: OLD, p_reason: 'paypal_order_expired' })
  assert.equal(supabase.calls.find((c) => c.rpc === 'reserve_conference_pass_checkout').args.p_paypal_order_id, NEW)
  assert.equal(created(paypal), 1)
  assert.ok(!paypal.some((c) => c.url.includes('/capture')), 'aucune capture')
})

test('erreur PayPal autre que 404 (panne, droits) : rien n’est libéré ni recréé', async () => {
  for (const status of [500, 503, 401, 403, 429]) {
    const { res, supabase, paypal } = await attempt({ lookup: { status, body: { name: 'INTERNAL_SERVER_ERROR' } } })
    assert.equal(res.body.error, 'paypal_order_fetch_failed', `HTTP ${status}`)
    assert.ok(!supabase.calls.some((c) => c.rpc === 'release_conference_pass_checkout'))
    assert.equal(created(paypal), 0)
  }
})

test('404 sans preuve PayPal (réponse inattendue) : prudence, rien n’est libéré', async () => {
  const { res, supabase, paypal } = await attempt({ lookup: { status: 404, body: {} } })
  assert.equal(res.body.error, 'paypal_order_fetch_failed')
  assert.ok(!supabase.calls.some((c) => c.rpc === 'release_conference_pass_checkout'))
  assert.equal(created(paypal), 0)
})

test('comportements existants inchangés : commande payée réconciliée, commande encore valable réutilisée', async () => {
  const paid = await attempt({ lookup: { status: 200, body: { id: OLD, status: 'COMPLETED' } } })
  assert.deepEqual(paid.res.body, { id: OLD, env: 'sandbox', completed: true })
  assert.equal(created(paid.paypal), 0)
  const pending = await attempt({ lookup: { status: 200, body: { id: OLD, status: 'CREATED' } } })
  assert.deepEqual(pending.res.body, { id: OLD, env: 'sandbox', reused: true })
  assert.equal(created(pending.paypal), 0)
  const voided = await attempt({ lookup: { status: 200, body: { id: OLD, status: 'VOIDED' } } })
  assert.equal(voided.res.body.id, NEW)
  assert.equal(voided.supabase.calls.find((c) => c.rpc === 'release_conference_pass_checkout').args.p_reason, 'paypal_order_voided')
})

test('détection stricte de la commande expirée', () => {
  assert.equal(isExpiredPaypalOrder({ status: 404 }, { name: 'RESOURCE_NOT_FOUND' }), true)
  assert.equal(isExpiredPaypalOrder({ status: 404 }, { details: [{ issue: 'INVALID_RESOURCE_ID' }] }), true)
  assert.equal(isExpiredPaypalOrder({ status: 404 }, {}), false)
  assert.equal(isExpiredPaypalOrder({ status: 500 }, { name: 'RESOURCE_NOT_FOUND' }), false)
})

const PAYPAL_404 = { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.', debug_id: 'f1e2d3c4b5a69', details: [{ issue: 'INVALID_RESOURCE_ID', description: 'Specified resource ID does not exist. Please check the resource ID and try again.' }] }

test('la réponse exacte de PayPal est journalisée (code, nom, motif, debug_id), sans donnée personnelle', async () => {
  const expired = await attempt({ lookup: { status: 404, body: PAYPAL_404 } })
  assert.ok(expired.logs.some((l) => l.includes('order lookup HTTP 404 name=RESOURCE_NOT_FOUND issue=INVALID_RESOURCE_ID debug_id=f1e2d3c4b5a69')))
  assert.ok(expired.logs.some((l) => l.includes('expired order released after checks')))
  const auth = await attempt({ lookup: { status: 401, body: { error: 'invalid_token', error_description: 'Token signature verification failed' } } })
  assert.ok(auth.logs.some((l) => l.includes('order lookup HTTP 401 name=invalid_token')))
  assert.equal(auth.res.body.error, 'paypal_order_fetch_failed')
  const denied = await attempt({ lookup: { status: 403, body: { name: 'NOT_AUTHORIZED', debug_id: 'abc', details: [{ issue: 'PERMISSION_DENIED' }] } } })
  assert.ok(denied.logs.some((l) => l.includes('HTTP 403 name=NOT_AUTHORIZED issue=PERMISSION_DENIED')))
  assert.ok(!denied.supabase.calls.some((c) => c.rpc === 'release_conference_pass_checkout'))
  assert.equal(describePaypalError({ status: 404 }, { name: 'x<script>@mail.fr' }), 'HTTP 404 name=xscriptmail.fr issue=- debug_id=-')
})

test('coupure de communication avec PayPal : erreur, rien n’est libéré ni recréé', async () => {
  const { res, supabase, paypal } = await attempt({ lookup: { network: true } })
  assert.equal(res.statusCode, 502)
  assert.ok(!supabase.calls.some((c) => c.rpc === 'release_conference_pass_checkout'))
  assert.equal(created(paypal), 0)
})

test('reprise : même tarif, même référence, même produit ; accès Formation non touché', async () => {
  const { paypal, supabase } = await attempt({ lookup: { status: 404, body: PAYPAL_404 } })
  const order = paypal.find((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders')).body
  assert.deepEqual(order.purchase_units[0].amount, { currency_code: 'EUR', value: '1.00' }, 'montant Sandbox inchangé (Live : montant de l’offre)')
  assert.equal(order.purchase_units[0].reference_id, 'MEDIUMIA_CONFERENCE_PASS_SANDBOX')
  const reserve = supabase.calls.find((c) => c.rpc === 'reserve_conference_pass_checkout').args
  assert.deepEqual([reserve.p_amount_cents, reserve.p_currency, reserve.p_reference_id], [100, 'EUR', 'MEDIUMIA_CONFERENCE_PASS_SANDBOX'])
  const rpcs = supabase.calls.filter((c) => c.rpc).map((c) => c.rpc)
  assert.deepEqual(rpcs, ['validate_conference_pass', 'release_conference_pass_checkout', 'reserve_conference_pass_checkout'], 'aucun droit ni accès accordé à la création')
  assert.ok(!paypal.some((c) => c.url.includes('/capture')))
})

test('le correctif ne touche que la recherche de la commande existante', () => {
  const src = fs.readFileSync(new URL('../lib/conferencePassPayPal.js', import.meta.url), 'utf8')
  const live = src.slice(src.indexOf('function runtimeConfig'), src.indexOf('async function getAccessToken'))
  assert.match(live, /amount: env === 'live' \? liveAmount : '1\.00'/)
  assert.match(live, /accessLevel: 'full',\s*maxModule: 25,\s*durationDays: 365/)
})
