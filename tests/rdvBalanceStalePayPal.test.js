import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectRdvBalancePayPalOrder } from '../lib/rdvBalancePayPal.js'

const api = readFileSync('lib/rdvBalanceApiHandler.js', 'utf8')
const helper = readFileSync('lib/rdvBalancePayPal.js', 'utf8')
const page = readFileSync('public/rdv-solde.html', 'utf8')

test('old PayPal orders are inspected before replacement, without capturing or overwriting paid attempts', () => {
  assert.match(api, /inspectRdvBalancePayPalOrder\(persistedOrderId\)/)
  assert.match(api, /\['CREATED', 'PAYER_ACTION_REQUIRED', 'NOT_FOUND'\]/)
  assert.match(api, /balance_payment_review_required/)
  assert.match(api, /6 \* 3_600_000/)
  assert.match(api, /\.eq\('status', 'order_pending'\)/)
  assert.match(api, /\.eq\('paypal_order_id', persistedOrderId\)/)
  assert.match(api, /\.lt\('updated_at', deadline\)/)
  assert.match(api, /balance_payment_retry_required/)
  assert.match(api, /clientCheckoutId: checkoutKey/)
  assert.match(helper, /rdv-balance-create-\$\{bookingId\}-\$\{clientCheckoutId \|\| bookingId\}/)
})

test('the link remains recoverable after refresh without leaking the token in the address', () => {
  assert.match(page, /history\.state\?\.mediumiaBalanceToken/)
  assert.match(page, /history\.replaceState\(\{ \.\.\.\(history\.state \|\| \{\}\)/)
  assert.match(page, /window\.location\.assign\(checkoutUrl\)/)
  assert.doesNotMatch(page, /window\.open\('about:blank'/)
  assert.match(page, /Paiement annulé/)
  assert.match(page, /Vérification momentanément indisponible/)
})

test('PayPal order status check is read-only and returns only status', async () => {
  const oldFetch = globalThis.fetch
  const oldEnv = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  }
  const requests = []
  process.env.VERCEL_ENV = 'preview'
  process.env.PAYPAL_CLIENT_ID = 'test-client-id'
  process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret'
  globalThis.fetch = async (url, opts = {}) => {
    requests.push({ url: String(url), method: opts.method || 'GET' })
    if (String(url).endsWith('/v1/oauth2/token')) {
      return { ok: true, json: async () => ({ access_token: 'fake-access-token' }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'ORDER_12345678', status: 'CREATED' }),
    }
  }
  try {
    const checked = await inspectRdvBalancePayPalOrder('ORDER_12345678')
    assert.deepEqual(checked, { status: 'CREATED' })
    assert.ok(requests.every(request => !request.url.includes('/capture')))
    assert.equal(requests.at(-1).method, 'GET')
  } finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
