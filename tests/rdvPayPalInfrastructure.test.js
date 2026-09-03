/* global process */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  formatPayPalAmount,
  hasCompetingRdvSlot,
  isActiveRdvPaymentHold,
  isPayableVideoService,
  rdvPayPalCustomId,
  runtimeRdvPayPalConfig,
  verifyRdvPayPalPayment,
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

const slotStart = '2026-09-15T12:00:00.000Z'
const slotEnd = '2026-09-15T13:00:00.000Z'
const now = Date.parse('2026-09-03T12:00:00Z')
const expiredHold = { id: 'hold-a', status: 'payment_pending', starts_at: slotStart, ends_at: slotEnd, expires_at: '2026-09-03T11:59:59Z' }
const activeHold = { id: 'hold-b', status: 'payment_pending', starts_at: slotStart, ends_at: slotEnd, expires_at: '2026-09-03T12:15:00Z' }

test('cas A: un hold expiré ne peut pas reprendre la capture si un autre hold est actif', () => {
  assert.equal(hasCompetingRdvSlot({
    currentHoldId: expiredHold.id, startsAt: slotStart, endsAt: slotEnd, holds: [expiredHold, activeHold], now,
  }), true)
})

test('cas B: un hold expiré peut être repris si le créneau est encore libre', () => {
  assert.equal(hasCompetingRdvSlot({
    currentHoldId: expiredHold.id, startsAt: slotStart, endsAt: slotEnd, holds: [expiredHold], now,
  }), false)
})

test('cas C: deux holds différents du même créneau se détectent mutuellement avant conversion', () => {
  const firstActiveHold = { ...expiredHold, status: 'payment_capturing', expires_at: '2026-09-03T12:15:00Z' }
  assert.equal(hasCompetingRdvSlot({
    currentHoldId: firstActiveHold.id, startsAt: slotStart, endsAt: slotEnd, holds: [firstActiveHold, activeHold], now,
  }), true)
  assert.equal(hasCompetingRdvSlot({
    currentHoldId: activeHold.id, startsAt: slotStart, endsAt: slotEnd, holds: [firstActiveHold, activeHold], now,
  }), true)
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

function completedPayPalOrder(customId) {
  const unit = {
    reference_id: 'MEDIUMIA_RDV_VISIO_SANDBOX',
    payments: { captures: [{ id: 'capture-123', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '90.00' } }] },
  }
  if (customId !== undefined) unit.custom_id = customId
  return { id: 'order-123', purchase_units: [unit] }
}

test('cas D: une réponse PayPal valide sans custom_id reste acceptable', () => {
  const result = verifyRdvPayPalPayment({
    cfg: { referenceId: 'MEDIUMIA_RDV_VISIO_SANDBOX' },
    data: completedPayPalOrder(),
    holdId: 'hold-123',
    amountCents: 9000,
    currency: 'EUR',
  })
  assert.equal(result.captureId, 'capture-123')
})

test('cas E: un custom_id PayPal présent mais incorrect est rejeté', () => {
  assert.throws(() => verifyRdvPayPalPayment({
    cfg: { referenceId: 'MEDIUMIA_RDV_VISIO_SANDBOX' },
    data: completedPayPalOrder('MEDIUMIA:RDV:other-hold'),
    holdId: 'hold-123',
    amountCents: 9000,
    currency: 'EUR',
  }), /paypal_custom_id_mismatch/)
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
  assert.match(sql, /h\.id <> v_hold\.id/)
  assert.match(endpoint, /\.select\('id, duration_min, price_cents, currency, modality, booking_mode, is_active'\)/)
  assert.doesNotMatch(endpoint, /req\.body\??\.price|req\.body\??\.amount/)
})

test('cas F: le quota create précède le hold et la création de commande PayPal', async () => {
  const endpoint = await readFile(endpointPath, 'utf8')
  const rateLimit = endpoint.indexOf('if (await checkRdvPaypalCreateRateLimit(req, res, supabase)) return')
  const createHold = endpoint.indexOf(".rpc('create_rdv_payment_hold'")
  const createOrder = endpoint.indexOf('createRdvPayPalOrder({')
  assert.ok(rateLimit > -1 && rateLimit < createHold && rateLimit < createOrder)
  assert.match(endpoint, /p_endpoint: 'rdv_paypal_create'/)
  assert.match(endpoint, /p_hourly_limit: RDV_PAYPAL_HOURLY_LIMIT/)
  assert.match(endpoint, /p_daily_limit: RDV_PAYPAL_DAILY_LIMIT/)
})
