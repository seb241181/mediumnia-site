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

// Délai maximal d'un appel PayPal : jamais de fonction bloquée sans réponse.
const PAYPAL_TIMEOUT_MS = 15_000
const withTimeout = (options = {}, timeoutMs = PAYPAL_TIMEOUT_MS) => ({ ...options, signal: AbortSignal.timeout(timeoutMs) })

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

async function getAccessToken(cfg, timeoutMs) {
  const { clientId, clientSecret } = credentials()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${cfg.base}/v1/oauth2/token`, withTimeout({
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  }, timeoutMs))
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

function balanceCheckoutBaseUrl() {
  if (process.env.VERCEL_ENV === 'preview') {
    const previewHost = String(process.env.VERCEL_URL || process.env.VERCEL_BRANCH_URL || '').trim()
    if (previewHost) return `https://${previewHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  }
  const configured = String(process.env.BOOKING_PUBLIC_URL || '').trim().replace(/\/$/, '')
  return configured || 'https://mediumia.fr'
}

export function rdvBalanceHostedApprovalUrl(orderId, env = runtimeRdvBalancePayPalConfig().env) {
  const host = env === 'sandbox' ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com'
  return `${host}/checkoutnow?token=${encodeURIComponent(orderId)}`
}

function isPreviousRequestInProgress(response, data) {
  return response?.status === 409 && (
    data?.name === 'PREVIOUS_REQUEST_IN_PROGRESS'
    || data?.details?.some(entry => entry?.issue === 'PREVIOUS_REQUEST_IN_PROGRESS')
  )
}

// Clé d'idempotence de création : déterministe, donc deux clics simultanés
// obtiennent LA MÊME commande ; mais propre au montant et à la commande
// remplacée, donc jamais le rejeu d'une commande périmée ou d'un ancien montant.
export function rdvBalanceCreateRequestId({ paymentId, amountCents, replacesOrderId = null }) {
  return `rdv-balance-create-${paymentId}-${amountCents}-${replacesOrderId || 'first'}`.slice(0, 108)
}

// Seules les pages PayPal sont acceptées comme destination de paiement.
function safeApprovalUrl(data, cfg) {
  const href = data?.links?.find(link => ['payer-action', 'approve'].includes(link?.rel))?.href
  const host = cfg.env === 'sandbox' ? 'https://www.sandbox.paypal.com/' : 'https://www.paypal.com/'
  return typeof href === 'string' && href.startsWith(host) ? href : rdvBalanceHostedApprovalUrl(data.id, cfg.env)
}

export async function createRdvBalancePayPalOrder({ bookingId, paymentId, amountCents, currency, serviceTitle, replacesOrderId = null }) {
  const cfg = runtimeRdvBalancePayPalConfig()
  if (currency !== 'EUR') throw new Error('rdv_balance_currency_invalid')
  const value = formatAmount(amountCents)
  const accessToken = await getAccessToken(cfg)
  const requestId = rdvBalanceCreateRequestId({ paymentId, amountCents, replacesOrderId })
  const checkoutBase = balanceCheckoutBaseUrl()
  const returnUrl = `${checkoutBase}/rdv/solde?balance_return=1`
  const cancelUrl = `${checkoutBase}/rdv/solde?balance_cancel=1`
  const body = JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: cfg.referenceId,
      custom_id: rdvBalanceCustomId(bookingId),
      description: `MediumIA — Solde du rendez-vous${serviceTitle ? ` — ${serviceTitle}` : ''}`.slice(0, 127),
      amount: { currency_code: currency, value },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${cfg.base}/v2/checkout/orders`, withTimeout({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
      },
      body,
    }))
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.id) {
      if (data.id === replacesOrderId) throw new Error('paypal_create_order_failed')
      return { cfg, orderId: data.id, approveUrl: safeApprovalUrl(data, cfg) }
    }
    if (isPreviousRequestInProgress(response, data) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 200 * (2 ** attempt)))
      continue
    }
    if (isPreviousRequestInProgress(response, data)) throw new Error('paypal_create_order_in_progress')
    throw new Error('paypal_create_order_failed')
  }
  throw new Error('paypal_create_order_failed')
}

// Lecture seule : état réel de la commande chez PayPal, jamais de capture.
export async function inspectRdvBalancePayPalOrder(orderId, { timeoutMs } = {}) {
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(String(orderId || ''))) throw new Error('invalid_paypal_order')
  const cfg = runtimeRdvBalancePayPalConfig()
  let response
  let data
  try {
    const accessToken = await getAccessToken(cfg, timeoutMs)
    response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, withTimeout({
      headers: { Authorization: `Bearer ${accessToken}` },
    }, timeoutMs))
    data = await response.json().catch(() => ({}))
  } catch {
    throw new Error('paypal_order_status_unavailable')
  }
  if (response.status === 404) return { cfg, status: 'NOT_FOUND', data: null, approveUrl: null }
  if (!response.ok || data.id !== orderId || typeof data.status !== 'string') throw new Error('paypal_order_status_unavailable')
  return { cfg, status: data.status, data, approveUrl: safeApprovalUrl(data, cfg) }
}

// Ce que l'état PayPal permet de conclure, SANS rien supposer :
//   payable      : rien d'encaissé, le client peut encore payer cette commande
//   approved     : validée par le client, pas encore encaissée
//   captured     : encaissée, montant et devise exacts
//   pending      : encaissement en attente chez PayPal
//   declined     : encaissement refusé, rien de pris
//   gone         : commande expirée ou annulée chez PayPal
//   wrong_amount : rien d'encaissé, mais la commande porte un autre montant
//   uncertain    : tout le reste (à vérifier par un humain)
export function classifyRdvBalanceOrder(order, { bookingId, amountCents, currency }) {
  if (order.status === 'NOT_FOUND') return 'gone'
  const units = order.data?.purchase_units || []
  const unit = units.find(item => item.reference_id === order.cfg.referenceId)
  if (units.length !== 1 || !unit) return 'uncertain'
  if (unit.custom_id != null && unit.custom_id !== rdvBalanceCustomId(bookingId)) return 'uncertain'

  const captures = unit.payments?.captures || []
  const others = [...(unit.payments?.authorizations || []), ...(unit.payments?.refunds || [])]
  const exact = amount => amount?.currency_code === currency && amount?.value === formatAmount(amountCents)
  if (captures.length || others.length || order.status === 'COMPLETED') {
    if (others.length || !captures.length) return 'uncertain'
    if (captures.every(item => ['DECLINED', 'FAILED'].includes(item.status))) return 'declined'
    const live = captures.filter(item => !['DECLINED', 'FAILED'].includes(item.status))
    if (live.length !== 1 || !exact(live[0].amount)) return 'uncertain'
    if (live[0].status === 'PENDING') return 'pending'
    return live[0].status === 'COMPLETED' ? 'captured' : 'uncertain'
  }

  if (order.status === 'VOIDED') return 'gone'
  if (!['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order.status)) return 'uncertain'
  if (unit.custom_id == null) return 'uncertain'
  if (!exact(unit.amount)) return 'wrong_amount'
  return order.status === 'APPROVED' ? 'approved' : 'payable'
}

const NOT_APPROVED_ISSUES = new Set(['ORDER_NOT_APPROVED', 'ORDER_EXPIRED', 'PAYER_ACTION_REQUIRED'])
const DECLINED_ISSUES = new Set(['INSTRUMENT_DECLINED', 'PAYER_CANNOT_PAY', 'TRANSACTION_REFUSED', 'PAYER_ACCOUNT_LOCKED_OR_CLOSED', 'PAYER_ACCOUNT_RESTRICTED', 'REDIRECT_PAYER_FOR_ALTERNATE_FUNDING', 'CARD_EXPIRED'])

// Encaisse une commande DÉJÀ vérifiée comme « approved ». L'issue vient toujours
// d'une relecture de la commande, jamais de la seule réponse de capture.
// PayPal n'encaisse qu'une fois une commande CAPTURE ; la clé d'idempotence est
// propre à l'approbation, pour qu'un refus bancaire ne soit pas rejoué après que
// le client a choisi un autre moyen de paiement.
export async function captureRdvBalancePayPalOrder(orderId, { approvedAt = '' } = {}) {
  const cfg = runtimeRdvBalancePayPalConfig()
  const accessToken = await getAccessToken(cfg)
  const stamp = String(approvedAt || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 24)
  let issue = null
  try {
    const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, withTimeout({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `rdv-balance-capture-${orderId}${stamp ? `-${stamp}` : ''}`.slice(0, 108),
      },
    }))
    const data = await response.json().catch(() => ({}))
    // Seule une réponse 422 motivée est un refus certain.
    if (response.status === 422) issue = data?.details?.[0]?.issue || null
  } catch {
    // Aucune réponse : issue inconnue, la relecture de la commande tranchera.
  }
  const refusal = NOT_APPROVED_ISSUES.has(issue) ? 'paypal_approval_expired'
    : DECLINED_ISSUES.has(issue) ? 'paypal_payment_declined' : null
  return { refusal, issue }
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
