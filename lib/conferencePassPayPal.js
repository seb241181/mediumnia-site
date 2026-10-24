/* global Buffer, process */

import { createHash, randomBytes } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { __paypalFormationTest } from './paypalSandbox.js'
import { sendConferencePassEmail, sendConferencePassConfirmationEmail } from './conferencePassEmail.js'

const PASS_PRODUCT = 'conference_pass_full'
const TERMS_VERSION = 'conference-pass-2026-10-23-v2'
// Accord pour recevoir par e-mail son Pass et l'offre participants (distinct de l'inscription).
const OFFER_CONSENT_VERSION = 'conference-offer-2026-10-23-v1'
const RESEND_COOLDOWN_MS = 2 * 60 * 1000
const MAX_SENDS_PER_PASS = 5
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/
const PDF_DELIVERY_DAYS = 30
const TERMS_CUSTOM_ID = `MEDIUMIA:${TERMS_VERSION}:PASS`
const NORMAL_AMOUNT_CENTS = 59700
const REFERENCE = {
  sandbox: 'MEDIUMIA_CONFERENCE_PASS_SANDBOX',
  live: 'MEDIUMIA_CONFERENCE_PASS',
}
const DESCRIPTION = 'MediumIA — Pass Conférence Formation complète'

function cents(value) {
  if (!/^\d+\.\d{2}$/.test(String(value || ''))) return null
  return Math.round(Number(value) * 100)
}

function amountFromCents(value) {
  if (!Number.isInteger(value) || value <= 0) return null
  return (value / 100).toFixed(2)
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function createCheckoutRequestId(pass) {
  return sha256Hex(`conference-pass-create:${pass.id}:${pass.paypal_order_id || 'initial'}`)
}

function isPreviousPaypalRequestInProgress(response, data) {
  return response?.status === 409 && (
    data?.name === 'PREVIOUS_REQUEST_IN_PROGRESS'
    || data?.details?.some((entry) => entry?.issue === 'PREVIOUS_REQUEST_IN_PROGRESS')
  )
}

async function createPaypalOrder(cfg, accessToken, requestId) {
  const body = JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: cfg.referenceId,
      description: cfg.description,
      amount: { currency_code: cfg.currency, value: cfg.amount },
      custom_id: TERMS_CUSTOM_ID,
    }],
    payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
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

    if (response.ok && data.id) return data

    if (isPreviousPaypalRequestInProgress(response, data) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)))
      continue
    }

    if (isPreviousPaypalRequestInProgress(response, data)) {
      throw new Error('paypal_create_order_in_progress')
    }

    throw new Error('paypal_create_order_failed')
  }

  throw new Error('paypal_create_order_failed')
}

function normalizeToken(value) {
  const token = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('invalid_pass')
  return token
}

function normalizeOrderId(value) {
  const orderId = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) throw new Error('invalid_order_id')
  return orderId
}

function runtimeConfig(offerAmountCents = null) {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const configuredEnv = String(process.env.PAYPAL_ENV || '').trim().toLowerCase()
  const env = isProduction ? configuredEnv : 'sandbox'
  if (!['sandbox', 'live'].includes(env)) throw new Error('paypal_env_invalid')

  if (isProduction) {
    if (env !== 'live') throw new Error('paypal_env_mismatch')
    if (process.env.PAYPAL_CONFERENCE_PASS_ENABLED !== 'true') throw new Error('not_found')
  }

  const liveAmount = amountFromCents(offerAmountCents)
  if (!liveAmount) throw new Error('offer_not_configured')

  return {
    env,
    base: env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    currency: 'EUR',
    amount: env === 'live' ? liveAmount : '1.00',
    displayAmount: liveAmount,
    amountCents: env === 'live' ? offerAmountCents : 100,
    referenceId: REFERENCE[env],
    description: DESCRIPTION,
    product: PASS_PRODUCT,
    accessLevel: 'full',
    maxModule: 25,
    durationDays: 365,
  }
}

async function getAccessToken(cfg) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')

  const response = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error('paypal_auth_failed')
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
      'PayPal-Request-Id': `mediumia-pass-capture-${orderId}`.slice(0, 108),
    },
  })
  let data = await response.json().catch(() => ({}))
  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetchOrder(cfg, accessToken, orderId)
    if (!fetched.response.ok || fetched.data.status !== 'COMPLETED') throw new Error('paypal_capture_failed')
    data = fetched.data
  }
  return data
}

function validateCompletedOrder(cfg, data, orderId) {
  const unit = (data.purchase_units || []).find((entry) => entry.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find((entry) => entry.status === 'COMPLETED')
  if (data.id !== orderId || !unit || !capture?.id) throw new Error('paypal_payment_invalid')
  if (capture.amount?.currency_code !== cfg.currency || capture.amount?.value !== cfg.amount) throw new Error('paypal_amount_mismatch')
  const customId = unit.custom_id || capture.custom_id || ''
  if (customId && customId !== TERMS_CUSTOM_ID) throw new Error('paypal_consent_mismatch')
  const payerEmail = String(data.payer?.email_address || '').trim().toLowerCase()
  if (!payerEmail) throw new Error('paypal_payment_invalid')
  return {
    orderId,
    captureId: capture.id,
    payerEmail,
    payerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(' ').trim() || payerEmail.split('@')[0],
    amount: capture.amount,
    amountCents: cents(capture.amount.value),
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}

function hasCompletedCapture(data, cfg) {
  const unit = (data.purchase_units || []).find((entry) => entry.reference_id === cfg.referenceId)
  return !!unit?.payments?.captures?.some((entry) => entry.status === 'COMPLETED')
}

function isReusablePaypalOrder(data) {
  return ['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'].includes(data?.status)
}

async function getPassByHash(supabase, tokenHash) {
  const { data, error } = await supabase
    .from('conference_passes')
    .select('id,event_id,registration_id,status,paypal_order_id,paypal_capture_id,paypal_env,amount_cents,currency,reference_id,redeemed_at,expires_at,terms_accepted_at,immediate_access_accepted_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error('pass_lookup_failed')
  if (!data) throw new Error('pass_not_found')
  return data
}

async function validatePassByHash(supabase, tokenHash) {
  const { data, error } = await supabase.rpc('validate_conference_pass', { p_token_hash: tokenHash })
  if (error) throw new Error('pass_validate_failed')
  return data
}

async function getReservedPass(supabase, orderId) {
  const { data, error } = await supabase
    .from('conference_passes')
    .select('id,event_id,registration_id,status,paypal_order_id,paypal_capture_id,paypal_env,amount_cents,currency,reference_id,redeemed_at,expires_at,terms_version,terms_accepted_at,immediate_access_accepted_at')
    .eq('paypal_order_id', orderId)
    .maybeSingle()
  if (error) throw new Error('pass_lookup_failed')
  if (!data) throw new Error('pass_not_found')
  return data
}

async function getRegistration(supabase, registrationId) {
  const { data, error } = await supabase
    .from('conference_registrations')
    .select('id,email_normalized,first_name,status')
    .eq('id', registrationId)
    .maybeSingle()
  if (error) throw new Error('registration_lookup_failed')
  if (!data || data.status === 'cancelled') throw new Error('registration_invalid')
  return data
}

async function createOrFindUser(supabase, email, name) {
  const existing = await supabase.rpc('mediumia_find_user_id_by_email', { p_email: email })
  if (existing.error) throw new Error('supabase_user_lookup_failed')
  if (existing.data) return existing.data

  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name, mediumia_source: 'conference_pass' },
  })
  if (!created.error && created.data?.user?.id) return created.data.user.id

  const retry = await supabase.rpc('mediumia_find_user_id_by_email', { p_email: email })
  if (retry.error) throw new Error('supabase_user_lookup_failed')
  if (retry.data) return retry.data
  throw new Error('supabase_user_create_failed')
}

async function grantFullAccess(supabase, payment) {
  const registration = await getRegistration(supabase, payment.registrationId)

  const displayName = registration.first_name || payment.payerName
  const userId = await createOrFindUser(supabase, registration.email_normalized, displayName)
  await supabase.from('mediumia_students').update({ display_name: displayName }).eq('user_id', userId).is('display_name', null)

  const originRef = `conference-pass:${payment.env}:${payment.captureId}`
  const { data: grant, error: grantError } = await supabase.rpc('mediumia_grant_purchase_atomic', {
    p_user_id: userId,
    p_origin_ref: originRef,
    p_duration_days: 365,
  })
  if (grantError || !grant || !['granted', 'already_granted'].includes(grant.status)) throw new Error('entitlement_grant_failed')

  return { userId, grant, registration }
}

// Accords CGV et accès immédiat : enregistrés côté serveur avant toute commande PayPal.
async function recordCheckoutConsent(supabase, pass) {
  if (pass.terms_accepted_at && pass.immediate_access_accepted_at) return
  const acceptedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('conference_passes')
    .update({ terms_version: TERMS_VERSION, terms_accepted_at: acceptedAt, immediate_access_accepted_at: acceptedAt, updated_at: acceptedAt })
    .eq('id', pass.id)
    .is('redeemed_at', null)
    .select('id')
    .maybeSingle()
  if (error || !data) throw new Error('consent_record_failed')
  await logPassEvent(supabase, { event_id: pass.event_id, pass_id: pass.id, registration_id: pass.registration_id, event_name: 'terms_accepted', metadata: { termsVersion: TERMS_VERSION } })
}

async function createCheckout(req, res, cfg, tokenHash, supabase) {
  if (req.body?.termsAccepted !== true || req.body?.immediateAccessAccepted !== true) throw new Error('consent_required')
  const accessToken = await getAccessToken(cfg)
  const pass = await getPassByHash(supabase, tokenHash)
  await recordCheckoutConsent(supabase, pass)

  if (pass.paypal_order_id && !pass.paypal_capture_id && !pass.redeemed_at) {
    if (pass.paypal_env !== cfg.env || pass.amount_cents !== cfg.amountCents || pass.currency !== cfg.currency || pass.reference_id !== cfg.referenceId) {
      throw new Error('pass_intent_mismatch')
    }

    const existing = await fetchOrder(cfg, accessToken, pass.paypal_order_id)
    if (!existing.response.ok) throw new Error('paypal_order_fetch_failed')

    if (existing.data.status === 'COMPLETED' || hasCompletedCapture(existing.data, cfg)) {
      return res.status(200).json({ id: pass.paypal_order_id, env: cfg.env, completed: true })
    }

    if (isReusablePaypalOrder(existing.data)) {
      return res.status(200).json({ id: pass.paypal_order_id, env: cfg.env, reused: true })
    }

    const released = await supabase.rpc('release_conference_pass_checkout', {
      p_paypal_order_id: pass.paypal_order_id,
      p_reason: `paypal_order_${String(existing.data.status || 'not_reusable').toLowerCase()}`,
    })
    if (released.error) throw new Error('pass_release_failed')
    if (!released.data?.ok) throw new Error(released.data?.reason || 'pass_release_failed')
  }

  const requestId = createCheckoutRequestId(pass)
  const data = await createPaypalOrder(cfg, accessToken, requestId)

  const reserved = await supabase.rpc('reserve_conference_pass_checkout', {
    p_token_hash: tokenHash,
    p_paypal_order_id: data.id,
    p_paypal_env: cfg.env,
    p_amount_cents: cfg.amountCents,
    p_currency: cfg.currency,
    p_reference_id: cfg.referenceId,
  })
  if (reserved.error) throw new Error('pass_reserve_failed')

  if (!reserved.data?.ok) {
    if (reserved.data?.reason === 'already_reserved' && reserved.data?.orderId) {
      const winner = await getPassByHash(supabase, tokenHash)
      if (
        winner.paypal_order_id !== reserved.data.orderId
        || winner.paypal_env !== cfg.env
        || winner.amount_cents !== cfg.amountCents
        || winner.currency !== cfg.currency
        || winner.reference_id !== cfg.referenceId
      ) {
        throw new Error('pass_intent_mismatch')
      }

      return res.status(200).json({
        id: winner.paypal_order_id,
        env: cfg.env,
        reused: true,
      })
    }

    throw new Error(reserved.data?.reason || 'pass_reserve_failed')
  }

  return res.status(reserved.data?.alreadyReserved ? 200 : 201).json({
    id: data.id,
    env: cfg.env,
    reused: !!reserved.data?.alreadyReserved,
  })
}

// Même contenu qu'un achat à 597 € : l'achat est enregistré comme une Formation complète
// pour réutiliser le circuit existant du PDF personnel (lien privé valable 30 jours).
async function createPdfDelivery(supabase, { orderId, verified, cfg, userId, grant, pass }) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + PDF_DELIVERY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('mediumia_paypal_purchases').insert({
    paypal_order_id: orderId,
    paypal_capture_id: verified.captureId,
    payer_email: verified.payerEmail,
    payer_name: verified.payerName,
    amount_cents: cfg.amountCents,
    currency: cfg.currency,
    paypal_env: cfg.env,
    status: 'provisioned',
    user_id: userId,
    entitlement_id: grant.entitlement_id,
    captured_at: verified.capturedAt,
    provisioned_at: new Date().toISOString(),
    terms_version: pass.terms_version || TERMS_VERSION,
    terms_accepted_at: pass.terms_accepted_at,
    immediate_access_accepted_at: pass.immediate_access_accepted_at,
    product_code: 'full',
    access_level: 'full',
    max_module: 25,
    pdf_download_token_hash: sha256Hex(token),
    pdf_download_expires_at: expiresAt,
  })
  if (error) return { pdfUrl: null, pdfError: error.code === '23505' ? 'already_recorded' : 'purchase_record_failed' }
  const { data: student } = await supabase.from('mediumia_students').select('license_number').eq('user_id', userId).maybeSingle()
  const base = String(process.env.MEDIUMIA_STUDENT_APP_URL || 'https://espace.mediumia.fr').replace(/\/+$/, '')
  return { pdfUrl: `${base}/api/purchase-pdf?token=${encodeURIComponent(token)}`, pdfExpiresAt: expiresAt, licenseNumber: student?.license_number || null, pdfError: null }
}

// Confirmation de commande sur support durable (e-mail) rappelant les accords donnés.
// Un échec est journalisé mais n'empêche jamais l'ouverture de l'accès déjà payé.
async function confirmPurchase(supabase, { pass, registration, event, verified, grant, pdf }) {
  let delivery
  try {
    delivery = await sendConferencePassConfirmationEmail({
      to: registration.email_normalized,
      captureId: verified.captureId,
      firstName: registration.first_name,
      eventTitle: event.title,
      amount: verified.amount?.value,
      normalAmountCents: event.pass_normal_amount_cents,
      capturedAt: verified.capturedAt,
      accessExpiresAt: grant.access_expires_at,
      termsVersion: pass.terms_version || TERMS_VERSION,
      termsAcceptedAt: pass.terms_accepted_at,
      immediateAccessAcceptedAt: pass.immediate_access_accepted_at,
      pdfUrl: pdf?.pdfUrl || null,
      pdfExpiresAt: pdf?.pdfExpiresAt || null,
      licenseNumber: pdf?.licenseNumber || null,
    })
  } catch {
    delivery = { status: 'error' }
  }
  await logPassEvent(supabase, {
    event_id: pass.event_id,
    pass_id: pass.id,
    registration_id: pass.registration_id,
    event_name: delivery.status === 'sent' ? 'confirmation_sent' : 'confirmation_failed',
    metadata: { deliveryStatus: delivery.status, httpStatus: delivery.httpStatus || null, uncertain: !!delivery.uncertain, pdfLink: !!pdf?.pdfUrl, pdfError: pdf?.pdfError || null },
  })
}

async function captureCheckout(req, res, orderId, supabase) {
  const pass = await getReservedPass(supabase, orderId)

  if (pass.paypal_capture_id && pass.redeemed_at) {
    return res.status(200).json({ status: 'COMPLETED', alreadyProvisioned: true, access: { status: 'provisioned' } })
  }
  if (!pass.terms_accepted_at || !pass.immediate_access_accepted_at) throw new Error('consent_missing')

  const { data: event, error: eventError } = await supabase
    .from('conference_events')
    .select('title,pass_offer_amount_cents,pass_offer_currency,pass_offer_enabled,pass_normal_amount_cents')
    .eq('id', pass.event_id)
    .maybeSingle()
  if (eventError || !event) throw new Error('event_lookup_failed')

  const cfg = runtimeConfig(event.pass_offer_amount_cents)
  if (pass.paypal_env !== cfg.env || pass.amount_cents !== cfg.amountCents || pass.currency !== cfg.currency || pass.reference_id !== cfg.referenceId) {
    throw new Error('pass_intent_mismatch')
  }

  const accessToken = await getAccessToken(cfg)
  const fetched = await fetchOrder(cfg, accessToken, orderId)
  if (!fetched.response.ok) throw new Error('paypal_order_fetch_failed')
  if (!['APPROVED', 'COMPLETED'].includes(fetched.data.status)) throw new Error('paypal_order_not_approved')

  const completedOrder = fetched.data.status === 'COMPLETED' ? fetched.data : await captureOrder(cfg, accessToken, orderId)
  const verified = validateCompletedOrder(cfg, completedOrder, orderId)
  const { userId, grant, registration } = await grantFullAccess(supabase, { ...verified, registrationId: pass.registration_id, env: cfg.env })

  const redeemed = await supabase.rpc('redeem_conference_pass_after_payment', {
    p_paypal_order_id: orderId,
    p_paypal_capture_id: verified.captureId,
    p_user_id: userId,
    p_entitlement_id: grant.entitlement_id,
  })
  if (redeemed.error) throw new Error('pass_redeem_failed')
  if (!redeemed.data?.ok) throw new Error(redeemed.data?.reason || 'pass_redeem_failed')

  if (!redeemed.data.alreadyRedeemed && grant.status === 'granted') {
    const pdf = await createPdfDelivery(supabase, { orderId, verified, cfg, userId, grant, pass }).catch(() => ({ pdfUrl: null, pdfError: 'purchase_record_failed' }))
    await confirmPurchase(supabase, { pass, registration, event, verified, grant, pdf })
  }

  return res.status(200).json({
    status: completedOrder.status,
    orderId,
    captureId: verified.captureId,
    alreadyProvisioned: redeemed.data.alreadyRedeemed || grant.status === 'already_granted',
    access: {
      status: 'provisioned',
      entitlementId: grant.entitlement_id,
      accessExpiresAt: grant.access_expires_at,
      accessLevel: grant.access_level,
      maxModule: grant.max_module,
    },
  })
}

async function configResponse(req, res, pass) {
  const cfg = runtimeConfig(pass.offerAmountCents)
  const clientId = String(process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()
  if (!clientId) throw new Error('paypal_not_configured')
  return res.status(200).json({
    pass: {
      eventSlug: pass.eventSlug,
      eventTitle: pass.eventTitle,
      eventStartsAt: pass.eventStartsAt,
      firstName: pass.firstName,
      expiresAt: pass.expiresAt,
      status: pass.status,
    },
    offer: {
      enabled: pass.offerEnabled,
      normalAmountCents: pass.normalAmountCents || NORMAL_AMOUNT_CENTS,
      amountCents: cfg.env === 'live' ? pass.offerAmountCents : 100,
      displayAmountCents: pass.offerAmountCents,
      currency: cfg.currency,
      label: pass.offerLabel || 'Offre spéciale conférence',
      durationHours: 720,
    },
    paypal: {
      clientId,
      env: cfg.env,
      amount: cfg.amount,
      displayAmount: cfg.displayAmount,
      currency: cfg.currency,
    },
  })
}

async function requireConferenceAdmin(req, supabase) {
  const header = String(req.headers?.authorization || '').trim()
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new Error('admin_unauthenticated')

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error('admin_unauthenticated')

  const { data: admin, error: adminError } = await supabase
    .from('conference_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (adminError || !admin) throw new Error('admin_forbidden')
  return data.user
}

function publicPassBaseUrl(req) {
  const origin = String(req.headers?.origin || '').trim()
  if (process.env.VERCEL_ENV === 'preview' && /^https:\/\/[^/]+\.vercel\.app$/.test(origin)) return origin
  return 'https://mediumia.fr'
}

async function logPassEvent(supabase, row) {
  const { error } = await supabase.from('conference_pass_events').insert(row)
  if (error) console.error('[conference-pass] event log failed:', row.event_name)
}

// En Production, aucun Pass n'est émis tant que son paiement n'est pas ouvert :
// un lien envoyé doit toujours mener à une offre payable.
function assertPassSalesOpen() {
  if (process.env.VERCEL_ENV === 'production' && process.env.PAYPAL_CONFERENCE_PASS_ENABLED !== 'true') {
    throw new Error('pass_payment_disabled')
  }
}

const EVENT_FIELDS = 'id,slug,title,ends_at,status,pass_duration_hours,pass_offer_enabled,pass_offer_amount_cents,pass_offer_currency,pass_offer_label,pass_normal_amount_cents,pass_request_deadline'

async function getOfferEvent(supabase, slug) {
  if (!/^[a-z0-9][a-z0-9-]{1,100}[a-z0-9]$/.test(slug)) throw new Error('invalid_event_slug')
  const { data: event, error } = await supabase.from('conference_events').select(EVENT_FIELDS).eq('slug', slug).maybeSingle()
  if (error || !event) throw new Error('event_lookup_failed')
  if (!event.pass_offer_enabled || !event.pass_offer_amount_cents) throw new Error('offer_disabled')
  const eventEnd = event.ends_at ? new Date(event.ends_at).getTime() : NaN
  if (process.env.VERCEL_ENV === 'production' && (!Number.isFinite(eventEnd) || Date.now() < eventEnd)) {
    throw new Error('pass_issue_too_early')
  }
  return event
}

function passDurationHours(event) {
  return Math.max(1, Math.min(720, Number(event.pass_duration_hours) || 720))
}

// Date limite des demandes : explicite en base, sinon fin de conférence + durée d'un Pass.
function requestDeadline(event) {
  if (event.pass_request_deadline) return new Date(event.pass_request_deadline)
  const end = event.ends_at ? new Date(event.ends_at).getTime() : NaN
  return Number.isFinite(end) ? new Date(end + passDurationHours(event) * 60 * 60 * 1000) : null
}

// Informations publiques de l'offre (aucune donnée personnelle) pour la page de demande.
async function offerInfo(req, res, supabase) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
  assertPassSalesOpen()
  const event = await getOfferEvent(supabase, String(req.query?.slug || '').trim())
  const deadline = requestDeadline(event)
  const normal = event.pass_normal_amount_cents || NORMAL_AMOUNT_CENTS
  return res.status(200).json({
    eventTitle: event.title,
    amountCents: event.pass_offer_amount_cents,
    normalAmountCents: normal,
    savingsCents: Math.max(0, normal - event.pass_offer_amount_cents),
    currency: event.pass_offer_currency || 'EUR',
    requestDeadline: deadline ? deadline.toISOString() : null,
    open: !deadline || Date.now() <= deadline.getTime(),
    passValidityDays: Math.round(passDurationHours(event) / 24),
  })
}

// Crée le Pass (ou renouvelle son lien s'il existe déjà) puis l'envoie. Le jeton brut
// n'est jamais stocké : un lien perdu se retrouve en redemandant le Pass, ce qui
// remplace l'ancien lien sans créer de second Pass.
async function deliverPass(supabase, req, event, registration) {
  const { data: current, error: currentError } = await supabase
    .from('conference_passes')
    .select('id,token_hash,status,redeemed_at,expires_at,send_count,last_sent_at')
    .eq('event_id', event.id)
    .eq('registration_id', registration.id)
    .maybeSingle()
  if (currentError) throw new Error('pass_lookup_failed')

  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = sha256Hex(rawToken)
  const now = new Date()
  let pass
  let created = false
  const previous = current ? { token_hash: current.token_hash, send_count: current.send_count || 0, last_sent_at: current.last_sent_at || null } : null

  if (current) {
    if (current.redeemed_at || current.status === 'redeemed') return { status: 'already_redeemed' }
    if (new Date(current.expires_at) <= now) return { status: 'expired' }
    if ((current.send_count || 0) >= MAX_SENDS_PER_PASS) return { status: 'send_limit' }
    if (current.last_sent_at && now.getTime() - new Date(current.last_sent_at).getTime() < RESEND_COOLDOWN_MS) return { status: 'cooldown' }
    const { data: rotated, error: rotateError } = await supabase
      .from('conference_passes')
      .update({ token_hash: tokenHash, last_sent_at: now.toISOString(), send_count: (current.send_count || 0) + 1, updated_at: now.toISOString() })
      .eq('id', current.id)
      .eq('token_hash', previous.token_hash)
      .is('redeemed_at', null)
      .select('id,expires_at,send_count')
      .maybeSingle()
    if (rotateError) throw new Error('pass_rotate_failed')
    if (!rotated) return { status: 'cooldown' }
    pass = rotated
  } else {
    const expiresAt = new Date(now.getTime() + passDurationHours(event) * 60 * 60 * 1000).toISOString()
    const { data: inserted, error: insertError } = await supabase
      .from('conference_passes')
      .insert({
        event_id: event.id,
        registration_id: registration.id,
        token_hash: tokenHash,
        offer_code: 'CONFERENCE',
        expires_at: expiresAt,
        status: 'issued',
        issued_at: now.toISOString(),
        last_sent_at: now.toISOString(),
        send_count: 1,
      })
      .select('id,expires_at,send_count')
      .single()
    if (insertError?.code === '23505') return { status: 'cooldown' }
    if (insertError || !inserted) throw new Error('pass_insert_failed')
    pass = inserted
    created = true
  }

  const passUrl = `${publicPassBaseUrl(req)}/pass/mediumia/${encodeURIComponent(event.slug)}#pass=${encodeURIComponent(rawToken)}`
  const delivery = await sendConferencePassEmail({
    to: registration.email_normalized,
    registrationId: registration.id,
    sendCount: pass.send_count,
    firstName: registration.first_name,
    eventTitle: event.title,
    expiresAt: pass.expires_at,
    passUrl,
    offerLabel: event.pass_offer_label || 'Tarif réservé aux participants de la conférence',
    amountCents: event.pass_offer_amount_cents,
    normalAmountCents: event.pass_normal_amount_cents,
    consentAt: registration.offer_consent_at,
  })

  if (delivery.status !== 'sent') {
    const metadata = { created, httpStatus: delivery.httpStatus || null, uncertain: !!delivery.uncertain, deliveryStatus: delivery.status }
    if (delivery.uncertain) {
      // L'e-mail a pu partir : on garde ce lien valide plutôt que d'envoyer un lien mort.
      await logPassEvent(supabase, { event_id: event.id, pass_id: pass.id, registration_id: registration.id, event_name: 'pass_email_failed', metadata })
      return { status: 'uncertain' }
    }
    if (created) {
      await supabase.from('conference_passes').delete().eq('id', pass.id)
    } else {
      await supabase.from('conference_passes')
        .update(previous)
        .eq('id', pass.id)
        .eq('token_hash', tokenHash)
    }
    await logPassEvent(supabase, { event_id: event.id, pass_id: created ? null : pass.id, registration_id: registration.id, event_name: 'pass_email_failed', metadata })
    return { status: 'failed' }
  }

  await logPassEvent(supabase, {
    event_id: event.id,
    pass_id: pass.id,
    registration_id: registration.id,
    event_name: created ? 'pass_issued' : 'pass_resent',
    metadata: { emailStatus: 'sent', sendCount: pass.send_count },
  })
  return { status: created ? 'issued' : 'resent' }
}

const hasOfferConsent = (registration) => !!registration.offer_consent_at && !registration.offer_consent_withdrawn_at

async function issueConferencePassBatch(req, res, supabase) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  await requireConferenceAdmin(req, supabase)
  assertPassSalesOpen()

  const event = await getOfferEvent(supabase, String(req.body?.slug || 'premiere-conference-mediumia').trim())

  const limit = Math.min(10, Math.max(1, Number(req.body?.limit) || 5))
  const { data: registrations, error: registrationsError } = await supabase
    .from('conference_registrations')
    .select('id,email_normalized,first_name,status,created_at,offer_consent_at,offer_consent_withdrawn_at')
    .eq('event_id', event.id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: true })
  if (registrationsError) throw new Error('registration_lookup_failed')

  // Seuls les inscrits ayant demandé leur Pass (accord explicite) reçoivent l'offre.
  const consented = (registrations || []).filter(hasOfferConsent)

  const { data: existingPasses, error: passesError } = await supabase
    .from('conference_passes')
    .select('registration_id')
    .eq('event_id', event.id)
  if (passesError) throw new Error('pass_lookup_failed')

  const existing = new Set((existingPasses || []).map((row) => row.registration_id))
  const pending = consented.filter((registration) => !existing.has(registration.id))
  const counts = { issued: 0, failed: 0, uncertain: 0 }

  for (const registration of pending.slice(0, limit)) {
    const result = await deliverPass(supabase, req, event, registration)
    if (result.status === 'issued') counts.issued += 1
    else if (result.status === 'uncertain') counts.uncertain += 1
    else counts.failed += 1
  }

  const { data: afterPasses } = await supabase.from('conference_passes').select('registration_id').eq('event_id', event.id)
  const afterExisting = new Set((afterPasses || []).map((row) => row.registration_id))

  return res.status(200).json({
    ok: true,
    ...counts,
    remaining: consented.filter((registration) => !afterExisting.has(registration.id)).length,
    totalConsented: consented.length,
    withoutConsent: (registrations || []).length - consented.length,
  })
}

// Demande de Pass par l'inscrit lui-même : enregistre son accord puis envoie (ou
// renvoie) son lien. La réponse est identique, que l'adresse soit inscrite ou non.
async function requestConferencePass(req, res, supabase) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const accepted = { ok: true, message: 'request_received' }

  if (req.body?.consent !== true) throw new Error('consent_required')
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error('invalid_email')
  if (String(req.body?.website || '').trim()) return res.status(202).json(accepted)

  assertPassSalesOpen()
  const event = await getOfferEvent(supabase, String(req.body?.slug || '').trim())

  const eventEnd = event.ends_at ? new Date(event.ends_at).getTime() : NaN
  const deadline = requestDeadline(event)
  if (deadline && Date.now() > deadline.getTime()) throw new Error('offer_closed')

  const { data: registration, error } = await supabase
    .from('conference_registrations')
    .select('id,email_normalized,first_name,status,created_at')
    .eq('event_id', event.id)
    .eq('email_normalized', email)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (error) throw new Error('registration_lookup_failed')
  // Offre réservée aux personnes inscrites avant la fin de la conférence.
  if (!registration || (Number.isFinite(eventEnd) && new Date(registration.created_at).getTime() > eventEnd)) {
    return res.status(202).json(accepted)
  }

  const consentAt = new Date().toISOString()
  const { error: consentError } = await supabase
    .from('conference_registrations')
    .update({ offer_consent_at: consentAt, offer_consent_source: 'pass_request', offer_consent_version: OFFER_CONSENT_VERSION, offer_consent_withdrawn_at: null, updated_at: consentAt })
    .eq('id', registration.id)
  if (consentError) throw new Error('consent_record_failed')
  await logPassEvent(supabase, { event_id: event.id, registration_id: registration.id, event_name: 'pass_requested', metadata: { consentVersion: OFFER_CONSENT_VERSION } })

  await deliverPass(supabase, req, event, { ...registration, offer_consent_at: consentAt })
  return res.status(202).json(accepted)
}

function statusForCode(code) {
  if (['invalid_pass', 'invalid_order_id', 'invalid_event_slug', 'consent_required', 'invalid_email'].includes(code)) return 400
  if (['pass_payment_disabled', 'consent_missing'].includes(code)) return 409
  if (code === 'offer_closed') return 410
  if (code === 'admin_unauthenticated') return 401
  if (code === 'admin_forbidden') return 403
  if (code === 'pass_issue_too_early') return 409
  if (['expired', 'already_redeemed', 'registration_cancelled'].includes(code)) return 409
  if (['not_found', 'offer_not_configured', 'offer_disabled'].includes(code)) return 404
  if (['paypal_not_configured', 'supabase_not_configured'].includes(code)) return 500
  return 502
}

export async function handleConferencePassPayPal(req, res, action, { supabase: injected } = {}) {
  res.setHeader('Cache-Control', 'no-store')
  if (!injected && !isSupabaseConfigured()) return res.status(500).json({ error: 'supabase_not_configured' })
  const supabase = injected || getSupabaseAdmin()

  try {
    if (action === 'issue-batch') {
      return await issueConferencePassBatch(req, res, supabase)
    }

    if (action === 'request') {
      return await requestConferencePass(req, res, supabase)
    }

    if (action === 'offer') {
      return await offerInfo(req, res, supabase)
    }

    if (action === 'config' || action === 'validate' || action === 'create') {
      const token = normalizeToken(req.body?.passToken || req.query?.passToken)
      const tokenHash = sha256Hex(token)
      const pass = await validatePassByHash(supabase, tokenHash)
      if (!pass?.ok) return res.status(statusForCode(pass?.reason)).json({ error: pass?.reason || 'invalid_pass' })

      if (action === 'validate' || action === 'config') {
        if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
        return await configResponse(req, res, pass)
      }

      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      if (!pass.offerEnabled || !pass.offerAmountCents) return res.status(404).json({ error: 'offer_disabled' })
      const cfg = runtimeConfig(pass.offerAmountCents)
      return await createCheckout(req, res, cfg, tokenHash, supabase)
    }

    if (action === 'capture') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      return await captureCheckout(req, res, normalizeOrderId(req.body?.orderId), supabase)
    }

    if (action === 'status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      const orderId = normalizeOrderId(req.query?.orderId)
      const pass = await getReservedPass(supabase, orderId)
      return res.status(200).json({
        orderId,
        passStatus: pass.status,
        redeemed: !!pass.redeemed_at,
        captured: !!pass.paypal_capture_id,
      })
    }

    return res.status(400).json({ error: 'invalid_conference_pass_action' })
  } catch (error) {
    const code = error?.message || 'conference_pass_error'
    console.error('[conference-pass-paypal] failed:', code)
    // A capture error can happen after PayPal has accepted the payment but before
    // provisioning/redeem completes. Keep the server-side hold for retry or manual
    // reconciliation instead of silently releasing a potentially paid pass.
    return res.status(statusForCode(code)).json({ error: code })
  }
}

export const __conferencePassPayPalTest = {
  PASS_PRODUCT,
  TERMS_VERSION,
  OFFER_CONSENT_VERSION,
  TERMS_CUSTOM_ID,
  runtimeConfig,
  validateCompletedOrder,
  normalizeToken,
  normalizeOrderId,
  formationRuntimeConfig: __paypalFormationTest.runtimeConfig,
}
