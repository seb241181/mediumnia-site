import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isPayableDepositService } from '../lib/rdvDepositPayPal.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('full online payment is open to in-person appointments in the database', () => {
  const sql = read('supabase/migrations/20260923200000_rdv_full_payment_all_modalities.sql')
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_rdv_full_payment_hold/)
  assert.match(sql, /p_selected_modality NOT IN \('video', 'in-person'\)/)
  assert.match(sql, /NOT \(p_selected_modality = ANY\(v_service\.modality\)\)/)
  assert.match(sql, /v_existing_hold\.selected_modality <> p_selected_modality/)
  assert.doesNotMatch(sql, /<> 'video'|'video' = ANY/)
  // Protections kept from the previous version.
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /public\.create_rdv_deposit_hold\(/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_rdv_full_payment_hold[^;]*TO service_role/)
})

test('the full-payment API forwards the chosen modality instead of forcing video', () => {
  const handler = read('lib/rdvFullPaymentApiHandler.js')
  assert.match(handler, /selected_modality !== 'video' && selected_modality !== 'in-person'/)
  assert.match(handler, /isPayableDepositService\(service, selected_modality\)/)
  assert.match(handler, /p_selected_modality: selected_modality,/)
  const service = { booking_mode: 'instant', reservation_payment_kind: 'arrhes', reservation_payment_cents: 2000, price_cents: 7000, currency: 'EUR', modality: ['in-person'] }
  assert.equal(isPayableDepositService(service, 'in-person'), true)
  assert.equal(isPayableDepositService(service, 'video'), false)
})

test('checkout offers PayPal 4X with the mandatory credit notice, and keeps the video H-48 rule video-only', () => {
  const checkout = read('src/components/rdv/RdvDepositCheckout.jsx')
  assert.match(checkout, /components=buttons&enable-funding=paylater/)
  assert.match(checkout, /const PAY_LATER_MIN_CENTS = 3000/)
  assert.match(checkout, /Un crédit vous engage et doit être remboursé\. Vérifiez vos capacités de remboursement avant de vous engager\./)
  assert.match(checkout, /sans compte PayPal/)
  assert.match(checkout, /sur place, par carte bancaire, espèces ou chèque/)
  assert.match(checkout, /const canPayInFull = selectedModality === 'video'/)
  assert.match(read('scripts/apply-rdv-balance-system.mjs'), /const fullPaymentRequired = canPayInFull/)
  assert.match(checkout, /const fullOnlineAllowed = Array\.isArray\(service\?\.modality\) && service\.modality\.includes\(selectedModality\)/)
})

test('service list and summary announce card or PayPal and 4X', () => {
  const page = read('src/components/rdv/RdvPublic.jsx')
  assert.match(page, /carte bancaire ou PayPal, paiement en plusieurs fois possible/)
  // PayPal France only offers 4 instalments: never advertise 2 or 3.
  assert.doesNotMatch(page, /[23] ou 4 ?(x|fois)|en [23] fois/i)
  assert.doesNotMatch(page, /videoOffersFullPayment/)
})
