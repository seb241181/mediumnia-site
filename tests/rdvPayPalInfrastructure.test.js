/* global process */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  formatPayPalAmount,
  isActiveRdvPaymentHold,
  isPayableVideoService,
  rdvPayPalCustomId,
  runtimeRdvPayPalConfig,
} from '../lib/rdvPayPal.js'

const migrationPath = new URL('../supabase/migrations/20260903110000_add_rdv_paypal_holds.sql', import.meta.url)
const endpointPath = new URL('../api/rdv-paypal.js', import.meta.url)

test('un service visio instantané payable est le seul accepté', () => {
  const video = { booking_mode: 'instant', modality: ['video'], price_cents: 9000, currency: 'EUR' }
  assert.equal(isPayableVideoService(video), true)
  assert.equal(isPayableVideoService({ ...video, modality: ['in-person'] }), false)
  assert.equal(isPayableVideoService({ ...video, booking_mode: 'request' }), false)
})

test('le montant PayPal est dérivé des centimes serveur', () => {
  assert.equal(formatPayPalAmount(59700), '597.00')
  assert.equal(formatPayPalAmount(1), '0.01')
  assert.throws(() => formatPayPalAmount(0), /rdv_payment_amount_invalid/)
})

test('un hold expiré libère le créneau mais un hold capturé ne le libère jamais', () => {
  const now = Date.parse('2026-09-03T12:00:00Z')
  assert.equal(isActiveRdvPaymentHold({ status: 'payment_pending', expires_at: '2026-09-03T12:14:59Z' }, now), true)
  assert.equal(isActiveRdvPaymentHold({ status: 'payment_pending', expires_at: '2026-09-03T11:59:59Z' }, now), false)
  assert.equal(isActiveRdvPaymentHold({ status: 'payment_captured', expires_at: '2026-09-03T11:59:59Z' }, now), true)
})

test('la référence PayPal est déterministe pour reprendre le même checkout', () => {
  assert.equal(rdvPayPalCustomId('11111111-1111-4111-8111-111111111111'), 'MEDIUMIA:RDV:11111111-1111-4111-8111-111111111111')
})

test('la Production reste bloquée, même si le flag dédié est activé', () => {
  const previousEnv = process.env.VERCEL_ENV
  const previousEnabled = process.env.PAYPAL_RDV_ENABLED
  process.env.VERCEL_ENV = 'production'
  process.env.PAYPAL_RDV_ENABLED = 'true'
  try {
    assert.throws(() => runtimeRdvPayPalConfig(), /rdv_paypal_live_not_released/)
  } finally {
    if (previousEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previousEnv
    if (previousEnabled === undefined) delete process.env.PAYPAL_RDV_ENABLED
    else process.env.PAYPAL_RDV_ENABLED = previousEnabled
  }
})

test('la migration protège concurrence, holds, expiration et conversion unique', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const endpoint = await readFile(endpointPath, 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.rdv_booking_holds/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.rdv_paypal_payments/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(p_practitioner_id::text\)\)/)
  assert.match(sql, /create_rdv_payment_hold/)
  assert.match(sql, /create_booking reste le chemin normal non-PayPal/)
  assert.match(sql, /payment_pending'\s+AND h\.expires_at <= now\(\)/)
  assert.match(sql, /status IN \('payment_capturing', 'payment_captured'\)/)
  assert.match(sql, /converted_booking_id/)
  assert.match(sql, /paypal_order_id TEXT UNIQUE/)
  assert.match(sql, /paypal_capture_id TEXT UNIQUE/)
  assert.match(sql, /client_checkout_id UUID NOT NULL UNIQUE/)
  assert.match(endpoint, /\.select\('id, duration_min, price_cents, currency, modality, booking_mode, is_active'\)/)
  assert.doesNotMatch(endpoint, /req\.body\??\.price|req\.body\??\.amount/)
})
