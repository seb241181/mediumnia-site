import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getChronosphereProductDefinition,
  getChronosphereMaxCaptureConfig,
} from '../lib/chronospherePayPal.js'

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('MAX nouveau tarif : PayPal Live facture 14,90 €, Sandbox conserve son euro de test', () => {
  const live = getChronosphereProductDefinition('max3','live')
  const sandbox = getChronosphereProductDefinition('max3','sandbox')
  assert.equal(live.amount, '14.90')
  assert.equal(live.displayAmount, '14.90')
  assert.equal(live.referenceId, 'MEDIUMIA_CHRONOSPHERE_MAX3_1490')
  assert.equal(live.credits, 3)
  assert.equal(live.productType, 'max3')
  assert.equal(sandbox.amount, '1.00')
  assert.equal(sandbox.displayAmount, '14.90')
  assert.equal(getChronosphereProductDefinition('single','live').amount,'5.00')
  assert.equal(getChronosphereProductDefinition('pack3','live').amount,'9.90')
})

test('capture MAX : ancienne commande 19,90 € et nouvelle 14,90 € restent vérifiables', () => {
  const old = getChronosphereMaxCaptureConfig(1990,'live')
  assert.equal(old.amount,'19.90')
  assert.equal(old.referenceId,'MEDIUMIA_CHRONOSPHERE_MAX3_1990')
  const current = getChronosphereMaxCaptureConfig(1490,'live')
  assert.equal(current.amount,'14.90')
  assert.equal(current.referenceId,'MEDIUMIA_CHRONOSPHERE_MAX3_1490')
  const testPayment = getChronosphereMaxCaptureConfig(100,'sandbox')
  assert.equal(testPayment.amount,'1.00')
  assert.equal(testPayment.referenceId,'MEDIUMIA_CHRONOSPHERE_MAX3_SANDBOX_100')
  assert.equal(getChronosphereMaxCaptureConfig(1990,'sandbox'),null)
  assert.equal(getChronosphereMaxCaptureConfig(1490,'sandbox'),null)
  assert.equal(getChronosphereMaxCaptureConfig(100,'live'),null)
})

test('la capture choisit le tarif mémorisé en base avant de contrôler la monnaie et le consentement', () => {
  const p = source('lib/chronospherePayPal.js')
  assert.match(p,/getChronosphereMaxCaptureConfig\(pack.amount_cents, pack.paypal_env\)/)
  assert.match(p,/if \(isMax && \(!maxCaptureCfg \|\| cfg.env !== pack.paypal_env\)\)/)
  assert.match(p,/pack.amount_cents !== cents\(cfg.amount\)/)
  assert.match(p,/capture.amount\?\.currency_code !== cfg.currency \|\| capture.amount\?\.value !== cfg.amount/)
  assert.match(p,/captureOrder\(cfg, await getAccessToken\(cfg\), orderId\)/)
  assert.match(p,/\.eq\('status', 'payment_pending'\)/)
  assert.match(p,/credits_remaining: PACK_CREDITS/)
  assert.match(p,/capturedPack\?\.paypal_capture_id !== payment.captureId/)
  assert.match(p,/consent_accepted_at/)
})

test('le prix 14,90 € est affiché et la migration conserve les anciens achats et la gratuité', () => {
  const page = source('src/components/ChronospherePage.jsx')
  const maxPage = source('src/components/ChronosphereMaxPage.jsx')
  const migration = source('supabase/migrations/20261122113500_chronosphere_max_price_1490.sql')
  assert.match(page,/maxPrice \|\| '14,90 € TTC'/)
  assert.match(maxPage,/>14,90 €<\/span>/)
  assert.match(maxPage,/La production est configurée à 14,90 €/)
  assert.match(migration,/amount_cents IN \(100, 990, 1490, 1990\)/)
  assert.match(migration,/grant_kind = 'courtesy' AND amount_cents = 0/)
})
