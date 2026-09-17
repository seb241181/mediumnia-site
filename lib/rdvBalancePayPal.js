/* global process, Buffer */

const SANDBOX = {
  env: 'sandbox',
  base: 'https://api-m.sandbox.paypal.com',
  referenceId: 'MEDIUMIA_RDV_SOLDE_SANDBOX',
}

const LIVE = {
  env: 'live',
  base: 'https://api-m.paypal.com',
  referenceId: 'MEDIUMIA_RDV_SOLDE',
}

function formatAmount(cents) {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('rdv_balance_amount_invalid')
  return (cents / 100).toFixed(2)
}

export function runtimeRdvBalancePayPalConfig() {
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.PAYPAL_RDV_DEPOSIT_ENABLED !== 'true') throw new Error('rdv_balance_paypal_disabled')
    if (process.env.PAYPAL_RDV_DEPOSIT_ENV !== 'live') throw new Error('rdv_balance_paypal_live_not_configured')
    return LIVE
  }
  return SANDBOX
}

function credentials() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')
  return { clientId, clientSecret }
}

async function getAccessToken(cfg) {
  const { clientId, clientSecret } = credentials()
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
  const data = await response.json().catch(() => ({}))
  if (!data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

export async function rdvBalancePayPalConfig() {
  const cfg = runtimeRdvBalancePayPalConfig()
  const { clientId } = credentials()
  return { clientId, env: cfg.env, currency: 'EUR' }
}

export function rdvBalanceCustomId(bookingId) {
  return `MEDIUMIA:RDV-SOLDE:${bookingId}`
}

function isPreviousRequestInProgress(response, data) {
  return response?.status === 409 && (
    data?.name === 'PREVIOUS_REQUEST_IN_PROGRESS'
    || data?.details?.some(entry => entry?.issue === 'PREVIOUS_REQUEST_IN_PROGRESS')
  )
}

export async function createRdvBalancePayPalOrder({ bookingId, amountCents, currency, serviceTitle }) {
  const cfg = runtimeRdvBalancePayPalConfig()
  if (currency !== 'EUR') throw new Error('rdv_balance_currency_invalid')
  const accessToken = await getAccessToken(cfg)
  const requestId = `rdv-balance-create-${bookingId}`.slice(0, 108)
  const body = JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: cfg.referenceId,
      custom_id: rdvBalanceCustomId(bookingId),
      description: `MediumIA — Solde du rendez-vous${serviceTitle ? ` — ${serviceTitle}` : ''}`.slice(0, 127),
      amount: { currency_code: currency, value: formatAmount(amountCents) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      },
    },
  })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
      },
      body,
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.id) return { cfg, orderId: data.id }
    if (isPreviousRequestInProgress(response, data) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt)))
      continue
    }
    if (isPreviousRequestInProgress(response, data)) throw new Error('paypal_create_order_in_progress')
    throw new Error('paypal_create_order_failed')
  }
  throw new Error('paypal_create_order_failed')
}

async function fetchOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function captureRdvBalancePayPalOrder(orderId) {
  const cfg = runtimeRdvBalancePayPalConfig()
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rdv-balance-capture-${orderId}`.slice(0, 108),
    },
  })
  let data = await response.json().catch(() => ({}))
  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetchOrder(cfg, accessToken, orderId)
    if (!fetched.response.ok || fetched.data.status !== 'COMPLETED') throw new Error('paypal_capture_failed')
    data = fetched.data
  }
  return { cfg, data }
}

export function verifyRdvBalancePayPalPayment({ cfg, data, bookingId, amountCents, currency }) {
  const unit = (data.purchase_units || []).find(item => item.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find(item => item.status === 'COMPLETED')
  const expectedAmount = formatAmount(amountCents)

  if (!unit || !capture?.id || !data.id) throw new Error('paypal_payment_invalid')
  if (unit.custom_id != null && unit.custom_id !== rdvBalanceCustomId(bookingId)) throw new Error('paypal_custom_id_mismatch')
  if (capture.amount?.currency_code !== currency || capture.amount?.value !== expectedAmount) throw new Error('paypal_amount_mismatch')

  return {
    orderId: data.id,
    captureId: capture.id,
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}
