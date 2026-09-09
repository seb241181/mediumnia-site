/* global process */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { __paypalFormationTest } from '../lib/paypalSandbox.js'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

function completedOrder(cfg, overrides = {}) {
  return {
    id: 'ORDER-DISCOVERY-1',
    status: 'COMPLETED',
    create_time: '2026-09-09T08:00:00.000Z',
    payer: {
      email_address: 'buyer@example.test',
      name: { given_name: 'Ada', surname: 'Lovelace' },
    },
    purchase_units: [{
      reference_id: cfg.referenceId,
      custom_id: 'MEDIUMIA:formation-2026-09-01-v1:IMMEDIATE_ACCESS',
      amount: { currency_code: cfg.currency, value: cfg.amount },
      payments: {
        captures: [{
          id: 'CAPTURE-DISCOVERY-1',
          status: 'COMPLETED',
          create_time: '2026-09-09T08:01:00.000Z',
          amount: { currency_code: cfg.currency, value: cfg.amount },
        }],
      },
      ...overrides,
    }],
  }
}

test('server catalog keeps the complete offer unchanged and adds discovery', () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_FORMATION_ENABLED: process.env.PAYPAL_FORMATION_ENABLED,
  }
  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_ENV = 'live'
  process.env.PAYPAL_FORMATION_ENABLED = 'true'

  try {
    const full = __paypalFormationTest.runtimeConfig(null, 'full')
    const discovery = __paypalFormationTest.runtimeConfig(null, 'discovery')

    assert.equal(full.amount, '597.00')
    assert.equal(full.referenceId, 'MEDIUMIA_FORMATION_597')
    assert.equal(full.accessLevel, 'full')
    assert.equal(full.maxModule, 25)
    assert.equal(full.durationDays, 365)

    assert.equal(discovery.amount, '29.00')
    assert.equal(discovery.referenceId, 'MEDIUMIA_DISCOVERY_29')
    assert.equal(discovery.accessLevel, 'discovery')
    assert.equal(discovery.maxModule, 1)
    assert.equal(discovery.durationDays, 30)
    assert.equal(discovery.upgradeCreditCents, 2900)
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('sandbox uses one euro while retaining the selected server-side product', () => {
  const previous = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'preview'
  try {
    const discovery = __paypalFormationTest.runtimeConfig(null, 'discovery')
    assert.equal(discovery.env, 'sandbox')
    assert.equal(discovery.amount, '1.00')
    assert.equal(discovery.displayAmount, '29.00')
    assert.equal(discovery.referenceId, 'MEDIUMIA_DISCOVERY_SANDBOX')
    assert.throws(() => __paypalFormationTest.runtimeConfig(null, '29.00'), /invalid_product/)
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previous
  }
})

test('capture verification uses durable server intent when capture omits custom_id', () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_FORMATION_ENABLED: process.env.PAYPAL_FORMATION_ENABLED,
  }
  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_ENV = 'live'
  process.env.PAYPAL_FORMATION_ENABLED = 'true'

  try {
    const discovery = __paypalFormationTest.runtimeConfig(null, 'discovery')
    const valid = completedOrder(discovery)
    delete valid.purchase_units[0].custom_id
    const intent = {
      paypal_order_id: valid.id,
      paypal_env: 'live',
      product_code: 'discovery',
      amount_cents: 2900,
      currency: 'EUR',
      reference_id: discovery.referenceId,
      terms_version: 'formation-2026-09-01-v1',
      terms_accepted_at: '2026-09-09T07:59:00.000Z',
      immediate_access_accepted_at: '2026-09-09T07:59:00.000Z',
    }
    assert.equal(__paypalFormationTest.verifiedPayment(discovery, valid, intent).amountCents, 2900)

    const wrongPrice = structuredClone(valid)
    wrongPrice.purchase_units[0].payments.captures[0].amount.value = '1.00'
    assert.throws(() => __paypalFormationTest.verifiedPayment(discovery, wrongPrice, intent), /paypal_amount_mismatch/)

    const wrongProduct = structuredClone(valid)
    wrongProduct.purchase_units[0].reference_id = 'MEDIUMIA_FORMATION_597'
    assert.throws(() => __paypalFormationTest.verifiedPayment(discovery, wrongProduct, intent), /paypal_payment_invalid/)

    assert.doesNotThrow(() => __paypalFormationTest.validateOrderAgainstIntent(discovery, valid, intent, { requireCaptured: true }))
    const missingConsent = { ...intent, terms_accepted_at: null }
    assert.throws(() => __paypalFormationTest.validateOrderAgainstIntent(discovery, valid, missingConsent), /consent_evidence_missing/)
    const wrongIntentProduct = { ...intent, product_code: 'full' }
    assert.throws(() => __paypalFormationTest.validateOrderAgainstIntent(discovery, valid, wrongIntentProduct), /purchase_product_mismatch/)
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
})

test('legacy captured Sandbox order is recoverable only with PayPal consent marker', () => {
  const previous = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'preview'
  try {
    const discovery = __paypalFormationTest.runtimeConfig(null, 'discovery')
    const order = completedOrder(discovery)
    order.status = 'COMPLETED'
    order.purchase_units[0].amount = { currency_code: discovery.currency, value: discovery.amount }
    const intent = __paypalFormationTest.legacyIntentFromPayPal(discovery, order)
    assert.equal(intent.product_code, 'discovery')
    assert.equal(intent.status, 'captured')

    delete order.purchase_units[0].custom_id
    assert.throws(() => __paypalFormationTest.legacyIntentFromPayPal(discovery, order), /legacy_consent_unverifiable/)
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previous
  }
})

test('capture flow persists intent first and can reconcile without recapturing', () => {
  const paypal = read('lib/paypalSandbox.js')
  const migration = read('supabase/migrations/20260909133000_mediumia_paypal_order_intents.sql')

  assert.match(paypal, /await saveOrderIntent\(getSupabaseAdmin\(\), cfg, data\.id\)/)
  assert.match(paypal, /if \(fetched\.data\.status !== 'COMPLETED'\)/)
  assert.match(paypal, /completedOrder = await captureOrder/)
  assert.match(paypal, /status: 'provisioning_failed'/)
  assert.match(paypal, /status: 'provisioned'/)
  assert.match(migration, /paypal_order_id text primary key/)
  assert.match(migration, /paypal_capture_id text unique/)
  assert.match(migration, /revoke all on table public\.mediumia_paypal_order_intents from public, anon, authenticated/)
})

test('public Formation page presents full first and discovery without calling it a book', () => {
  const page = read('src/components/FormationPage.jsx')
  const catalog = read('lib/mediumiaPublicCatalog.js')
  const paypal = read('lib/paypalSandbox.js')
  const terms = read('public/cgv-formation.html')

  assert.ok(page.indexOf('Offre principale') < page.indexOf('Découverte MediumIA'))
  assert.match(page, /Introduction complète/)
  assert.match(page, /Module 1 — L’Intention comme Porte/)
  assert.match(page, /Exercices du Module 1/)
  assert.match(page, /Carnet de pratique intégré/)
  assert.match(page, /MediumIA pendant 30 jours/)
  assert.match(page, /PDF Découverte personnel/)
  assert.match(page, /Vos 29 € sont déduits/)
  assert.match(page, /<FormationCheckout product="discovery" \/>/)
  assert.match(catalog, /Prix public : 29 € TTC/)
  assert.match(paypal, /mediumia_grant_purchase_access_atomic/)
  assert.match(terms, /Découverte MediumIA est de <strong>29 € TTC/)
  assert.match(terms, /solde est donc de <strong>568 € TTC/)
  assert.match(terms, /30 jours<\/strong> et jusqu’au Module 1/)
  assert.doesNotMatch(page, /livre Découverte/i)
})
