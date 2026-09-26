/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'

// Diagnostic temporaire du checkout Sandbox : en préversion, un échec de « create »
// dit à quelle étape il a échoué (auth PayPal, commande PayPal, enregistrement Supabase)
// avec la réponse brute, sans jamais journaliser d'identifiant, de secret ni de jeton.

process.env.PAYPAL_CLIENT_ID = 'CLIENT-ID-NE-DOIT-PAS-FUIR'
process.env.PAYPAL_CLIENT_SECRET = 'SECRET-NE-DOIT-PAS-FUIR'

const { handlePayPalCheckout, __paypalFormationTest } = await import('../lib/paypalSandbox.js')

function fakeDb(insertError = null) {
  const api = {
    select() { return api }, eq() { return api }, in() { return api }, is() { return api },
    insert() { return Promise.resolve({ data: null, error: insertError }) },
    maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
  }
  return { from: () => api, rpc: async () => ({ data: null, error: null }), auth: { getUser: async () => ({ data: null, error: { message: 'none' } }) } }
}

function fakePayPal({ auth = 'ok', order = 'ok' } = {}) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/v1/oauth2/token') {
      return auth === 'ok' ? json({ access_token: 'JETON-NE-DOIT-PAS-FUIR' }, 200) : json({ error: 'invalid_client', error_description: 'Client Authentication failed' }, 401)
    }
    if (path === '/v2/checkout/orders') {
      return order === 'ok' ? json({ id: 'ORDER-DIAG-1' }, 201) : json({ name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'dbg123', details: [{ issue: 'PAYEE_ACCOUNT_RESTRICTED' }] }, 422)
    }
    return json({}, 404)
  }
}

async function create() {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this }, setHeader() {} }
  await handlePayPalCheckout({ method: 'POST', headers: {}, query: { product: 'discovery' }, body: { termsAccepted: true, immediateAccessAccepted: true, product: 'discovery' } }, res, 'create')
  return res
}

async function withLogs(fn) {
  const lines = []
  const original = console.error
  console.error = (...args) => lines.push(args.join(' '))
  try { return { result: await fn(), lines } } finally { console.error = original }
}

const noSecret = (lines) => {
  const all = lines.join('\n')
  for (const secret of ['CLIENT-ID-NE-DOIT-PAS-FUIR', 'SECRET-NE-DOIT-PAS-FUIR', 'JETON-NE-DOIT-PAS-FUIR', 'Basic ', 'Bearer ']) assert.ok(!all.includes(secret), secret)
}

test('preview: each failing step of « create » is named, with the raw PayPal / Supabase answer and no secret', async () => {
  process.env.VERCEL_ENV = 'preview'
  try {
    __paypalFormationTest.useSupabase(fakeDb())
    fakePayPal({ auth: 'fail' })
    let { result, lines } = await withLogs(create)
    assert.deepEqual([result.statusCode, result.body.error], [502, 'paypal_auth_failed'])
    assert.match(lines.join(), /\[paypal\]\[diag\] create failed: \{"code":"paypal_auth_failed","step":"auth","env":"sandbox","http":401,"paypal_error":"invalid_client"/)
    noSecret(lines)

    fakePayPal({ order: 'fail' });
    ({ result, lines } = await withLogs(create))
    assert.deepEqual([result.statusCode, result.body.error], [502, 'paypal_create_order_failed'])
    assert.match(lines.join(), /"step":"orders".*"http":422,"paypal_name":"UNPROCESSABLE_ENTITY".*"debug_id":"dbg123","issues":\["PAYEE_ACCOUNT_RESTRICTED"\]/)
    noSecret(lines)

    __paypalFormationTest.useSupabase(fakeDb({ code: '23514', message: 'new row for relation "mediumia_paypal_order_intents" violates check constraint "x"', hint: null }))
    fakePayPal();
    ({ result, lines } = await withLogs(create))
    assert.deepEqual([result.statusCode, result.body.error], [502, 'order_intent_write_failed'])
    assert.match(lines.join(), /"step":"intent","env":"sandbox","product":"discovery","db_code":"23514","db_message":"new row for relation/)
    noSecret(lines)
  } finally { delete process.env.VERCEL_ENV }
})

test('production: the temporary diagnostic never logs', async () => {
  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_ENV = 'live'
  process.env.PAYPAL_FORMATION_ENABLED = 'true'
  try {
    __paypalFormationTest.useSupabase(fakeDb())
    fakePayPal({ auth: 'fail' })
    const { result, lines } = await withLogs(create)
    assert.equal(result.statusCode, 502)
    assert.equal(lines.filter((l) => l.includes('[paypal][diag]')).length, 0)
  } finally {
    delete process.env.VERCEL_ENV; delete process.env.PAYPAL_ENV; delete process.env.PAYPAL_FORMATION_ENABLED
  }
})
