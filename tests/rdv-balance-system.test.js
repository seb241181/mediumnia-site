import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('balance schema is server-only and records a dedicated balance accounting entry', () => {
  const migration = read('supabase/migrations/20260917114500_rdv_balance_reminders_and_payment.sql')
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_cron/)
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_net/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.rdv_balance_payments/)
  assert.match(migration, /REVOKE ALL ON public\.rdv_balance_payments FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /'mediumia', 'balance', 'income', 'paypal'/)
  assert.match(migration, /starts_at - INTERVAL '48 hours'/)
  assert.match(migration, /mediumia-rdv-balance-hourly/)
})

test('balance capture and auto-cancel use database claims to avoid races', () => {
  const migration = read('supabase/migrations/20260917114800_rdv_balance_cancel_race_guard.sql')
  const foundation = read('supabase/migrations/20260917114500_rdv_balance_reminders_and_payment.sql')
  assert.match(foundation, /claim_rdv_balance_capture/)
  assert.match(foundation, /capture_in_progress/)
  assert.match(migration, /status IN \('captured', 'capture_in_progress'\)/)
  assert.match(migration, /balance_payment_in_progress/)
})

test('reminder claims are idempotent and use opaque token hashes', () => {
  const migration = read('supabase/migrations/20260917114600_rdv_balance_reminder_claims.sql')
  assert.match(migration, /claim_rdv_balance_reminder/)
  assert.match(migration, /balance_payment_token_hash/)
  assert.match(migration, /balance_reminder_sent_at IS NULL/)
  assert.match(migration, /GET DIAGNOSTICS v_count = ROW_COUNT/)
  assert.doesNotMatch(migration, /GET DIAGNOSTICS v_claimed = ROW_COUNT/)
})

test('balance PayPal helper is sandbox outside production and has separate identifiers', () => {
  const source = read('lib/rdvBalancePayPal.js')
  assert.match(source, /VERCEL_ENV === 'production'/)
  assert.match(source, /MEDIUMIA_RDV_SOLDE_SANDBOX/)
  assert.match(source, /MEDIUMIA_RDV_SOLDE'/)
  assert.match(source, /MEDIUMIA:RDV-SOLDE:/)
  assert.match(source, /PayPal-Request-Id/)
})

test('balance API exposes status create capture and authenticated sweep through rdv-config', () => {
  const route = read('api/rdv-config.js')
  const handler = read('lib/rdvBalanceApiHandler.js')
  assert.match(route, /rdvBalanceAction/)
  assert.match(route, /handleRdvBalanceApi/)
  assert.match(handler, /action === 'status'/)
  assert.match(handler, /action === 'create'/)
  assert.match(handler, /action === 'capture'/)
  assert.match(handler, /action === 'sweep'/)
  assert.match(handler, /claim_rdv_balance_sweep_token/)
  assert.match(handler, /processAutoCancel/)
})

test('public balance page keeps its token in the URL fragment and posts it to the API', () => {
  const page = read('public/rdv-solde.html')
  const vercel = read('vercel.json')
  assert.match(page, /window\.location\.hash/)
  assert.match(page, /history\.replaceState/)
  assert.match(page, /rdvBalanceAction=/)
  assert.match(page, /method:'POST'/)
  assert.match(page, /Régler mon solde/)
  assert.match(page, /automatiquement annulé/)
  assert.match(vercel, /"source": "\/rdv\/solde"/)
  assert.match(vercel, /"destination": "\/rdv-solde\.html"/)
})

test('video deposits inside 48 hours are forced to full payment and confirmations explain the deadline', () => {
  const patch = read('scripts/apply-rdv-balance-system.mjs')
  const email = read('lib/rdvDepositConfirmationEmail.js')
  assert.match(patch, /balance_requires_full_payment/)
  assert.match(patch, /48 \* 3_600_000/)
  assert.match(patch, /fullPaymentRequired/)
  assert.match(email, /enverra un rappel avec un lien de paiement sécurisé environ 72 heures/)
  assert.match(email, /au plus tard 48 heures avant la séance/)
})
