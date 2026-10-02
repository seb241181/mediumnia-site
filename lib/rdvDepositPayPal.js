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

export function rdvDepositCreateRequestId(holdId) {
  return `rdv-deposit-create-${holdId}`.slice(0, 108)
}

function isPreviousPaypalRequestInProgress(response, data) {
  return response?.status === 409 && (
    data?.name === 'PREVIOUS_REQUEST_IN_PROGRESS'
    || data?.details?.some((entry) => entry?.issue === 'PREVIOUS_REQUEST_IN_PROGRESS')
  )
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

export async function createRdvDepositPayPalOrder({ holdId, amountCents, currency, serviceTitle, paymentOption = 'deposit' }) {
  const cfg = runtimeRdvDepositPayPalConfig()
  if (currency !== 'EUR') throw new Error('rdv_deposit_currency_invalid')
  if (!['deposit', 'full'].includes(paymentOption)) throw new Error('rdv_payment_option_invalid')
  const accessToken = await getAccessToken(cfg)
  const requestId = rdvDepositCreateRequestId(holdId)
  const paymentLabel = paymentOption === 'full' ? 'Paiement intégral' : 'Arrhes de réservation'
  const body = JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: cfg.referenceId,
      custom_id: rdvDepositCustomId(holdId),
      description: `MediumIA — ${paymentLabel}${serviceTitle ? ` — ${serviceTitle}` : ''}`.slice(0, 127),
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

    if (isPreviousPaypalRequestInProgress(response, data) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt)))
      continue
    }
    if (isPreviousPaypalRequestInProgress(response, data)) throw new Error('paypal_create_order_in_progress')
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

// ── Remboursements (admin) ──────────────────────────────────────────────────
//
// Environnement déduit du déploiement, jamais du client : la Preview ne parle
// qu'à la sandbox, la production qu'au live. En production, un interrupteur
// explicite (PAYPAL_RDV_REFUNDS_ENABLED=true) est en plus exigé.
export function runtimeRdvRefundPayPalConfig(env = process.env) {
  if (env.VERCEL_ENV === 'production') {
    if (env.PAYPAL_RDV_REFUNDS_ENABLED !== 'true') throw new Error('rdv_refunds_disabled')
    if (env.PAYPAL_RDV_DEPOSIT_ENV !== 'live') throw new Error('rdv_deposit_paypal_live_not_configured')
    return LIVE
  }
  return SANDBOX
}

export function rdvRefundCustomId(refundId) {
  return `MEDIUMIA:RDV-REFUND:${refundId}`
}

const REFUND_TIMEOUT_MS = 15_000
// Réponses 422 qui signifient « déjà remboursé chez PayPal » : on réconcilie.
const ALREADY_REFUNDED_ISSUES = new Set(['CAPTURE_FULLY_REFUNDED', 'REFUND_AMOUNT_EXCEEDED', 'REFUND_CAPTURE_CURRENCY_MISMATCH_FULLY_REFUNDED'])

function issueCode(data, httpStatus) {
  const raw = data?.details?.[0]?.issue || data?.name || `paypal_http_${httpStatus}`
  return /^[A-Za-z0-9_]{1,64}$/.test(raw) ? raw : `paypal_http_${httpStatus}`
}

function refundOutcome(status) {
  if (status === 'COMPLETED') return 'completed'
  if (status === 'PENDING') return 'pending'
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed'
  return 'unknown'
}

export { refundOutcome as rdvRefundOutcome }

// Un seul appel POST. Ne relance jamais tout seul : toute réponse ambiguë
// (délai, coupure, 5xx, 409) donne « unknown » et passe par la réconciliation.
export async function refundRdvDepositCapture({ cfg, captureId, amountCents, requestId, refundId }) {
  let accessToken
  try {
    accessToken = await getAccessToken(cfg)
  } catch {
    return { outcome: 'failed', errorCode: 'paypal_auth_failed', sent: false }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFUND_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${cfg.base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        amount: { currency_code: 'EUR', value: formatRdvDepositAmount(amountCents) },
        custom_id: rdvRefundCustomId(refundId),
        note_to_payer: 'Remboursement de vos arrhes MediumIA',
      }),
      signal: controller.signal,
    })
  } catch {
    return { outcome: 'unknown', errorCode: 'paypal_network_error', sent: true }
  } finally {
    clearTimeout(timer)
  }
  const data = await response.json().catch(() => null)
  if (response.ok) {
    if (!data?.id) return { outcome: 'unknown', errorCode: 'paypal_response_unreadable', sent: true }
    return { outcome: refundOutcome(data.status), paypalRefundId: data.id, paypalStatus: data.status || null, sent: true }
  }
  const code = issueCode(data, response.status)
  if (response.status >= 500 || [408, 409, 429].includes(response.status)) return { outcome: 'unknown', errorCode: code, sent: true }
  if (ALREADY_REFUNDED_ISSUES.has(code)) return { outcome: 'already_refunded', errorCode: code, sent: true }
  return { outcome: 'failed', errorCode: code, sent: true }
}

// Lecture de l'ordre PayPal : captures et remboursements réellement enregistrés.
export async function fetchRdvDepositOrder({ cfg, orderId }) {
  const accessToken = await getAccessToken(cfg)
  const { response, data } = await fetchOrder(cfg, accessToken, orderId)
  if (!response.ok || !data?.id) throw new Error('paypal_lookup_failed')
  return data
}

export async function fetchRdvRefund({ cfg, paypalRefundId }) {
  const accessToken = await getAccessToken(cfg)
  const response = await fetch(`${cfg.base}/v2/payments/refunds/${encodeURIComponent(paypalRefundId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.id) throw new Error('paypal_lookup_failed')
  return data
}
