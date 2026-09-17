import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  formatRdvDepositAmount,
  isPayableDepositService,
  rdvDepositCreateRequestId,
  rdvDepositCustomId,
} from '../lib/rdvDepositPayPal.js'

test('formats 20 euro reservation deposit for PayPal', () => {
  assert.equal(formatRdvDepositAmount(2000), '20.00')
  assert.throws(() => formatRdvDepositAmount(0), /rdv_deposit_amount_invalid/)
})

test('accepts arrhes only for configured instant EUR service and its modality', () => {
  const service = {
    booking_mode: 'instant',
    reservation_payment_kind: 'arrhes',
    reservation_payment_cents: 2000,
    price_cents: 7000,
    currency: 'EUR',
    modality: ['video'],
  }
  assert.equal(isPayableDepositService(service, 'video'), true)
  assert.equal(isPayableDepositService(service, 'in-person'), false)
  assert.equal(isPayableDepositService({ ...service, booking_mode: 'request' }, 'video'), false)
  assert.equal(isPayableDepositService({ ...service, reservation_payment_cents: 8000 }, 'video'), false)
})

test('PayPal identifiers are deterministic and bound to the server hold', () => {
  const holdId = '11111111-2222-4333-8444-555555555555'
  assert.equal(rdvDepositCreateRequestId(holdId), rdvDepositCreateRequestId(holdId))
  assert.match(rdvDepositCreateRequestId(holdId), /^rdv-deposit-create-/)
  assert.equal(rdvDepositCustomId(holdId), `MEDIUMIA:RDV-ARRHES:${holdId}`)
})

test('accounting migration configures 20 euro arrhes and server-only journal', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260916190000_rdv_arrhes_accounting_foundation.sql', import.meta.url), 'utf8')
  assert.match(sql, /reservation_payment_cents = 2000/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.rdv_financial_entries/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.rdv_financial_entries FROM anon, authenticated/)
  assert.match(sql, /'mediumia', 'reservio', 'manual'/)
})

test('checkout migration blocks unpaid MediumIA bypass and records one financial entry on conversion', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260916193000_rdv_arrhes_paypal_checkout.sql', import.meta.url), 'utf8')
  assert.match(sql, /reservation_payment_required/)
  assert.match(sql, /CREATE TRIGGER bookings_require_reservation_payment/)
  assert.match(sql, /INSERT INTO public\.rdv_financial_entries/)
  assert.match(sql, /external_payment_ref/)
  assert.match(sql, /p_paypal_capture_id/)
})

test('full-payment migration is self-contained, video-only and retry-safe', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260917051500_rdv_full_payment_option_fix.sql', import.meta.url), 'utf8')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS payment_option/)
  assert.match(sql, /payment_option IN \('deposit', 'full'\)/)
  assert.match(sql, /p_selected_modality <> 'video'/)
  assert.match(sql, /client_checkout_id = p_client_checkout_id/)
  assert.match(sql, /v_existing_payment\.payment_option <> 'full'/)
  assert.match(sql, /payment_choice <> 'full_payment'/)
  assert.match(sql, /'existing', true/)
  assert.match(sql, /payment_option = 'full'/)
})

test('full-payment API creates a full PayPal order while deposit remains the default', () => {
  const fullHandler = fs.readFileSync(new URL('../lib/rdvFullPaymentApiHandler.js', import.meta.url), 'utf8')
  const paypalHelper = fs.readFileSync(new URL('../lib/rdvDepositPayPal.js', import.meta.url), 'utf8')
  assert.match(fullHandler, /paymentOption: 'full'/)
  assert.match(paypalHelper, /paymentOption = 'deposit'/)
  assert.match(paypalHelper, /paymentOption === 'full' \? 'Paiement intégral' : 'Arrhes de réservation'/)
})

test('public confirmation copy distinguishes full payment from arrhes', () => {
  const page = fs.readFileSync(new URL('../src/components/rdv/RdvPublic.jsx', import.meta.url), 'utf8')
  assert.match(page, /Votre prestation a été réglée intégralement/)
  assert.match(page, /paidInFull \? 'Montant réglé :' : 'Arrhes réglées :'/)
  assert.match(page, /Paiement en ligne:/)
})
