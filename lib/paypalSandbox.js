import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'

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

function runtimeConfig(forcedEnv = null) {
  const env = forcedEnv || String(process.env.PAYPAL_ENV || '').trim().toLowerCase()
  if (!CONFIGS[env]) throw new Error('paypal_env_invalid')

  if (forcedEnv === 'sandbox') {
    if (process.env.VERCEL_ENV === 'production') throw new Error('not_found')
    if (String(process.env.PAYPAL_ENV || '').trim().toLowerCase() !== 'sandbox') {
      throw new Error('paypal_env_mismatch')
    }
  } else if (process.env.VERCEL_ENV === 'production') {
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

function verifiedPayment(cfg, data) {
  const unit = (data.purchase_units || []).find(u => u.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find(c => c.status === 'COMPLETED')
  const payerEmail = String(data.payer?.email_address || '').trim().toLowerCase()

  if (!unit || !capture?.id || !payerEmail) throw new Error('paypal_payment_invalid')
  if (capture.amount?.currency_code !== cfg.currency || capture.amount?.value !== cfg.amount) {
    throw new Error('paypal_amount_mismatch')
  }

  return {
    orderId: data.id,
    captureId: capture.id,
    payerEmail,
    amount: capture.amount,
    amountCents: cents(capture.amount.value),
    capturedAt: capture.create_time || new Date().toISOString(),
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

  // Une création concurrente peut avoir gagné entre le lookup et createUser.
  userId = await lookup()
  if (userId) return userId
  throw new Error('supabase_user_create_failed')
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

  if (!existing) {
    const { error: insertError } = await supabase.from('mediumia_paypal_purchases').insert({
      paypal_order_id: payment.orderId,
      paypal_capture_id: payment.captureId,
      payer_email: payment.payerEmail,
      amount_cents: payment.amountCents,
      currency: payment.amount.currency_code,
      paypal_env: cfg.env,
      status: 'captured',
      captured_at: payment.capturedAt,
    })
    if (insertError && insertError.code !== '23505') throw new Error('purchase_log_insert_failed')
  } else {
    const { error: updateError } = await supabase
      .from('mediumia_paypal_purchases')
      .update({
        paypal_capture_id: payment.captureId,
        payer_email: payment.payerEmail,
        amount_cents: payment.amountCents,
        currency: payment.amount.currency_code,
        paypal_env: cfg.env,
        status: 'captured',
        failure_code: null,
      })
      .eq('paypal_order_id', payment.orderId)
    if (updateError) throw new Error('purchase_log_update_failed')
  }

  try {
    const userId = await findOrCreateMediumiaUser(supabase, payment.payerEmail)
    const originRef = `paypal:${cfg.env}:${payment.captureId}`
    const { data: grant, error: grantError } = await supabase.rpc('mediumia_grant_purchase_atomic', {
      p_user_id: userId,
      p_origin_ref: originRef,
      p_duration_days: 365,
    })

    if (grantError || !grant || !['granted', 'already_granted'].includes(grant.status)) {
      throw new Error('entitlement_grant_failed')
    }

    const { error: finalError } = await supabase
      .from('mediumia_paypal_purchases')
      .update({
        status: 'provisioned',
        user_id: userId,
        entitlement_id: grant.entitlement_id,
        provisioned_at: new Date().toISOString(),
        failure_code: null,
      })
      .eq('paypal_order_id', payment.orderId)

    if (finalError) throw new Error('purchase_finalize_failed')

    if (cfg.env === 'live') {
      const h = escapeHtml
      await sendEmail({
        to: payment.payerEmail,
        subject: 'Votre accès MediumIA est activé',
        html: `<div style="font-family:Georgia,serif;color:#1A1535;max-width:620px"><h2 style="color:#C9A84C">Bienvenue dans MediumIA</h2><p>Votre paiement a bien été confirmé et votre accès de 12 mois est activé.</p><p>Connectez-vous à votre espace élève avec la même adresse e-mail que celle utilisée pour votre paiement PayPal.</p><p><a href="https://espace.mediumia.fr" style="color:#1A1535;font-weight:700">Accéder à mon espace élève →</a></p><p style="font-size:13px;color:#716b7c">Expiration de l’accès : ${h(new Date(grant.access_expires_at).toLocaleDateString('fr-FR'))}</p></div>`,
        text: `Bienvenue dans MediumIA\n\nVotre paiement a bien été confirmé et votre accès de 12 mois est activé.\n\nConnectez-vous avec la même adresse e-mail que celle utilisée pour votre paiement PayPal : https://espace.mediumia.fr\n\nExpiration de l'accès : ${new Date(grant.access_expires_at).toLocaleDateString('fr-FR')}`,
        idempotencyKey: `mediumia-access-${payment.captureId}`,
      })
    }

    return {
      status: 'provisioned',
      entitlementId: grant.entitlement_id,
      accessExpiresAt: grant.access_expires_at,
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

  if (action === 'config') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const clientId = String(process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()
    if (!clientId) return res.status(500).json({ error: 'paypal_not_configured' })
    return res.status(200).json({ clientId, amount: cfg.amount, currency: cfg.currency, env: cfg.env })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    try {
      const accessToken = await getAccessToken(cfg)
      const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': randomUUID(),
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: cfg.referenceId,
            description: cfg.description,
            amount: { currency_code: cfg.currency, value: cfg.amount },
          }],
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
      const payment = verifiedPayment(cfg, completedOrder)
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
