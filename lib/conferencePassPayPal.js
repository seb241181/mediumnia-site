/* global Buffer, process */

import { createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { __paypalFormationTest } from './paypalSandbox.js'

const PASS_PRODUCT = 'conference_pass_full'
const TERMS_VERSION = 'conference-pass-2026-09-15-v1'
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
    .select('id,event_id,registration_id,status,paypal_order_id,paypal_capture_id,paypal_env,amount_cents,currency,reference_id,redeemed_at,expires_at')
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
    .select('id,event_id,registration_id,status,paypal_order_id,paypal_capture_id,paypal_env,amount_cents,currency,reference_id,redeemed_at,expires_at')
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

async function createCheckout(req, res, cfg, tokenHash) {
  const accessToken = await getAccessToken(cfg)
  const supabase = getSupabaseAdmin()
  const pass = await getPassByHash(supabase, tokenHash)

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

async function captureCheckout(req, res, orderId) {
  const supabase = getSupabaseAdmin()
  const pass = await getReservedPass(supabase, orderId)

  if (pass.paypal_capture_id && pass.redeemed_at) {
    return res.status(200).json({ status: 'COMPLETED', alreadyProvisioned: true, access: { status: 'provisioned' } })
  }

  const { data: event, error: eventError } = await supabase
    .from('conference_events')
    .select('pass_offer_amount_cents,pass_offer_currency,pass_offer_enabled')
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
  const { userId, grant } = await grantFullAccess(supabase, { ...verified, registrationId: pass.registration_id, env: cfg.env })

  const redeemed = await supabase.rpc('redeem_conference_pass_after_payment', {
    p_paypal_order_id: orderId,
    p_paypal_capture_id: verified.captureId,
    p_user_id: userId,
    p_entitlement_id: grant.entitlement_id,
  })
  if (redeemed.error) throw new Error('pass_redeem_failed')
  if (!redeemed.data?.ok) throw new Error(redeemed.data?.reason || 'pass_redeem_failed')

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

function statusForCode(code) {
  if (['invalid_pass', 'invalid_order_id'].includes(code)) return 400
  if (['expired', 'already_redeemed', 'registration_cancelled'].includes(code)) return 409
  if (['not_found', 'offer_not_configured', 'offer_disabled'].includes(code)) return 404
  if (['paypal_not_configured', 'supabase_not_configured'].includes(code)) return 500
  return 502
}

export async function handleConferencePassPayPal(req, res, action) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isSupabaseConfigured()) return res.status(500).json({ error: 'supabase_not_configured' })

  try {
    if (action === 'config' || action === 'validate' || action === 'create') {
      const token = normalizeToken(req.body?.passToken || req.query?.passToken)
      const tokenHash = sha256Hex(token)
      const pass = await validatePassByHash(getSupabaseAdmin(), tokenHash)
      if (!pass?.ok) return res.status(statusForCode(pass?.reason)).json({ error: pass?.reason || 'invalid_pass' })

      if (action === 'validate' || action === 'config') {
        if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
        return await configResponse(req, res, pass)
      }

      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      if (!pass.offerEnabled || !pass.offerAmountCents) return res.status(404).json({ error: 'offer_disabled' })
      const cfg = runtimeConfig(pass.offerAmountCents)
      return await createCheckout(req, res, cfg, tokenHash)
    }

    if (action === 'capture') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      return await captureCheckout(req, res, normalizeOrderId(req.body?.orderId))
    }

    if (action === 'status') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      const orderId = normalizeOrderId(req.query?.orderId)
      const pass = await getReservedPass(getSupabaseAdmin(), orderId)
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
  TERMS_CUSTOM_ID,
  runtimeConfig,
  validateCompletedOrder,
  normalizeToken,
  normalizeOrderId,
  formationRuntimeConfig: __paypalFormationTest.runtimeConfig,
}
