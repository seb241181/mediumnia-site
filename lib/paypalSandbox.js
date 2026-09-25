/* global Buffer, process */

import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'
import { pathEnv, settlePathAfterFullPurchase } from './formationPath.js'

let supabaseOverride = null
const db = () => supabaseOverride || getSupabaseAdmin()
const dbReady = () => !!supabaseOverride || isSupabaseConfigured()

const TERMS_VERSION = 'formation-2026-09-01-v1'
const TERMS_CUSTOM_ID = `MEDIUMIA:${TERMS_VERSION}:IMMEDIATE_ACCESS`
const PDF_DELIVERY_DAYS = 30

const PRODUCTS = {
  full: {
    accessLevel: 'full',
    maxModule: 25,
    durationDays: 365,
    upgradeCreditCents: 0,
    sandbox: {
      amount: '1.00',
      displayAmount: '597.00',
      referenceId: 'MEDIUMIA_FORMATION_SANDBOX',
      description: 'MediumIA — test Sandbox avec accès élève complet',
    },
    live: {
      amount: '597.00',
      displayAmount: '597.00',
      referenceId: 'MEDIUMIA_FORMATION_597',
      description: 'MediumIA — Accompagnement à la Médiumnité Consciente',
    },
  },
  discovery: {
    accessLevel: 'discovery',
    maxModule: 1,
    durationDays: 30,
    upgradeCreditCents: 2900,
    sandbox: {
      amount: '1.00',
      displayAmount: '29.00',
      referenceId: 'MEDIUMIA_DISCOVERY_SANDBOX',
      description: 'MediumIA — Édition Découverte (30 jours)',
    },
    live: {
      amount: '29.00',
      displayAmount: '29.00',
      referenceId: 'MEDIUMIA_DISCOVERY_29',
      description: 'MediumIA — Édition Découverte (30 jours)',
    },
  },
}

// Découverte déjà payée : 29 € déduits une seule fois de la Formation complète
// (597 € → 568 €), en PayPal live uniquement. Jamais de montant venant du navigateur.
const DISCOVERY_CREDIT_CENTS = 2900
const CREDITED_FULL = {
  amount: '568.00',
  displayAmount: '568.00',
  referenceId: 'MEDIUMIA_FORMATION_568',
  description: 'MediumIA — Accompagnement à la Médiumnité Consciente (Découverte déduite)',
}

function creditedConfig(cfg) {
  if (cfg.env !== 'live' || cfg.product !== 'full') throw new Error('purchase_product_mismatch')
  return { ...cfg, ...CREDITED_FULL, creditCents: DISCOVERY_CREDIT_CENTS }
}

const CONFIGS = {
  sandbox: {
    base: 'https://api-m.sandbox.paypal.com',
    currency: 'EUR',
  },
  live: {
    base: 'https://api-m.paypal.com',
    currency: 'EUR',
  },
}

function cents(value) {
  if (!/^\d+\.\d{2}$/.test(String(value || ''))) return null
  return Math.round(Number(value) * 100)
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100)
}

function fallbackNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || 'Élève MediumIA'
  const readable = local.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return readable
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 100) || 'Élève MediumIA'
}

function normalizeProduct(value) {
  const product = String(value || 'full').trim().toLowerCase()
  if (!PRODUCTS[product]) throw new Error('invalid_product')
  return product
}

function runtimeConfig(forcedEnv = null, requestedProduct = 'full') {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const configuredEnv = String(process.env.PAYPAL_ENV || '').trim().toLowerCase()
  const env = forcedEnv || (isProduction ? configuredEnv : 'sandbox')
  const product = normalizeProduct(requestedProduct)

  if (!CONFIGS[env]) throw new Error('paypal_env_invalid')

  if (forcedEnv === 'sandbox') {
    if (isProduction) throw new Error('not_found')
  } else if (isProduction) {
    if (env !== 'live') throw new Error('paypal_env_mismatch')
    if (process.env.PAYPAL_FORMATION_ENABLED !== 'true') throw new Error('paypal_disabled')
  } else if (env !== 'sandbox') {
    throw new Error('paypal_env_mismatch')
  }

  return {
    env,
    product,
    ...CONFIGS[env],
    ...PRODUCTS[product],
    ...PRODUCTS[product][env],
  }
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

async function fetchOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

async function captureOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `mediumia-capture-${orderId}`.slice(0, 108),
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

  return data
}

function validateOrderAgainstIntent(cfg, data, intent, { requireCaptured = false } = {}) {
  const unit = (data.purchase_units || []).find(u => u.reference_id === intent.reference_id)
  const expectedAmount = (intent.amount_cents / 100).toFixed(2)
  if (!unit || data.id !== intent.paypal_order_id) throw new Error('paypal_order_mismatch')
  if (intent.product_code !== cfg.product || intent.paypal_env !== cfg.env) throw new Error('purchase_product_mismatch')
  const completedCapture = unit.payments?.captures?.find(capture => capture.status === 'COMPLETED')
  const verifiedAmount = requireCaptured ? completedCapture?.amount : unit.amount
  if (verifiedAmount?.currency_code !== intent.currency || verifiedAmount?.value !== expectedAmount) {
    throw new Error('paypal_amount_mismatch')
  }
  if (!intent.terms_version || !intent.terms_accepted_at || !intent.immediate_access_accepted_at) {
    throw new Error('consent_evidence_missing')
  }
  if (requireCaptured && (data.status !== 'COMPLETED' || !completedCapture?.id)) {
    throw new Error('paypal_capture_incomplete')
  }
  return unit
}

async function readOrderIntent(supabase, orderId) {
  const { data, error } = await supabase
    .from('mediumia_paypal_order_intents')
    .select('*')
    .eq('paypal_order_id', orderId)
    .maybeSingle()
  if (error) throw new Error('order_intent_read_failed')
  if (!data) throw new Error('unknown_order_id')
  return data
}

function legacyIntentFromPayPal(cfg, data) {
  const unit = (data.purchase_units || []).find(u => u.reference_id === cfg.referenceId)
  if (cfg.env !== 'sandbox' || data.status !== 'COMPLETED') throw new Error('unknown_order_id')
  if (!unit || unit.custom_id !== TERMS_CUSTOM_ID) throw new Error('legacy_consent_unverifiable')
  if (unit.amount?.currency_code !== cfg.currency || unit.amount?.value !== cfg.amount) {
    throw new Error('paypal_amount_mismatch')
  }
  const acceptedAt = data.create_time || new Date().toISOString()
  return {
    paypal_order_id: data.id,
    paypal_env: cfg.env,
    product_code: cfg.product,
    amount_cents: cents(cfg.amount),
    currency: cfg.currency,
    reference_id: cfg.referenceId,
    access_level: cfg.accessLevel,
    max_module: cfg.maxModule,
    duration_days: cfg.durationDays,
    terms_version: TERMS_VERSION,
    terms_accepted_at: acceptedAt,
    immediate_access_accepted_at: acceptedAt,
    status: 'captured',
  }
}

async function saveOrderIntent(supabase, cfg, orderId, credit = null, acceptedAt = new Date().toISOString()) {
  const row = {
    paypal_order_id: orderId,
    paypal_env: cfg.env,
    product_code: cfg.product,
    amount_cents: cents(cfg.amount),
    currency: cfg.currency,
    reference_id: cfg.referenceId,
    access_level: cfg.accessLevel,
    max_module: cfg.maxModule,
    duration_days: cfg.durationDays,
    terms_version: TERMS_VERSION,
    terms_accepted_at: acceptedAt,
    immediate_access_accepted_at: acceptedAt,
    status: 'created',
    // Credited order: bound to the logged-in account that owns the Découverte.
    ...(credit ? { user_id: credit.userId, upgrade_credit_purchase_id: credit.purchaseId } : {}),
  }
  const { error } = await supabase.from('mediumia_paypal_order_intents').insert(row)
  if (error) throw new Error('order_intent_write_failed')
}

async function markOrderIntent(supabase, orderId, fields) {
  const { error } = await supabase
    .from('mediumia_paypal_order_intents')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('paypal_order_id', orderId)
  if (error) throw new Error('order_intent_update_failed')
}

// ── Découverte déjà payée → 29 € déduits ────────────────────────────────────
// Source de vérité : l'achat Découverte enregistré par ce serveur au moment de sa
// capture (mediumia_paypal_purchases : live, provisionné, 29 €, crédit non consommé),
// rattaché au compte élève connecté (jeton Supabase vérifié), puis confirmé auprès
// de PayPal : la capture doit être encore COMPLETED (ni remboursée, ni partiellement).

async function studentFromRequest(supabase, req) {
  const match = String(req.headers?.authorization || '').trim().match(/^Bearer\s+(\S+)$/i)
  if (!match) return { present: false, user: null }
  const { data, error } = await supabase.auth.getUser(match[1])
  return { present: true, user: error || !data?.user?.id ? null : data.user }
}

async function discoveryStillPaid(cfg, accessToken, captureId) {
  const response = await fetch(`${cfg.base}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404) return false
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error('credit_check_unavailable')
  return data.status === 'COMPLETED' && data.amount?.currency_code === 'EUR' && data.amount?.value === '29.00'
}

async function discoveryCredit(supabase, cfg, userId, getToken, { ownOrderId = null } = {}) {
  if (cfg.env !== 'live' || cfg.product !== 'full' || !userId) return { eligible: false, reason: 'none' }
  const { data: rows, error } = await supabase
    .from('mediumia_paypal_purchases')
    .select('id, paypal_capture_id, amount_cents, upgrade_credit_cents, upgrade_credit_redeemed_at, provisioned_at')
    .eq('user_id', userId)
    .eq('product_code', 'discovery')
    .eq('paypal_env', 'live')
    .eq('status', 'provisioned')
    .is('upgrade_credit_redeemed_at', null)
  if (error) throw new Error('credit_lookup_failed')
  const candidates = (rows || [])
    .filter(r => r.amount_cents === DISCOVERY_CREDIT_CENTS && r.upgrade_credit_cents === DISCOVERY_CREDIT_CENTS && r.paypal_capture_id)
    .sort((a, b) => String(a.provisioned_at).localeCompare(String(b.provisioned_at)))
  if (!candidates.length) return { eligible: false, reason: 'none' }

  // A monthly parcours already under way is finished from « Mon parcours »: the
  // one-shot credited price is never stacked on payments already made there.
  const { data: pathRows, error: pathError } = await supabase
    .from('mediumia_formation_payments')
    .select('kind')
    .eq('user_id', userId)
    .eq('paypal_env', 'live')
    .in('kind', ['monthly', 'unlock'])
  if (!pathError && pathRows?.length) return { eligible: false, reason: 'parcours_in_progress' }
  // Same while a monthly subscription is open (even before its first instalment):
  // the Découverte already counts there, it is never credited twice.
  const { data: subRows, error: subError } = await supabase
    .from('mediumia_formation_subscriptions')
    .select('status')
    .eq('user_id', userId)
    .eq('paypal_env', 'live')
    .in('status', ['approval_pending', 'active', 'suspended'])
  if (!subError && subRows?.length) return { eligible: false, reason: 'parcours_in_progress' }

  for (const candidate of candidates) {
    const { data: claims, error: claimError } = await supabase
      .from('mediumia_paypal_order_intents')
      .select('paypal_order_id, upgrade_credit_claimed_at')
      .eq('upgrade_credit_purchase_id', candidate.id)
    if (claimError) throw new Error('credit_lookup_failed')
    if ((claims || []).some(c => c.upgrade_credit_claimed_at && c.paypal_order_id !== ownOrderId)) continue
    if (await discoveryStillPaid(cfg, await getToken(), candidate.paypal_capture_id)) {
      return { eligible: true, purchaseId: candidate.id }
    }
  }
  return { eligible: false, reason: 'none' }
}

// Price of a new order, decided here only. Anonymous buyers pay the public price.
async function priceForRequest(supabase, req, cfg, getToken) {
  if (cfg.product !== 'full') return { cfg, credit: null }
  const auth = await studentFromRequest(supabase, req)
  if (!auth.present) return { cfg, credit: null }
  if (!auth.user) throw new Error('session_expired')
  const found = await discoveryCredit(supabase, cfg, auth.user.id, getToken)
  if (found.reason === 'parcours_in_progress') throw new Error('parcours_in_progress')
  if (!found.eligible) return { cfg, credit: null }
  return { cfg: creditedConfig(cfg), credit: { userId: auth.user.id, purchaseId: found.purchaseId } }
}

// Before money moves: the credit is still there, and only this order holds it.
async function claimDiscoveryCredit(supabase, cfg, intent, getToken) {
  const found = await discoveryCredit(supabase, cfg, intent.user_id, getToken, { ownOrderId: intent.paypal_order_id })
  if (!found.eligible || found.purchaseId !== intent.upgrade_credit_purchase_id) throw new Error('discovery_credit_unavailable')
  if (intent.upgrade_credit_claimed_at) return
  const { error } = await supabase
    .from('mediumia_paypal_order_intents')
    .update({ upgrade_credit_claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('paypal_order_id', intent.paypal_order_id)
  if (error) throw new Error(error.code === '23505' ? 'discovery_credit_unavailable' : 'order_intent_update_failed')
}

async function releaseDiscoveryCredit(supabase, intent) {
  await supabase
    .from('mediumia_paypal_order_intents')
    .update({ upgrade_credit_claimed_at: null, updated_at: new Date().toISOString() })
    .eq('paypal_order_id', intent.paypal_order_id)
    .then(() => null, () => null)
}

// The Découverte is marked as used by this full purchase (once, idempotent).
async function redeemDiscoveryCredit(supabase, intent, orderId) {
  const { data: full, error } = await supabase
    .from('mediumia_paypal_purchases')
    .select('id')
    .eq('paypal_order_id', orderId)
    .maybeSingle()
  if (error || !full?.id) throw new Error('credit_redeem_failed')
  const { data: discovery, error: readError } = await supabase
    .from('mediumia_paypal_purchases')
    .select('id, upgrade_credit_redeemed_purchase_id')
    .eq('id', intent.upgrade_credit_purchase_id)
    .maybeSingle()
  if (readError || !discovery) throw new Error('credit_redeem_failed')
  if (discovery.upgrade_credit_redeemed_purchase_id === full.id) return
  if (discovery.upgrade_credit_redeemed_purchase_id) throw new Error('credit_already_redeemed')
  const { error: updateError } = await supabase
    .from('mediumia_paypal_purchases')
    .update({ upgrade_credit_redeemed_at: new Date().toISOString(), upgrade_credit_redeemed_purchase_id: full.id })
    .eq('id', intent.upgrade_credit_purchase_id)
    .is('upgrade_credit_redeemed_at', null)
  if (updateError) throw new Error('credit_redeem_failed')
}

function verifiedPayment(cfg, data, intent = null) {
  const unit = (data.purchase_units || []).find(u => u.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find(c => c.status === 'COMPLETED')
  const payerEmail = String(data.payer?.email_address || '').trim().toLowerCase()
  const paypalName = cleanName([
    data.payer?.name?.given_name,
    data.payer?.name?.surname,
  ].filter(Boolean).join(' '))

  if (!unit || !capture?.id || !payerEmail) throw new Error('paypal_payment_invalid')
  if (capture.amount?.currency_code !== cfg.currency || capture.amount?.value !== cfg.amount) {
    throw new Error('paypal_amount_mismatch')
  }
  const acceptedAt = intent?.terms_accepted_at || data.create_time || capture.create_time || new Date().toISOString()

  return {
    orderId: data.id,
    captureId: capture.id,
    payerEmail,
    payerName: paypalName || fallbackNameFromEmail(payerEmail),
    amount: capture.amount,
    amountCents: cents(capture.amount.value),
    capturedAt: capture.create_time || new Date().toISOString(),
    termsVersion: intent?.terms_version || null,
    termsAcceptedAt: intent ? acceptedAt : null,
    immediateAccessAcceptedAt: intent?.immediate_access_accepted_at || null,
    product: cfg.product,
  }
}

async function findOrCreateMediumiaUser(supabase, email) {
  const lookup = async () => {
    const { data, error } = await supabase.rpc('mediumia_find_user_id_by_email', { p_email: email })
    if (error) throw new Error('supabase_user_lookup_failed')
    return data || null
  }

  let userId = await lookup()
  if (userId) return userId

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { mediumia_source: 'paypal_purchase' },
  })

  if (!error && data?.user?.id) return data.user.id

  userId = await lookup()
  if (userId) return userId
  throw new Error('supabase_user_create_failed')
}

function makePdfDeliveryToken() {
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + PDF_DELIVERY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  return { token, hash, expiresAt }
}

async function provisionAccess(cfg, payment, intent = null) {
  const credited = !!intent?.upgrade_credit_purchase_id
  if (!dbReady()) throw new Error('supabase_not_configured')
  const supabase = db()

  const { data: existing, error: existingError } = await supabase
    .from('mediumia_paypal_purchases')
    .select('id, status, paypal_capture_id, entitlement_id, user_id, product_code')
    .eq('paypal_order_id', payment.orderId)
    .maybeSingle()

  if (existingError) throw new Error('purchase_log_read_failed')
  if (existing?.paypal_capture_id && existing.paypal_capture_id !== payment.captureId) {
    throw new Error('purchase_capture_mismatch')
  }
  if (existing?.product_code && existing.product_code !== cfg.product) {
    throw new Error('purchase_product_mismatch')
  }
  if (existing?.status === 'provisioned' && existing.entitlement_id) {
    if (credited) await redeemDiscoveryCredit(supabase, intent, payment.orderId)
    const { data: entitlement } = await supabase
      .from('mediumia_entitlements')
      .select('access_expires_at, access_level, max_module')
      .eq('id', existing.entitlement_id)
      .maybeSingle()
    return {
      status: 'provisioned',
      product: existing.product_code || cfg.product,
      entitlementId: existing.entitlement_id,
      accessExpiresAt: entitlement?.access_expires_at || null,
      accessLevel: entitlement?.access_level || cfg.accessLevel,
      maxModule: entitlement?.max_module ?? cfg.maxModule,
      alreadyProvisioned: true,
    }
  }

  const purchaseFields = {
    paypal_capture_id: payment.captureId,
    payer_email: payment.payerEmail,
    payer_name: payment.payerName,
    amount_cents: payment.amountCents,
    currency: payment.amount.currency_code,
    paypal_env: cfg.env,
    status: 'captured',
    failure_code: null,
    terms_version: payment.termsVersion,
    terms_accepted_at: payment.termsAcceptedAt,
    immediate_access_accepted_at: payment.immediateAccessAcceptedAt,
    product_code: cfg.product,
    access_level: cfg.accessLevel,
    max_module: cfg.maxModule,
    upgrade_credit_cents: cfg.upgradeCreditCents,
  }

  if (!existing) {
    const { error: insertError } = await supabase.from('mediumia_paypal_purchases').insert({
      paypal_order_id: payment.orderId,
      ...purchaseFields,
      captured_at: payment.capturedAt,
    })
    if (insertError && insertError.code !== '23505') throw new Error('purchase_log_insert_failed')
  } else {
    const { error: updateError } = await supabase
      .from('mediumia_paypal_purchases')
      .update(purchaseFields)
      .eq('paypal_order_id', payment.orderId)
    if (updateError) throw new Error('purchase_log_update_failed')
  }

  try {
    // A credited purchase belongs to the account that owns the Découverte, even if
    // PayPal was paid from another address; otherwise the PayPal address decides.
    const userId = credited ? intent.user_id : await findOrCreateMediumiaUser(supabase, payment.payerEmail)
    let recipient = payment.payerEmail
    if (credited) {
      const { data: account } = await supabase.auth.admin.getUserById(userId)
      recipient = String(account?.user?.email || '').trim().toLowerCase()
      if (!recipient) throw new Error('student_account_unavailable')
    }

    const { error: nameError } = await supabase
      .from('mediumia_students')
      .update({ display_name: payment.payerName })
      .eq('user_id', userId)
      .is('display_name', null)
    if (nameError) throw new Error('student_name_update_failed')

    const { data: student, error: studentError } = await supabase
      .from('mediumia_students')
      .select('license_number, display_name')
      .eq('user_id', userId)
      .single()
    if (studentError || !student?.license_number) throw new Error('student_license_unavailable')

    const originRef = cfg.product === 'full'
      ? `paypal:${cfg.env}:${payment.captureId}`
      : `paypal:${cfg.env}:${cfg.product}:${payment.captureId}`
    const grantRequest = cfg.product === 'full'
      ? supabase.rpc('mediumia_grant_purchase_atomic', {
          p_user_id: userId,
          p_origin_ref: originRef,
          p_duration_days: cfg.durationDays,
        })
      : supabase.rpc('mediumia_grant_purchase_access_atomic', {
          p_user_id: userId,
          p_origin_ref: originRef,
          p_duration_days: cfg.durationDays,
          p_access_level: cfg.accessLevel,
          p_max_module: cfg.maxModule,
        })
    const { data: grant, error: grantError } = await grantRequest

    if (grantError || !grant || !['granted', 'already_granted'].includes(grant.status)) {
      throw new Error('entitlement_grant_failed')
    }

    // Parcours au mois: every Discovery / full purchase counts toward the 597 € cap.
    await supabase.from('mediumia_formation_payments').insert({
      user_id: userId,
      paypal_env: cfg.env,
      kind: cfg.product === 'full' ? 'full' : 'discovery',
      amount_cents: payment.amountCents,
      value_cents: cfg.env === 'live' ? payment.amountCents : cents(cfg.displayAmount),
      paypal_ref: payment.captureId,
      paid_at: payment.capturedAt,
    }).then(() => null, () => null)

    // A complete purchase ends any monthly parcours: the subscription is cancelled
    // and synced, and any total above 597 € is reported to the owner.
    if (cfg.product === 'full') await settlePathAfterFullPurchase(supabase, cfg.env, userId).catch(() => null)

    // With the new parcours open, a Discovery's module 1 stays acquired: it gets
    // its parcours row (module 1, coach 30 days). Before opening, nothing changes.
    if (cfg.product === 'discovery' && pathEnv()) {
      await supabase.rpc('mediumia_set_path_entitlement', {
        p_user_id: userId,
        p_env: cfg.env,
        p_max_module: 1,
        p_expires_at: new Date(new Date(payment.capturedAt).getTime() + 30 * 86_400_000).toISOString(),
      }).then(() => null, () => null)
    }

    if (credited) await redeemDiscoveryCredit(supabase, intent, payment.orderId)

    const pdfDelivery = makePdfDeliveryToken()
    const studentAppUrl = String(process.env.MEDIUMIA_STUDENT_APP_URL || 'https://espace.mediumia.fr').replace(/\/+$/, '')
    const pdfDownloadUrl = `${studentAppUrl}/api/purchase-pdf?token=${encodeURIComponent(pdfDelivery.token)}`

    const { error: finalError } = await supabase
      .from('mediumia_paypal_purchases')
      .update({
        status: 'provisioned',
        user_id: userId,
        entitlement_id: grant.entitlement_id,
        provisioned_at: new Date().toISOString(),
        failure_code: null,
        pdf_download_token_hash: pdfDelivery.hash,
        pdf_download_expires_at: pdfDelivery.expiresAt,
      })
      .eq('paypal_order_id', payment.orderId)

    if (finalError) throw new Error('purchase_finalize_failed')

    let emailDelivery = { access: 'skipped_sandbox', pdf: 'skipped_sandbox' }
    if (cfg.env === 'live') {
      const h = escapeHtml
      const isDiscovery = cfg.product === 'discovery'
      const accessDuration = isDiscovery ? '30 jours' : '12 mois'
      const accessScope = isDiscovery
        ? 'Introduction, Module 1, exercices associés, carnet de pratique et coach MediumIA limité à cette édition.'
        : 'Les 25 modules, les 84 exercices, le carnet de pratique et le coach MediumIA complet.'
      const pdfName = isDiscovery ? 'PDF Découverte' : 'PDF complet'
      const creditNoticeHtml = isDiscovery
        ? '<p><strong>Vos 29 € seront déduits</strong> si vous poursuivez ensuite avec la Formation complète : connectez-vous avec cette adresse e-mail sur mediumia.fr/formation, la Formation complète vous sera proposée à 568 €.</p>'
        : ''
      const creditNoticeText = isDiscovery
        ? '\n\nVos 29 € seront déduits si vous poursuivez ensuite avec la Formation complète : connectez-vous avec cette adresse e-mail sur mediumia.fr/formation, la Formation complète vous sera proposée à 568 €.'
        : ''

      const accessEmail = await sendEmail({
        to: recipient,
        subject: isDiscovery ? 'Votre accès Découverte MediumIA est activé' : 'Votre accès MediumIA est activé',
        html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Bienvenue dans MediumIA</h2><p>Votre paiement a bien été confirmé et votre accès de ${accessDuration} est activé.</p><p>${h(accessScope)}</p><p>Connectez-vous à votre espace élève avec la même adresse e-mail que celle utilisée pour votre paiement PayPal.</p><p><a href="${h(studentAppUrl)}" style="color:#1A1535;font-weight:700">Accéder à mon espace élève →</a></p><p>Votre ${pdfName} personnel vous est envoyé dans un e-mail séparé.</p>${creditNoticeHtml}<p style="font-size:13px;color:#716b7c">Expiration de l’accès : ${h(new Date(grant.access_expires_at).toLocaleDateString('fr-FR'))}</p></div>`,
        text: `Bienvenue dans MediumIA\n\nVotre paiement a bien été confirmé et votre accès de ${accessDuration} est activé.\n\n${accessScope}\n\nConnectez-vous avec la même adresse e-mail que celle utilisée pour votre paiement PayPal : ${studentAppUrl}\n\nVotre ${pdfName} personnel vous est envoyé dans un e-mail séparé.${creditNoticeText}\n\nExpiration de l'accès : ${new Date(grant.access_expires_at).toLocaleDateString('fr-FR')}`,
        idempotencyKey: `mediumia-access-${cfg.product}-${payment.captureId}`,
      })

      const pdfEmail = await sendEmail({
        to: recipient,
        subject: `Votre ${pdfName} MediumIA personnel`,
        html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Votre ${pdfName} MediumIA</h2><p>Bonjour ${h(student.display_name || payment.payerName)},</p><p>Votre document est préparé spécialement pour vous. Votre nom et votre numéro de licence <strong>${h(student.license_number)}</strong> seront inscrits sur chaque page.</p><p><a href="${h(pdfDownloadUrl)}" style="display:inline-block;background:#C9A84C;color:#1A1535;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Télécharger mon PDF personnel →</a></p><p style="font-size:13px;color:#716b7c">Ce lien privé est valable ${PDF_DELIVERY_DAYS} jours. Conservez ensuite votre PDF personnel sur votre appareil.</p><p style="font-size:12px;color:#8a8492">Ce document est nominatif et destiné à votre usage personnel.</p></div>`,
        text: `Votre ${pdfName} MediumIA personnel\n\nBonjour ${student.display_name || payment.payerName},\n\nVotre document est préparé spécialement pour vous. Votre nom et votre numéro de licence ${student.license_number} seront inscrits sur chaque page.\n\nTélécharger : ${pdfDownloadUrl}\n\nCe lien privé est valable ${PDF_DELIVERY_DAYS} jours.`,
        idempotencyKey: `mediumia-pdf-${cfg.product}-${payment.captureId}`,
      })
      emailDelivery = { access: accessEmail.status, pdf: pdfEmail.status }
    }

    return {
      status: 'provisioned',
      product: cfg.product,
      entitlementId: grant.entitlement_id,
      accessExpiresAt: grant.access_expires_at,
      accessLevel: cfg.accessLevel,
      maxModule: cfg.maxModule,
      licenseNumber: student.license_number,
      pdfDelivery: cfg.env === 'live' ? 'email' : 'sandbox_link',
      emailDelivery,
      ...(cfg.env === 'sandbox' ? { pdfDownloadUrl } : {}),
      alreadyProvisioned: grant.status === 'already_granted',
    }
  } catch (error) {
    await supabase
      .from('mediumia_paypal_purchases')
      .update({ status: 'provisioning_failed', failure_code: error?.message || 'unknown' })
      .eq('paypal_order_id', payment.orderId)
    throw error
  }
}

async function recoverOrCapture(baseCfg, orderId) {
  if (!dbReady()) throw new Error('supabase_not_configured')
  const supabase = db()
  let cfg = baseCfg
  const accessToken = await getAccessToken(cfg)
  let fetched = await fetchOrder(cfg, accessToken, orderId)
  if (!fetched.response.ok) throw new Error('paypal_order_fetch_failed')

  let intent
  try {
    intent = await readOrderIntent(supabase, orderId)
  } catch (error) {
    if (error?.message !== 'unknown_order_id') throw error
    intent = legacyIntentFromPayPal(cfg, fetched.data)
    const { error: legacyInsertError } = await supabase
      .from('mediumia_paypal_order_intents')
      .insert(intent)
    if (legacyInsertError && legacyInsertError.code !== '23505') throw new Error('legacy_intent_write_failed')
    intent = await readOrderIntent(supabase, orderId)
  }

  if (intent.upgrade_credit_purchase_id) {
    if (intent.amount_cents !== 56800 || !intent.user_id) throw new Error('purchase_product_mismatch')
    cfg = creditedConfig(baseCfg)
  }
  validateOrderAgainstIntent(cfg, fetched.data, intent)
  if (!['APPROVED', 'COMPLETED'].includes(fetched.data.status)) throw new Error('paypal_order_not_approved')

  let completedOrder = fetched.data
  if (fetched.data.status !== 'COMPLETED') {
    if (intent.upgrade_credit_purchase_id) await claimDiscoveryCredit(supabase, cfg, intent, async () => accessToken)
    try {
      completedOrder = await captureOrder(cfg, accessToken, orderId)
    } catch (error) {
      // Not captured (PayPal confirmed): the credit stays available for a new order.
      if (intent.upgrade_credit_purchase_id && error?.message === 'paypal_capture_failed') await releaseDiscoveryCredit(supabase, intent)
      throw error
    }
  }
  validateOrderAgainstIntent(cfg, completedOrder, intent, { requireCaptured: true })
  const payment = verifiedPayment(cfg, completedOrder, intent)

  if (intent.paypal_capture_id && intent.paypal_capture_id !== payment.captureId) {
    throw new Error('purchase_capture_mismatch')
  }
  await markOrderIntent(supabase, orderId, {
    status: 'captured',
    paypal_capture_id: payment.captureId,
    captured_at: payment.capturedAt,
    last_error: null,
  })

  try {
    const access = await provisionAccess(cfg, payment, intent)
    await markOrderIntent(supabase, orderId, {
      status: 'provisioned',
      provisioned_at: new Date().toISOString(),
      last_error: null,
    })
    return { completedOrder, payment, access }
  } catch (error) {
    await markOrderIntent(supabase, orderId, {
      status: 'provisioning_failed',
      last_error: error?.message || 'unknown',
    }).catch(() => {})
    throw error
  }
}

function pricingStatus(error) {
  const code = error?.message
  if (code === 'session_expired') return 401
  if (code === 'parcours_in_progress') return 409
  if (code === 'paypal_not_configured' || code === 'supabase_not_configured') return 500
  return 503
}

async function handle(req, res, action, forcedEnv = null) {
  let cfg
  try {
    const requestedProduct = req.query?.product ?? req.body?.product ?? 'full'
    cfg = runtimeConfig(forcedEnv, requestedProduct)
  } catch (error) {
    if (error?.message === 'invalid_product') {
      return res.status(400).json({ error: 'invalid_product' })
    }
    if (error?.message === 'not_found' || error?.message === 'paypal_disabled') {
      return res.status(404).json({ error: 'not_found' })
    }
    return res.status(503).json({ error: error?.message || 'paypal_unavailable' })
  }

  const requireConsent = forcedEnv === null

  if (action === 'config') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const clientId = String(process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()
    if (!clientId) return res.status(500).json({ error: 'paypal_not_configured' })
    return res.status(200).json({
      clientId,
      product: cfg.product,
      amount: cfg.amount,
      displayAmount: cfg.displayAmount,
      currency: cfg.currency,
      env: cfg.env,
    })
  }

  if (action === 'credit') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    if (cfg.product !== 'full') return res.status(400).json({ error: 'invalid_product' })
    try {
      if (!dbReady()) throw new Error('supabase_not_configured')
      let token = null
      const priced = await priceForRequest(db(), req, cfg, async () => (token ||= await getAccessToken(cfg)))
      return res.status(200).json({
        product: cfg.product,
        credited: !!priced.credit,
        creditCents: priced.credit ? DISCOVERY_CREDIT_CENTS : 0,
        amount: priced.cfg.amount,
        displayAmount: priced.cfg.displayAmount,
        currency: priced.cfg.currency,
      })
    } catch (error) {
      return res.status(pricingStatus(error)).json({ error: error?.message || 'credit_check_unavailable' })
    }
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    if (requireConsent && (req.body?.termsAccepted !== true || req.body?.immediateAccessAccepted !== true)) {
      return res.status(400).json({ error: 'consent_required' })
    }

    let priced
    let accessToken = null
    try {
      if (!dbReady()) throw new Error('supabase_not_configured')
      priced = await priceForRequest(db(), req, cfg, async () => (accessToken ||= await getAccessToken(cfg)))
    } catch (error) {
      return res.status(pricingStatus(error)).json({ error: error?.message || 'credit_check_unavailable' })
    }
    // The page may announce the price it shows; it is never used as a price, only
    // to refuse an order whose amount differs from what the buyer saw.
    const shown = String(req.headers?.['x-mediumia-expected-full-amount'] || '').trim()
    if (cfg.product === 'full' && shown && shown !== priced.cfg.displayAmount) {
      return res.status(409).json({ error: 'price_changed', displayAmount: priced.cfg.displayAmount })
    }

    try {
      const orderCfg = priced.cfg
      accessToken ||= await getAccessToken(orderCfg)
      const purchaseUnit = {
        reference_id: orderCfg.referenceId,
        description: orderCfg.description,
        amount: { currency_code: orderCfg.currency, value: orderCfg.amount },
      }
      if (requireConsent) purchaseUnit.custom_id = TERMS_CUSTOM_ID

      const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': randomUUID(),
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [purchaseUnit],
          payment_source: {
            paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } },
          },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')
      await saveOrderIntent(db(), orderCfg, data.id, priced.credit)
      return res.status(201).json({ id: data.id, product: cfg.product })
    } catch (error) {
      const code = error?.message || 'paypal_create_order_failed'
      return res.status(code === 'paypal_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'capture') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) return res.status(400).json({ error: 'invalid_order_id' })

    try {
      const { completedOrder, payment, access } = await recoverOrCapture(cfg, orderId)
      return res.status(200).json({
        status: completedOrder.status,
        product: cfg.product,
        orderId: payment.orderId,
        captureId: payment.captureId,
        amount: payment.amount,
        access,
      })
    } catch (error) {
      const code = error?.message || 'paypal_capture_failed'
      console.error('[paypal] capture/provision failed:', code)
      return res.status(code === 'paypal_not_configured' || code === 'supabase_not_configured' ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'status') {
    if (req.method !== 'GET' || cfg.env !== 'sandbox') return res.status(405).json({ error: 'method_not_allowed' })
    const orderId = typeof req.query?.orderId === 'string' ? req.query.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) return res.status(400).json({ error: 'invalid_order_id' })
    try {
      const accessToken = await getAccessToken(cfg)
      const fetched = await fetchOrder(cfg, accessToken, orderId)
      if (!fetched.response.ok) throw new Error('paypal_order_fetch_failed')
      const unit = (fetched.data.purchase_units || []).find(u => u.reference_id === cfg.referenceId)
      return res.status(200).json({
        orderId: fetched.data.id,
        status: fetched.data.status,
        product: cfg.product,
        referenceMatches: !!unit,
        amountMatches: unit?.amount?.currency_code === cfg.currency && unit?.amount?.value === cfg.amount,
        consentMarkerPresent: unit?.custom_id === TERMS_CUSTOM_ID,
        captureStatus: unit?.payments?.captures?.[0]?.status || null,
      })
    } catch (error) {
      return res.status(502).json({ error: error?.message || 'paypal_order_fetch_failed' })
    }
  }

  return res.status(400).json({ error: 'invalid_paypal_action' })
}

export async function handlePayPalSandbox(req, res, action) {
  return handle(req, res, action, 'sandbox')
}

export async function handlePayPalCheckout(req, res, action) {
  return handle(req, res, action, null)
}

export const __paypalFormationTest = {
  useSupabase(client) { supabaseOverride = client },
  creditedConfig,
  normalizeProduct,
  runtimeConfig,
  verifiedPayment,
  validateOrderAgainstIntent,
  legacyIntentFromPayPal,
}
