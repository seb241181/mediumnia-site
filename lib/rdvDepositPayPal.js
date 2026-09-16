/* global process, Buffer */

const SANDBOX = {
  env: 'sandbox',
  base: 'https://api-m.sandbox.paypal.com',
  referenceId: 'MEDIUMIA_RDV_ARRHES_SANDBOX',
}

const LIVE = {
  env: 'live',
  base: 'https://api-m.paypal.com',
  referenceId: 'MEDIUMIA_RDV_ARRHES',
}

export function formatRdvDepositAmount(cents) {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('rdv_deposit_amount_invalid')
  return (cents / 100).toFixed(2)
}

export function isPayableDepositService(service, selectedModality) {
  return service?.booking_mode === 'instant'
    && service?.reservation_payment_kind === 'arrhes'
    && Number.isInteger(service?.reservation_payment_cents)
    && service.reservation_payment_cents > 0
    && Number.isInteger(service?.price_cents)
    && service.price_cents >= service.reservation_payment_cents
    && service.currency === 'EUR'
    && ['video', 'in-person'].includes(selectedModality)
    && Array.isArray(service?.modality)
    && service.modality.includes(selectedModality)
}

export function runtimeRdvDepositPayPalConfig() {
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.PAYPAL_RDV_DEPOSIT_ENABLED !== 'true') throw new Error('rdv_deposit_paypal_disabled')
    if (process.env.PAYPAL_RDV_DEPOSIT_ENV !== 'live') throw new Error('rdv_deposit_paypal_live_not_configured')
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

export function rdvDepositCustomId(holdId) {
  return `MEDIUMIA:RDV-ARRHES:${holdId}`
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

export async function rdvDepositPayPalConfig() {
  const cfg = runtimeRdvDepositPayPalConfig()
  const { clientId } = credentials()
  return { clientId, env: cfg.env, currency: 'EUR' }
}

export async function createRdvDepositPayPalOrder({ holdId, amountCents, currency, serviceTitle }) {
  const cfg = runtimeRdvDepositPayPalConfig()
  if (currency !== 'EUR') throw new Error('rdv_deposit_currency_invalid')
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rdv-deposit-create-${holdId}`.slice(0, 108),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: cfg.referenceId,
        custom_id: rdvDepositCustomId(holdId),
        description: `MediumIA — Arrhes de réservation${serviceTitle ? ` — ${serviceTitle}` : ''}`.slice(0, 127),
        amount: { currency_code: currency, value: formatRdvDepositAmount(amountCents) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
        },
      },
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')
  return { cfg, orderId: data.id }
}

async function fetchOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

export async function captureRdvDepositPayPalOrder(orderId) {
  const cfg = runtimeRdvDepositPayPalConfig()
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rdv-deposit-capture-${orderId}`.slice(0, 108),
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

export function verifyRdvDepositPayPalPayment({ cfg, data, holdId, amountCents, currency }) {
  const unit = (data.purchase_units || []).find(item => item.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find(item => item.status === 'COMPLETED')
  const expectedAmount = formatRdvDepositAmount(amountCents)

  if (!unit || !capture?.id || !data.id) throw new Error('paypal_payment_invalid')
  if (unit.custom_id != null && unit.custom_id !== rdvDepositCustomId(holdId)) throw new Error('paypal_custom_id_mismatch')
  if (capture.amount?.currency_code !== currency || capture.amount?.value !== expectedAmount) throw new Error('paypal_amount_mismatch')

  return {
    orderId: data.id,
    captureId: capture.id,
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}
