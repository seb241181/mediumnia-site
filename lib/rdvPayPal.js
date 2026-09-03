/* global process, Buffer */

const SANDBOX = {
  env: 'sandbox',
  base: 'https://api-m.sandbox.paypal.com',
  referenceId: 'MEDIUMIA_RDV_VISIO_SANDBOX',
}

export function formatPayPalAmount(cents) {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('rdv_payment_amount_invalid')
  return (cents / 100).toFixed(2)
}

export function isPayableVideoService(service, selectedModality = 'video') {
  return service?.booking_mode === 'instant'
    && selectedModality === 'video'
    && Array.isArray(service?.modality)
    && service.modality.includes('video')
    && Number.isInteger(service?.price_cents)
    && service.price_cents > 0
    && service.currency === 'EUR'
}

export function runtimeRdvPayPalConfig() {
  if (process.env.VERCEL_ENV === 'production') {
    if (process.env.PAYPAL_RDV_ENABLED !== 'true') throw new Error('rdv_paypal_disabled')

    // Live remains deliberately unavailable until the dedicated production rollout.
    throw new Error('rdv_paypal_live_not_released')
  }

  return SANDBOX
}

function credentials() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')
  return { clientId, clientSecret }
}

export function rdvPayPalCustomId(holdId) {
  return `MEDIUMIA:RDV:${holdId}`
}

export function isActiveRdvPaymentHold(hold, now = Date.now()) {
  if (hold?.status === 'payment_captured' || hold?.status === 'payment_capturing') return true
  return hold?.status === 'payment_pending' && new Date(hold.expires_at).getTime() > now
}

export function hasCompetingRdvSlot({ currentHoldId, startsAt, endsAt, holds = [], bookings = [], now = Date.now(), bufferBeforeMin = 0, bufferAfterMin = 0 }) {
  const beforeMs = bufferBeforeMin * 60_000
  const afterMs = bufferAfterMin * 60_000
  const overlaps = item => new Date(item.starts_at).getTime() - beforeMs < new Date(endsAt).getTime() + afterMs
    && new Date(item.ends_at).getTime() + afterMs > new Date(startsAt).getTime() - beforeMs

  return bookings.some(booking => booking.status === 'confirmed' && overlaps(booking))
    || holds.some(hold => hold.id !== currentHoldId && isActiveRdvPaymentHold(hold, now) && overlaps(hold))
}

export function countRdvDayUsage({ currentHoldId, dayStart, dayEnd, holds = [], bookings = [], now = Date.now() }) {
  const isInDay = item => new Date(item.starts_at).getTime() >= new Date(dayStart).getTime()
    && new Date(item.starts_at).getTime() < new Date(dayEnd).getTime()
  return bookings.filter(booking => booking.status === 'confirmed' && isInDay(booking)).length
    + holds.filter(hold => hold.id !== currentHoldId && isActiveRdvPaymentHold(hold, now) && isInDay(hold)).length
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
  const data = await response.json()
  if (!data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

export async function paypalRdvConfig() {
  const cfg = runtimeRdvPayPalConfig()
  const { clientId } = credentials()
  return { clientId, env: cfg.env, currency: 'EUR' }
}

export async function createRdvPayPalOrder({ holdId, amountCents, currency }) {
  const cfg = runtimeRdvPayPalConfig()
  if (currency !== 'EUR') throw new Error('rdv_payment_currency_invalid')
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rdv-create-${holdId}`.slice(0, 108),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: cfg.referenceId,
        custom_id: rdvPayPalCustomId(holdId),
        description: 'MediumIA — Rendez-vous visio',
        amount: { currency_code: currency, value: formatPayPalAmount(amountCents) },
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

export async function captureRdvPayPalOrder(orderId) {
  const cfg = runtimeRdvPayPalConfig()
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rdv-capture-${orderId}`.slice(0, 108),
    },
  })
  let data = await response.json().catch(() => ({}))
  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetchOrder(cfg, accessToken, orderId)
    if (!fetched.response.ok || fetched.data.status !== 'COMPLETED') {
      throw new Error('paypal_capture_failed')
    }
    data = fetched.data
  }
  return { cfg, data }
}

export function verifyRdvPayPalPayment({ cfg, data, holdId, amountCents, currency }) {
  const unit = (data.purchase_units || []).find(unit => unit.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find(item => item.status === 'COMPLETED')
  const expectedAmount = formatPayPalAmount(amountCents)

  if (!unit || !capture?.id || data.id == null) throw new Error('paypal_payment_invalid')
  if (unit.custom_id != null && unit.custom_id !== rdvPayPalCustomId(holdId)) {
    throw new Error('paypal_custom_id_mismatch')
  }
  if (capture.amount?.currency_code !== currency || capture.amount?.value !== expectedAmount) {
    throw new Error('paypal_amount_mismatch')
  }

  return {
    orderId: data.id,
    captureId: capture.id,
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}
