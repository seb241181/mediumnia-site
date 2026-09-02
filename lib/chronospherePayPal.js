/* global process */
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const CONSENT_VERSION = 'chronosphere-2026-09-02-v1'
const EXPECTED_CUSTOM_ID = `MEDIUMIA:${CONSENT_VERSION}:CHRONOSPHERE`

const CONFIGS = {
  sandbox: {
    base: 'https://api-m.sandbox.paypal.com',
    amount: '1.00',
    currency: 'EUR',
    referenceId: 'MEDIUMIA_CHRONO_SANDBOX',
    description: 'CHRONOSPHERE 999 — test Sandbox',
  },
  live: {
    base: 'https://api-m.paypal.com',
    amount: '5.00',
    currency: 'EUR',
    referenceId: 'MEDIUMIA_CHRONOSPHERE_5',
    description: 'CHRONOSPHERE 999 — Tirage Oracle des Lignes de Temps',
  },
}

function cents(value) {
  if (!/^\d+\.\d{2}$/.test(String(value || ''))) return null
  return Math.round(Number(value) * 100)
}

function runtimeConfig() {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const env = isProduction ? 'live' : 'sandbox'
  if (isProduction && process.env.PAYPAL_CHRONOSPHERE_ENABLED !== 'true') {
    throw new Error('chronosphere_paypal_disabled')
  }
  return { env, ...CONFIGS[env] }
}

async function getAccessToken(cfg) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) throw new Error('paypal_auth_failed')
  const data = await response.json()
  if (!data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function captureOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `chrono-capture-${orderId}`.slice(0, 108),
    },
  })
  let data = await response.json().catch(() => ({}))

  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const fetchedData = await fetched.json().catch(() => ({}))
    if (!fetched.ok || fetchedData.status !== 'COMPLETED') {
      throw new Error('paypal_capture_failed')
    }
    data = fetchedData
  }

  return data
}

function verifiedPayment(cfg, data) {
  const unit = (data.purchase_units || []).find((u) => u.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find((c) => c.status === 'COMPLETED')

  if (!unit || !capture?.id) throw new Error('paypal_payment_invalid')
  if (capture.amount?.currency_code !== cfg.currency || capture.amount?.value !== cfg.amount) {
    throw new Error('paypal_amount_mismatch')
  }
  if (unit.custom_id !== EXPECTED_CUSTOM_ID) {
    throw new Error('paypal_consent_mismatch')
  }

  return {
    orderId: data.id,
    captureId: capture.id,
    amount: capture.amount,
    amountCents: cents(capture.amount.value),
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}

function generateDrawToken() {
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

export async function handleChronospherePayPal(req, res, action) {
  let cfg
  try {
    cfg = runtimeConfig()
  } catch (error) {
    if (error?.message === 'chronosphere_paypal_disabled') {
      return res.status(404).json({ error: 'not_found' })
    }
    return res.status(503).json({ error: error?.message || 'paypal_unavailable' })
  }

  if (action === 'config') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
    if (!clientId) return res.status(500).json({ error: 'paypal_not_configured' })
    return res.status(200).json({
      clientId,
      amount: cfg.amount,
      currency: cfg.currency,
      env: cfg.env,
      consentVersion: CONSENT_VERSION,
    })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    if (req.body?.consentAccepted !== true) {
      return res.status(400).json({ error: 'consent_required' })
    }
    if (!isSupabaseConfigured()) {
      return res.status(500).json({ error: 'supabase_not_configured' })
    }

    try {
      const accessToken = await getAccessToken(cfg)
      const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': randomUUID(),
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: cfg.referenceId,
            description: cfg.description,
            amount: { currency_code: cfg.currency, value: cfg.amount },
            custom_id: EXPECTED_CUSTOM_ID,
          }],
          payment_source: {
            paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } },
          },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')

      const draw = generateDrawToken()
      const supabase = getSupabaseAdmin()

      const { error: insertError } = await supabase
        .from('chronosphere_paid_draws')
        .insert({
          draw_token_hash: draw.hash,
          paypal_order_id: data.id,
          paypal_env: cfg.env,
          amount_cents: cents(cfg.amount),
          currency: cfg.currency,
          consent_version: CONSENT_VERSION,
          consent_accepted_at: new Date().toISOString(),
          status: 'payment_pending',
        })

      if (insertError) {
        console.error('[chronosphere-paypal] draw insert failed:', insertError.code)
        throw new Error('draw_insert_failed')
      }

      return res.status(201).json({ id: data.id, drawToken: draw.token })
    } catch (error) {
      const code = error?.message || 'paypal_create_order_failed'
      return res.status(code === 'paypal_not_configured' || code === 'supabase_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'capture') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) {
      return res.status(400).json({ error: 'invalid_order_id' })
    }
    if (!isSupabaseConfigured()) {
      return res.status(500).json({ error: 'supabase_not_configured' })
    }

    try {
      const accessToken = await getAccessToken(cfg)
      const completedOrder = await captureOrder(cfg, accessToken, orderId)
      const payment = verifiedPayment(cfg, completedOrder)

      const supabase = getSupabaseAdmin()

      const { data: updated, error: updateError } = await supabase
        .from('chronosphere_paid_draws')
        .update({
          status: 'ready',
          paypal_capture_id: payment.captureId,
          captured_at: payment.capturedAt,
        })
        .eq('paypal_order_id', payment.orderId)
        .eq('status', 'payment_pending')
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('[chronosphere-paypal] capture update failed:', updateError.message)
        throw new Error('capture_update_failed')
      }

      if (!updated) {
        const { data: existing } = await supabase
          .from('chronosphere_paid_draws')
          .select('id, status')
          .eq('paypal_order_id', payment.orderId)
          .maybeSingle()

        if (!existing) throw new Error('draw_not_found')
      }

      return res.status(200).json({
        status: 'COMPLETED',
        orderId: payment.orderId,
        captureId: payment.captureId,
        amount: payment.amount,
      })
    } catch (error) {
      const code = error?.message || 'paypal_capture_failed'
      console.error('[chronosphere-paypal] capture failed:', code)
      return res.status(code === 'paypal_not_configured' || code === 'supabase_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  return res.status(400).json({ error: 'invalid_chronosphere_paypal_action' })
}
