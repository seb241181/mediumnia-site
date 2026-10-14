import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { summarizeGuidancePayPalEvidence as summarize } from '../lib/emailQuestionPayPalEvidence.js'

const row = {
  id: 'b24527bb-89b8-427f-baa8-55d264da4307',
  paypal_order_id: 'ORDER-TEST-123',
  pack: 'q2',
  amount_cents: 2990,
  currency: 'EUR',
}
const capture = {
  id: 'CAPTURE-TEST-123',
  status: 'COMPLETED',
  amount: { currency_code: 'EUR', value: '29.90' },
}
const order = () => ({
  id: row.paypal_order_id,
  status: 'COMPLETED',
  purchase_units: [{
    custom_id: row.id, reference_id: 'MEDIUMIA_EMAIL_Q2',
    payments: { captures: [{ ...capture, amount: { ...capture.amount } }] },
  }],
})
const detail = () => ({ ...capture, amount: { ...capture.amount } })

test('capture PayPal cohérente : confirmation de lecture seule, aucune mutation', () => {
  const output = summarize(row, order(), detail())
  assert.equal(output.classification, 'capture_confirmed_readonly')
  assert.equal(output.reason, 'capture_consistent')
  assert.equal(output.captureId, capture.id)
})

test('commande PayPal incohérente ou custom_id absent : revue manuelle', () => {
  const wrongOrder = order(); wrongOrder.id = 'SOME-OTHER-ORDER'
  assert.equal(summarize(row, wrongOrder, detail()).reason, 'order_id_mismatch')
  const badCustom = order(); badCustom.purchase_units[0].custom_id = 'WRONG'
  assert.equal(summarize(row, badCustom, detail()).reason, 'custom_id_or_purchase_units_mismatch')
  const second = order(); second.purchase_units.push({ ...second.purchase_units[0] })
  assert.equal(summarize(row, second, detail()).classification, 'manual_review')
})

test('montant/devise et reference invalides : ne jamais accepter le paiement', () => {
  const badAmount = order(); badAmount.purchase_units[0].payments.captures[0].amount.value = '59.80'
  assert.equal(summarize(row, badAmount, detail()).reason, 'amount_or_currency_mismatch')
  const wrongReference = order(); wrongReference.purchase_units[0].reference_id = 'OTHER_PRODUCT'
  assert.equal(summarize(row, wrongReference, detail()).reason, 'reference_mismatch')
  const badCurrency = detail(); badCurrency.amount.currency_code = 'USD'
  assert.equal(summarize(row, order(), badCurrency).reason, 'amount_or_currency_mismatch')
})

test('capture remboursée ou partiellement remboursée : revue manuelle', () => {
  for (const status of ['REFUNDED', 'PARTIALLY_REFUNDED']) {
    const refunded = detail(); refunded.status = status
    assert.equal(summarize(row, order(), refunded).reason, 'refund_detected')
  }
})

test('etats incertains, captures multiples et detail indisponible : revue manuelle', () => {
  assert.equal(summarize(row, order(), null).reason, 'capture_detail_not_checked')
  const noCapture = order(); noCapture.purchase_units[0].payments.captures = []
  assert.equal(summarize(row, noCapture).reason, 'no_capture_found')
  const twice = order(); twice.purchase_units[0].payments.captures.push({ ...capture, id: 'CAPTURE-TEST-456' })
  assert.equal(summarize(row, twice).reason, 'multiple_captures')
  const approved = order(); approved.status = 'APPROVED'
  assert.equal(summarize(row, approved, detail()).reason, 'capture_not_fully_completed')
})

test('route admin protegée : seulement des GET PayPal et aucune écriture dans la prévisualisation', () => {
  const server = readFileSync(new URL('../lib/emailQuestions.js', import.meta.url), 'utf8')
  assert.match(server, /if \(input\.op === 'paypal_readonly_preview'\)/)
  const start = server.indexOf("if (input.op === 'paypal_readonly_preview')")
  const end = server.indexOf("if (input.op === 'start')", start)
  assert.ok(start > 0 && end > start)
  const block = server.slice(start, end)
  assert.match(block, /paypalAccessToken/)
  assert.match(block, /'GET'/)
  assert.doesNotMatch(block, /paypalRequest\([^\n]*'POST'|\.update\(|\.insert\(|\.delete\(|sendPurchaseEmails\(/)
  assert.match(server, /if \(!\(await ownerAllowed\(db, userId\)\)\) return \{ status: 403/)
})
