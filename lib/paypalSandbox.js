import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'

const TERMS_VERSION = 'formation-2026-09-01-v1'
const TERMS_CUSTOM_ID = `MEDIUMIA:${TERMS_VERSION}:IMMEDIATE_ACCESS`
const PDF_DELIVERY_DAYS = 30

const CONFIGS = {
  sandbox: {
    base: 'https://api-m.sandbox.paypal.com',
    amount: '1.00',
    currency: 'EUR',
    referenceId: 'MEDIUMIA_FORMATION_SANDBOX',
    description: 'MediumIA — test Sandbox avec accès élève',
  },
  live: {
    base: 'https://api-m.paypal.com',
    amount: '597.00',
    currency: 'EUR',
    referenceId: 'MEDIUMIA_FORMATION_597',
    description: 'MediumIA — Accompagnement à la Médiumnité Consciente',
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

function runtimeConfig(forcedEnv = null) {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const configuredEnv = String(process.env.PAYPAL_ENV || '').trim().toLowerCase()
  const env = forcedEnv || (isProduction ? configuredEnv : 'sandbox')

  if (!CONFIGS[env]) throw new Error('paypal_env_invalid')

  if (forcedEnv === 'sandbox') {
    if (isProduction) throw new Error('not_found')
  } else if (isProduction) {
    if (env !== 'live') throw new Error('paypal_env_mismatch')
    if (process.env.PAYPAL_FORMATION_ENABLED !== 'true') throw new Error('paypal_disabled')
  } else if (env !== 'sandbox') {
    throw new Error('paypal_env_mismatch')
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

function verifiedPayment(cfg, data, { requireConsent = false } = {}) {
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

  const acceptedAt = data.create_time || capture.create_time || new Date().toISOString()

  return {
    orderId: data.id,
    captureId: capture.id,
    payerEmail,
    payerName: paypalName || fallbackNameFromEmail(payerEmail),
    amount: capture.amount,
    amountCents: cents(capture.amount.value),
    capturedAt: capture.create_time || new Date().toISOString(),
    termsVersion: requireConsent ? TERMS_VERSION : null,
    termsAcceptedAt: requireConsent ? acceptedAt : null,
    immediateAccessAcceptedAt: requireConsent ? acceptedAt : null,
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

async function provisionAccess(cfg, payment) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured')
  const supabase = getSupabaseAdmin()

  const { data: existing, error: existingError } = await supabase
    .from('mediumia_paypal_purchases')
    .select('id, status, paypal_capture_id, entitlement_id, user_id')
    .eq('paypal_order_id', payment.orderId)
    .maybeSingle()

  if (existingError) throw new Error('purchase_log_read_failed')
  if (existing?.paypal_capture_id && existing.paypal_capture_id !== payment.captureId) {
    throw new Error('purchase_capture_mismatch')
  }
  if (existing?.status === 'provisioned' && existing.entitlement_id) {
    return { status: 'provisioned', entitlementId: existing.entitlement_id, alreadyProvisioned: true }
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
    const userId = await findOrCreateMediumiaUser(supabase, payment.payerEmail)

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

    const originRef = `paypal:${cfg.env}:${payment.captureId}`
    const { data: grant, error: grantError } = await supabase.rpc('mediumia_grant_purchase_atomic', {
      p_user_id: userId,
      p_origin_ref: originRef,
      p_duration_days: 365,
    })

    if (grantError || !grant || !['granted', 'already_granted'].includes(grant.status)) {
      throw new Error('entitlement_grant_failed')
    }

    const pdfDelivery = makePdfDeliveryToken()
    const pdfDownloadUrl = `https://espace.mediumia.fr/api/purchase-pdf?token=${encodeURIComponent(pdfDelivery.token)}`

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

    if (cfg.env === 'live') {
      const h = escapeHtml
      await sendEmail({
        to: payment.payerEmail,
        subject: 'Votre accès MediumIA est activé',
        html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Bienvenue dans MediumIA</h2><p>Votre paiement a bien été confirmé et votre accès de 12 mois est activé.</p><p>Connectez-vous à votre espace élève avec la même adresse e-mail que celle utilisée pour votre paiement PayPal.</p><p><a href="https://espace.mediumia.fr" style="color:#1A1535;font-weight:700">Accéder à mon espace élève →</a></p><p>Votre livre numérique personnel vous est envoyé dans un e-mail séparé.</p><p style="font-size:13px;color:#716b7c">Expiration de l’accès : ${h(new Date(grant.access_expires_at).toLocaleDateString('fr-FR'))}</p></div>`,
        text: `Bienvenue dans MediumIA\n\nVotre paiement a bien été confirmé et votre accès de 12 mois est activé.\n\nConnectez-vous avec la même adresse e-mail que celle utilisée pour votre paiement PayPal : https://espace.mediumia.fr\n\nVotre livre numérique personnel vous est envoyé dans un e-mail séparé.\n\nExpiration de l'accès : ${new Date(grant.access_expires_at).toLocaleDateString('fr-FR')}`,
        idempotencyKey: `mediumia-access-${payment.captureId}`,
      })

      await sendEmail({
        to: payment.payerEmail,
        subject: 'Votre livre MediumIA personnel',
        html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Votre exemplaire personnel MediumIA</h2><p>Bonjour ${h(student.display_name || payment.payerName)},</p><p>Votre livre complet est préparé spécialement pour vous. Votre nom et votre numéro de licence <strong>${h(student.license_number)}</strong> seront inscrits sur chaque page.</p><p><a href="${h(pdfDownloadUrl)}" style="display:inline-block;background:#C9A84C;color:#1A1535;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700">Télécharger mon livre personnel →</a></p><p style="font-size:13px;color:#716b7c">Ce lien privé est valable ${PDF_DELIVERY_DAYS} jours. Conservez ensuite votre PDF personnel sur votre appareil.</p><p style="font-size:12px;color:#8a8492">Ce document est nominatif et destiné à votre usage personnel.</p></div>`,
        text: `Votre livre MediumIA personnel\n\nBonjour ${student.display_name || payment.payerName},\n\nVotre livre complet est préparé spécialement pour vous. Votre nom et votre numéro de licence ${student.license_number} seront inscrits sur chaque page.\n\nTélécharger : ${pdfDownloadUrl}\n\nCe lien privé est valable ${PDF_DELIVERY_DAYS} jours.`,
        idempotencyKey: `mediumia-book-${payment.captureId}`,
      })
    }

    return {
      status: 'provisioned',
      entitlementId: grant.entitlement_id,
      accessExpiresAt: grant.access_expires_at,
      licenseNumber: student.license_number,
      bookDelivery: cfg.env === 'live' ? 'email' : 'sandbox_link',
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

async function handle(req, res, action, forcedEnv = null) {
  let cfg
  try {
    cfg = runtimeConfig(forcedEnv)
  } catch (error) {
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
    return res.status(200).json({ clientId, amount: cfg.amount, currency: cfg.currency, env: cfg.env })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    if (requireConsent && (req.body?.termsAccepted !== true || req.body?.immediateAccessAccepted !== true)) {
      return res.status(400).json({ error: 'consent_required' })
    }

    try {
      const accessToken = await getAccessToken(cfg)
      const purchaseUnit = {
        reference_id: cfg.referenceId,
        description: cfg.description,
        amount: { currency_code: cfg.currency, value: cfg.amount },
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
      return res.status(201).json({ id: data.id })
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
      const accessToken = await getAccessToken(cfg)
      const completedOrder = await captureOrder(cfg, accessToken, orderId)
      const payment = verifiedPayment(cfg, completedOrder, { requireConsent })
      const access = await provisionAccess(cfg, payment)
      return res.status(200).json({
        status: completedOrder.status,
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

  return res.status(400).json({ error: 'invalid_paypal_action' })
}

export async function handlePayPalSandbox(req, res, action) {
  return handle(req, res, action, 'sandbox')
}

export async function handlePayPalCheckout(req, res, action) {
  return handle(req, res, action, null)
}
