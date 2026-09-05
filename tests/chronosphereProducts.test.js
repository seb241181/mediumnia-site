/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  generateChronospherePaymentToken,
  getChronosphereProductDefinition,
  handleChronospherePayPal,
} from '../lib/chronospherePayPal.js'

const paypalPath = new URL('../lib/chronospherePayPal.js', import.meta.url)
const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const legacyMigrationPath = new URL('../supabase/migrations/20260902150000_chronosphere_paid_draws.sql', import.meta.url)
const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const homePath = new URL('../src/App.jsx', import.meta.url)

async function readSources() {
  const [paypal, timeline, legacyMigration, page, home] = await Promise.all([
    readFile(paypalPath, 'utf8'),
    readFile(timelinePath, 'utf8'),
    readFile(legacyMigrationPath, 'utf8'),
    readFile(pagePath, 'utf8'),
    readFile(homePath, 'utf8'),
  ])
  return { paypal, timeline, legacyMigration, page, home }
}

test('product allowlist rejects unknown identifiers and defines server prices', () => {
  assert.equal(getChronosphereProductDefinition('other', 'live'), null)
  assert.equal(getChronosphereProductDefinition('single', 'preview'), null)

  const single = getChronosphereProductDefinition('single', 'live')
  assert.equal(single.amount, '5.00')
  assert.equal(single.credits, 1)
  assert.equal(single.table, 'chronosphere_paid_draws')
  assert.equal(single.consentVersion, 'chronosphere-2026-09-05-single-v2')

  const pack = getChronosphereProductDefinition('pack3', 'live')
  assert.equal(pack.amount, '9.90')
  assert.equal(pack.credits, 3)
  assert.equal(pack.table, 'chronosphere_credit_packs')
  assert.equal(getChronosphereProductDefinition('single', 'sandbox').amount, '1.00')
  assert.equal(getChronosphereProductDefinition('pack3', 'sandbox').amount, '1.00')
})

test('create returns HTTP 400 invalid_product before any external effect', async () => {
  const originalVercelEnv = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'preview'
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }

  try {
    await handleChronospherePayPal({ method: 'POST', body: { consentAccepted: true, product: 'invalid' } }, response, 'create')
  } finally {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnv
  }

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.body, { error: 'invalid_product' })
})

test('payment tokens are opaque and only their SHA-256 value is persisted', () => {
  const first = generateChronospherePaymentToken()
  const second = generateChronospherePaymentToken()
  assert.match(first.token, /^[A-Za-z0-9_-]{40,}$/)
  assert.notEqual(first.token, second.token)
  assert.equal(first.hash, createHash('sha256').update(first.token).digest('hex'))
  assert.notEqual(first.hash, first.token)
})

test('create returns the product-specific token and keeps storage isolated', async () => {
  const { paypal } = await readSources()
  assert.match(paypal, /const productDefinition = getChronosphereProductDefinition\(product, packCfg\.env\)[\s\S]*if \(!productDefinition\)[\s\S]*invalid_product/)
  assert.match(paypal, /product === 'single'[\s\S]*from\('chronosphere_paid_draws'\)\.insert/)
  assert.match(paypal, /from\('chronosphere_credit_packs'\)\.insert/)
  assert.match(paypal, /json\(\{ id: data\.id, product, drawToken: token\.token \}\)/)
  assert.match(paypal, /json\(\{ id: data\.id, product, packToken: token\.token, credits: PACK_CREDITS \}\)/)
})

test('capture resolves its product from server rows and is idempotent', async () => {
  const { paypal } = await readSources()
  const packLookup = paypal.indexOf('const { data: pack, error: lookupError }')
  const singleFallback = paypal.indexOf('const single = await captureSingleDraw({ supabase, orderId })', packLookup)
  assert.ok(packLookup >= 0 && singleFallback > packLookup)
  assert.match(paypal, /chronosphere_paid_draws'[\s\S]*eq\('status', 'payment_pending'\)[\s\S]*capturedDraw\?\.paypal_capture_id !== payment\.captureId/)
  assert.match(paypal, /chronosphere_credit_packs'[\s\S]*eq\('status', 'payment_pending'\)[\s\S]*capturedPack\?\.paypal_capture_id !== payment\.captureId/)
  assert.match(paypal, /isNewSingle \? SINGLE_CONFIGS : LEGACY_CONFIGS/)
})

test('single-use RPC refuses a second distinct draw while preserving cached retries', async () => {
  const { timeline, legacyMigration } = await readSources()
  assert.match(legacyMigration, /status = 'completed' and v_draw\.request_hash = p_request_hash[\s\S]*'cached', true/)
  assert.match(legacyMigration, /if v_draw\.status = 'completed'[\s\S]*'already_consumed'/)
  assert.match(timeline, /consume_chronosphere_draw_token/)
})

test('frontend sends the selected product and preserves legacy recovery fixes', async () => {
  const { page } = await readSources()
  assert.match(page, /useState\(null\)[\s\S]*setSelectedProduct/)
  assert.match(page, /JSON\.stringify\(\{ consentAccepted: true, product \}\)/)
  assert.match(page, /buildPayload\(token, legacy\)/)
  assert.match(page, /orderId: currentPending\.orderId/)
  assert.match(page, /chronosphere_drawToken/)
  assert.match(page, /parsed\.product === 'single'[\s\S]*parsed\.drawToken/)
})

test('completed single result offers a return to product selection', async () => {
  const { page } = await readSources()
  assert.match(page, /creditState === null && resultToken\?\.legacy/)
  assert.match(page, /onClick=\{handleChooseNewOffer\}[\s\S]*Choisir un nouveau tirage →/)
  assert.match(page, /delivery\?\.email === 'error'[\s\S]*Renvoyer mon tirage par e-mail[\s\S]*Choisir un nouveau tirage →/)
})

test('single offer reset clears the result and removes any automatic product choice', async () => {
  const { page } = await readSources()
  const reset = page.slice(page.indexOf('function handleChooseNewOffer()'), page.indexOf('const parts = result'))
  assert.match(reset, /setResult\(null\)/)
  assert.match(reset, /setSelectedProduct\(null\)/)
  assert.match(reset, /setShowPayment\(false\)/)
  assert.match(reset, /setConsentAccepted\(false\)/)
  assert.match(reset, /setError\(''\)/)
  assert.match(reset, /paymentProductRef\.current = null/)
})

test('pack_not_found clears an obsolete pending payment', async () => {
  const { page } = await readSources()
  const recovery = page.slice(page.indexOf('const neverPaid ='), page.indexOf("throw new Error('La vérification a échoué"))
  assert.match(recovery, /'pack_not_found'/)
  assert.match(recovery, /neverPaid\.includes\(code\)[\s\S]*clearPendingPayment\(\)/)
  assert.match(recovery, /drawTokenRef\.current = null[\s\S]*setShowPayment\(false\)/)
})

test('home presents both public offers and the discovery CTA', async () => {
  const { home } = await readSources()
  assert.match(home, /À partir de 5 € TTC/)
  assert.match(home, /1 tirage : 5 € · Pack 3 tirages : 9,90 €/)
  assert.match(home, /Découvrir Chronosphère/)
})
