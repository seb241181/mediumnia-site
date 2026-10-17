/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'

// Vrai handler, réseau simulé : Supabase (auth + PostgREST) et PayPal Sandbox.
// Chaque requête PayPal est comptée : le replay d'une capture doit en faire 0.
process.env.SUPABASE_URL = 'https://capture-fixture.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fixture'
process.env.PAYPAL_CLIENT_ID = 'sandbox-client-fixture'
process.env.PAYPAL_CLIENT_SECRET = 'sandbox-secret-fixture'
process.env.VERCEL_ENV = 'preview'

const MAX_CONSENT = 'chronosphere-max-2026-09-23-v2'
const PACK_CONSENT = 'chronosphere-2026-09-05-pack3-v1'
const MAX_REF = 'MEDIUMIA_CHRONOSPHERE_MAX3_SANDBOX_100'
const TOKENS = { 'token-A': 'user-A', 'token-B': 'user-B' }

const state = { rows: [], paypal: [], patches: 0, captureStatus: 'COMPLETED' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const matches = (row, params) => [...params].every(([k, v]) => k === 'select' || (v.startsWith('eq.') ? String(row[k]) === v.slice(3) : true))

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const method = String(init.method || input.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers || input.headers || {})
  if (url.hostname.endsWith('paypal.com')) {
    state.paypal.push(`${method} ${url.pathname}`)
    assert.equal(url.hostname, 'api-m.sandbox.paypal.com', 'jamais d’hôte PayPal Live')
    if (url.pathname === '/v1/oauth2/token') return json({ access_token: 'paypal-access-fixture' })
    const id = url.pathname.split('/')[4]
    const order = { id, status: state.captureStatus, purchase_units: [{ reference_id: MAX_REF, payments: { captures: state.captureStatus === 'COMPLETED' ? [{ id: `CAP-${id}`, status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' }, create_time: '2026-10-05T12:00:00Z' }] : [] } }] }
    return state.captureStatus === 'COMPLETED' ? json(order) : json({ name: 'UNPROCESSABLE_ENTITY' }, 422)
  }
  if (url.pathname === '/auth/v1/user') {
    const user = TOKENS[(headers.get('authorization') || '').replace(/^Bearer\s+/i, '')]
    return user ? json({ id: user, aud: 'authenticated' }) : json({ message: 'invalid token' }, 401)
  }
  if (url.pathname === '/rest/v1/chronosphere_credit_packs') {
    const found = state.rows.filter((row) => matches(row, url.searchParams))
    if (method === 'PATCH') {
      state.patches += 1
      const patch = JSON.parse(init.body)
      for (const row of found) Object.assign(row, patch)
    }
    const single = (headers.get('accept') || '').includes('vnd.pgrst.object')
    if (single) return found.length === 1 ? json(found[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)
    return json(found)
  }
  throw new Error(`requête inattendue ${method} ${url.href}`)
}

const { handleChronospherePayPal } = await import('../lib/chronospherePayPal.js')

function pack(overrides = {}) {
  return {
    id: 'pack-1', user_id: 'user-A', product_type: 'max3', status: 'payment_pending', consent_version: MAX_CONSENT,
    consent_accepted_at: '2026-10-05T11:59:00Z', paypal_env: 'sandbox', amount_cents: 100, currency: 'EUR',
    paypal_order_id: 'ORDER-1', paypal_capture_id: null, credits_remaining: 0, credits_total: 3, ...overrides,
  }
}
async function capture(orderId = 'ORDER-1', token = 'token-A') {
  const res = { code: null, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  await handleChronospherePayPal({ method: 'POST', body: { orderId }, headers: { authorization: `Bearer ${token}` } }, res, 'capture')
  return res
}
function reset(rows, captureStatus = 'COMPLETED') {
  state.rows = rows; state.paypal = []; state.patches = 0; state.captureStatus = captureStatus
}
const captureCalls = () => state.paypal.filter((c) => c.endsWith('/capture')).length

test('1. première capture d’un pack payment_pending : /capture une fois, pack actif, 3 crédits', async () => {
  reset([pack()])
  const res = await capture()
  assert.equal(res.code, 200)
  assert.equal(res.body.status, 'COMPLETED')
  assert.equal(captureCalls(), 1)
  assert.equal(state.rows[0].status, 'active')
  assert.equal(state.rows[0].credits_remaining, 3)
  assert.equal(state.rows[0].paypal_capture_id, 'CAP-ORDER-1')
  assert.deepEqual([res.body.creditsRemaining, res.body.creditsTotal, res.body.captureId], [3, 3, 'CAP-ORDER-1'])
})

test('2. replay du même Order ID : COMPLETED depuis la base, zéro appel PayPal, aucune écriture', async () => {
  reset([pack()])
  const first = await capture()
  state.paypal = []; state.patches = 0
  const replay = await capture()
  assert.equal(replay.code, 200)
  assert.equal(state.paypal.length, 0, 'aucune requête PayPal (ni OAuth, ni capture, ni lecture)')
  assert.equal(state.patches, 0, 'aucune nouvelle écriture')
  assert.equal(replay.body.status, 'COMPLETED')
  assert.equal(replay.body.captureId, first.body.captureId)
  assert.equal(replay.body.orderId, 'ORDER-1')
  assert.deepEqual([replay.body.creditsRemaining, replay.body.creditsTotal, replay.body.packStatus], [3, 3, 'active'])
  assert.deepEqual(replay.body.amount, { currency_code: 'EUR', value: '1.00' })
  assert.equal(state.rows.length, 1, 'même pack, aucun second pack')
})

test('3. pack exhausted avec captureId : COMPLETED depuis la base, zéro appel PayPal', async () => {
  reset([pack({ status: 'exhausted', paypal_capture_id: 'CAP-OLD', credits_remaining: 0 })])
  const res = await capture()
  assert.equal(res.code, 200)
  assert.deepEqual([res.body.status, res.body.captureId, res.body.creditsRemaining, res.body.packStatus], ['COMPLETED', 'CAP-OLD', 0, 'exhausted'])
  assert.equal(state.paypal.length, 0)
  assert.equal(state.patches, 0)
})

test('4. propriétaire incorrect sur max3 : 401, zéro appel PayPal', async () => {
  for (const status of ['payment_pending', 'active']) {
    reset([pack({ status, paypal_capture_id: status === 'active' ? 'CAP-A' : null, credits_remaining: status === 'active' ? 3 : 0 })])
    const res = await capture('ORDER-1', 'token-B')
    assert.equal(res.code, 401, status)
    assert.equal(state.paypal.length, 0, status)
    assert.equal(state.patches, 0, status)
  }
})

test('5. active/exhausted sans captureId : échec fermé, zéro appel PayPal, aucune écriture', async () => {
  for (const status of ['active', 'exhausted']) {
    reset([pack({ status, paypal_capture_id: null, credits_remaining: status === 'active' ? 3 : 0 })])
    const res = await capture()
    assert.equal(res.code, 502, status)
    assert.equal(res.body.error, 'capture_state_invalid', status)
    assert.equal(state.paypal.length, 0, status)
    assert.equal(state.patches, 0, status)
  }
})

test('6. payment_pending : comportement normal inchangé (non approuvé → échec, aucun crédit)', async () => {
  reset([pack()], 'APPROVAL_PENDING')
  const res = await capture()
  assert.equal(res.code, 502)
  assert.equal(res.body.error, 'paypal_capture_failed')
  assert.equal(captureCalls(), 1, 'la capture normale est bien tentée')
  assert.deepEqual([state.rows[0].status, state.rows[0].credits_remaining, state.patches], ['payment_pending', 0, 0])
  // Pack classique (pack3) en attente : même chemin qu'avant.
  reset([pack({ product_type: 'pack3', consent_version: PACK_CONSENT, user_id: null })])
  const classic = await capture('ORDER-1', 'token-B')
  assert.equal(classic.code, 502, 'référence pack3 différente du fixture MAX : rejet par verifiedPayment, comme avant')
  assert.equal(captureCalls(), 1)
})
