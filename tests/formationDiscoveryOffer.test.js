/* global process */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { __paypalFormationTest } from '../lib/paypalSandbox.js'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

function completedOrder(cfg, overrides = {}) {
  return {
    id: 'ORDER-DISCOVERY-1',
    create_time: '2026-09-09T08:00:00.000Z',
    payer: {
      email_address: 'buyer@example.test',
      name: { given_name: 'Ada', surname: 'Lovelace' },
    },
    purchase_units: [{
      reference_id: cfg.referenceId,
      custom_id: 'MEDIUMIA:formation-2026-09-01-v1:IMMEDIATE_ACCESS',
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

test('capture verification rejects forged price, product and consent', () => {
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
    assert.equal(__paypalFormationTest.verifiedPayment(discovery, valid, { requireConsent: true }).amountCents, 2900)

    const wrongPrice = structuredClone(valid)
    wrongPrice.purchase_units[0].payments.captures[0].amount.value = '1.00'
    assert.throws(() => __paypalFormationTest.verifiedPayment(discovery, wrongPrice, { requireConsent: true }), /paypal_amount_mismatch/)

    const wrongProduct = structuredClone(valid)
    wrongProduct.purchase_units[0].reference_id = 'MEDIUMIA_FORMATION_597'
    assert.throws(() => __paypalFormationTest.verifiedPayment(discovery, wrongProduct, { requireConsent: true }), /paypal_payment_invalid/)

    const missingConsent = structuredClone(valid)
    delete missingConsent.purchase_units[0].custom_id
    assert.throws(() => __paypalFormationTest.verifiedPayment(discovery, missingConsent, { requireConsent: true }), /paypal_consent_mismatch/)
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
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
