/* global Buffer, process */

import { randomUUID } from 'node:crypto'

const SMOKE_KEY = 'FFkb308sA4pp8OYAuAykCe8s8ZhsPOFelPR32Tn5vtc'
const BASE = 'https://api-m.sandbox.paypal.com'
const CURRENCY = 'EUR'
const AMOUNT = '1.00'
const REFERENCE_ID = 'MEDIUMIA_CONFERENCE_PASS_SANDBOX'
const CUSTOM_ID = 'MEDIUMIA:conference-pass-2026-09-15-v1:PASS'

function validOrderId(value) {
  const orderId = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) throw new Error('invalid_order_id')
  return orderId
}

async function accessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !secret) throw new Error('paypal_not_configured')
  const response = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function fetchOrder(token, orderId) {
  const response = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error('paypal_order_fetch_failed')
  return data
}

function summary(data) {
  const unit = (data.purchase_units || []).find((entry) => entry.reference_id === REFERENCE_ID) || data.purchase_units?.[0]
  const capture = unit?.payments?.captures?.find((entry) => entry.status === 'COMPLETED')
  const approvalUrl = (data.links || []).find((link) => ['approve', 'payer-action'].includes(link.rel))?.href || null
  return {
    id: data.id,
    status: data.status,
    approvalUrl,
    captureId: capture?.id || null,
    amount: capture?.amount || unit?.amount || null,
    referenceId: unit?.reference_id || null,
    customId: unit?.custom_id || capture?.custom_id || null,
  }
}

export async function handleConferencePayPalSmoke(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (process.env.VERCEL_ENV === 'production') return res.status(404).json({ error: 'not_found' })
  if (String(req.query?.smokeKey || '') !== SMOKE_KEY) return res.status(404).json({ error: 'not_found' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  try {
    const action = String(req.query?.conferencePassSmokeAction || '')
    const token = await accessToken()

    if (action === 'create') {
      const response = await fetch(`${BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `conference-pass-smoke-${randomUUID()}`,
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: REFERENCE_ID,
            description: 'MediumIA — Test Pass Conférence',
            amount: { currency_code: CURRENCY, value: AMOUNT },
            custom_id: CUSTOM_ID,
          }],
          payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')
      return res.status(201).json(summary(data))
    }

    if (action === 'status') {
      return res.status(200).json(summary(await fetchOrder(token, validOrderId(req.query?.orderId))))
    }

    if (action === 'capture') {
      const orderId = validOrderId(req.query?.orderId)
      let order = await fetchOrder(token, orderId)
      if (order.status === 'APPROVED') {
        const response = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'PayPal-Request-Id': `conference-pass-smoke-capture-${orderId}`.slice(0, 108),
          },
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error('paypal_capture_failed')
        order = data
      }
      if (order.status !== 'COMPLETED') return res.status(409).json({ error: 'paypal_order_not_approved', ...summary(order) })
      return res.status(200).json(summary(order))
    }

    return res.status(400).json({ error: 'invalid_smoke_action' })
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'conference_paypal_smoke_failed' })
  }
}
