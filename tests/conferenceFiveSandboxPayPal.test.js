/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import { __conferenceFiveSandboxTest } from '../lib/conferenceFiveSandboxPayPal.js'

const { fivePlanBody, fiveVerifiedTransactions, fiveSandboxEnabled } = __conferenceFiveSandboxTest
const transaction = (id, status = 'COMPLETED', amount = '99.80') => ({
  id, status,
  amount_with_breakdown: { gross_amount: { currency_code: 'EUR', value: amount } },
  time: '2026-10-23T13:00:00Z',
})

test('five-cycle plan is exactly five monthly 99.80 EUR charges, no infinite renewal', () => {
  const plan = fivePlanBody('PROD-TEST123456789')
  assert.equal(plan.billing_cycles.length, 1)
  assert.equal(plan.billing_cycles[0].tenure_type, 'REGULAR')
  assert.equal(plan.billing_cycles[0].frequency.interval_unit, 'MONTH')
  assert.equal(plan.billing_cycles[0].total_cycles, 5)
  assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.value, '99.80')
  assert.equal(plan.payment_preferences.auto_bill_outstanding, false)
  assert.equal(plan.payment_preferences.payment_failure_threshold, 1)
})

test('sandbox cannot be enabled on production or other Supabase project or PayPal live', () => {
  const safe = { VERCEL_ENV: 'preview', CONFERENCE_FIVE_SANDBOX_ENABLED: 'true',
    SUPABASE_URL: 'https://wnbwhnqiulsdjcvkuwos.supabase.co', PAYPAL_ENV: 'sandbox' }
  assert.equal(fiveSandboxEnabled(safe), true)
  assert.equal(fiveSandboxEnabled({ ...safe, VERCEL_ENV: 'production' }), false)
  assert.equal(fiveSandboxEnabled({ ...safe, PAYPAL_ENV: 'live' }), false)
  assert.equal(fiveSandboxEnabled({ ...safe, SUPABASE_URL: 'https://uotkpygeqqnekpolezts.supabase.co' }), false)
  assert.equal(fiveSandboxEnabled({ ...safe, CONFERENCE_FIVE_SANDBOX_ENABLED: undefined }), false)
})

test('provider transactions are parsed in cents and capped at 5 payments', () => {
  const txs = Array.from({ length: 5 }, (_, i) => transaction(`SALE-${i + 1}`))
  const r = fiveVerifiedTransactions(txs, 'I-TEST')
  assert.equal(r.summary.fullyPaid, true)
  assert.equal(r.summary.netCents, 49900)
  assert.equal(r.records.length, 5)
  assert.equal(r.records[0].paypal_subscription_id, 'I-TEST')
})

test('provider pending payments do not count; refunds suspend full rights', () => {
  const txs = [transaction('SALE-1'), transaction('SALE-2', 'PENDING'), transaction('SALE-3', 'REFUNDED')]
  const r = fiveVerifiedTransactions(txs, 'I-TEST')
  assert.equal(r.summary.fullyPaid, false)
  assert.equal(r.summary.paidInstalments, 1)
  assert.equal(r.summary.netCents, 9980)
  assert.equal(r.refunds.length, 1)
  assert.equal(r.records.filter(x => x.kind === 'refund').length, 1)
})

test('ambiguous or incorrect provider transactions always fail closed', () => {
  assert.throws(() => fiveVerifiedTransactions([transaction('SALE-1', 'PARTIALLY_REFUNDED')], 'I-TEST'), /partial_refund_requires_review/)
  assert.throws(() => fiveVerifiedTransactions([transaction('SALE-1', 'COMPLETED', '149.00')], 'I-TEST'), /transaction_amount_invalid/)
  assert.throws(() => fiveVerifiedTransactions([transaction('SALE-1'), transaction('SALE-1')], 'I-TEST'), /transaction_reference_invalid/)
  assert.throws(() => fiveVerifiedTransactions([transaction('SALE-1', 'UNKNOWN')], 'I-TEST'), /transaction_status_invalid/)
  assert.throws(() => fiveVerifiedTransactions([transaction('SALE-1', 'COMPLETED', '99')], 'I-TEST'), /transaction_amount_invalid/)
})

test('sandbox parser never counts six paid cycles as fully paid', () => {
  const r = fiveVerifiedTransactions(Array.from({ length: 6 }, (_, i) => transaction(`SALE-${i + 1}`)), 'I-TEST')
  assert.equal(r.summary.fullyPaid, false)
  assert.ok(r.summary.anomalies.includes('too_many_captures'))
})
