/* global process */
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const PACK_CREDITS = 3
const PACK_CONSENT_VERSION = 'chronosphere-2026-09-05-pack3-v1'
const SINGLE_CONSENT_VERSION = 'chronosphere-2026-09-05-single-v2'
const LEGACY_CONSENT_VERSION = 'chronosphere-2026-09-02-v1'

const PACK_CONFIGS = {
  sandbox: { base: 'https://api-m.sandbox.paypal.com', amount: '1.00', displayAmount: '9.90', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONOSPHERE_PACK3_SANDBOX_100', description: 'CHRONOSPHERE 999 — Pack de 3 tirages' },
  live: { base: 'https://api-m.paypal.com', amount: '9.90', displayAmount: '9.90', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONOSPHERE_PACK3_990', description: 'CHRONOSPHERE 999 — Pack de 3 tirages' },
}
const SINGLE_CONFIGS = {
  sandbox: { base: 'https://api-m.sandbox.paypal.com', amount: '1.00', displayAmount: '5.00', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONOSPHERE_SINGLE_SANDBOX_100', description: 'CHRONOSPHERE 999 — Tirage unique' },
  live: { base: 'https://api-m.paypal.com', amount: '5.00', displayAmount: '5.00', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONOSPHERE_SINGLE_500', description: 'CHRONOSPHERE 999 — Tirage unique' },
}
const LEGACY_CONFIGS = {
  sandbox: { base: 'https://api-m.sandbox.paypal.com', amount: '1.00', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONO_SANDBOX', description: 'CHRONOSPHERE 999 — test Sandbox' },
  live: { base: 'https://api-m.paypal.com', amount: '5.00', currency: 'EUR', referenceId: 'MEDIUMIA_CHRONOSPHERE_5', description: 'CHRONOSPHERE 999 — Tirage Oracle des Lignes de Temps' },
}

function cents(value) {
  if (!/^\d+\.\d{2}$/.test(String(value || ''))) return null
  return Math.round(Number(value) * 100)
}

function consentCustomId(version) { return `MEDIUMIA:${version}:CHRONOSPHERE` }

function runtimeConfig(configs = PACK_CONFIGS) {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const env = isProduction ? 'live' : 'sandbox'
  if (isProduction && process.env.PAYPAL_CHRONOSPHERE_ENABLED !== 'true') throw new Error('chronosphere_paypal_disabled')
  return { env, ...configs[env] }
}

async function getAccessToken(cfg) {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
  })
  if (!response.ok) throw new Error('paypal_auth_failed')
  const data = await response.json()
  if (!data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function captureOrder(cfg, accessToken, orderId) {
  const response = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `chrono-capture-${orderId}`.slice(0, 108) },
  })
  let data = await response.json().catch(() => ({}))
  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const fetchedData = await fetched.json().catch(() => ({}))
    if (!fetched.ok || fetchedData.status !== 'COMPLETED') throw new Error('paypal_capture_failed')
    data = fetchedData
  }
  return data
}

function verifiedPayment(cfg, data, expectedCustomId) {
  const unit = (data.purchase_units || []).find((entry) => entry.reference_id === cfg.referenceId)
  const capture = unit?.payments?.captures?.find((entry) => entry.status === 'COMPLETED')
  if (!unit || !capture?.id) throw new Error('paypal_payment_invalid')
  if (capture.amount?.currency_code !== cfg.currency || capture.amount?.value !== cfg.amount) throw new Error('paypal_amount_mismatch')
  const echoedCustomId = unit.custom_id || capture.custom_id || null
  if (echoedCustomId && echoedCustomId !== expectedCustomId) throw new Error('paypal_consent_mismatch')
  return { orderId: data.id, captureId: capture.id, amount: capture.amount, capturedAt: capture.create_time || new Date().toISOString() }
}

export function generateChronospherePaymentToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: createHash('sha256').update(token).digest('hex') }
}

export function getChronosphereProductDefinition(product, env) {
  if (env !== 'sandbox' && env !== 'live') return null
  if (product === 'single') {
    return { product, credits: 1, table: 'chronosphere_paid_draws', consentVersion: SINGLE_CONSENT_VERSION, ...SINGLE_CONFIGS[env] }
  }
  if (product === 'pack3') {
    return { product, credits: PACK_CREDITS, table: 'chronosphere_credit_packs', consentVersion: PACK_CONSENT_VERSION, ...PACK_CONFIGS[env] }
  }
  return null
}

async function captureSingleDraw({ supabase, orderId }) {
  const { data: draw, error } = await supabase.from('chronosphere_paid_draws')
    .select('id, status, consent_version, consent_accepted_at, paypal_env, amount_cents, currency, paypal_capture_id')
    .eq('paypal_order_id', orderId).maybeSingle()
  if (error) throw new Error('draw_lookup_failed')
  if (!draw) return null

  const isNewSingle = draw.consent_version === SINGLE_CONSENT_VERSION
  const configs = isNewSingle ? SINGLE_CONFIGS : LEGACY_CONFIGS
  const expectedConsent = isNewSingle ? SINGLE_CONSENT_VERSION : LEGACY_CONSENT_VERSION
  const cfg = runtimeConfig(configs)
  if (draw.consent_version !== expectedConsent || !draw.consent_accepted_at) throw new Error('paypal_consent_mismatch')
  if (draw.paypal_env !== cfg.env || draw.amount_cents !== cents(cfg.amount) || draw.currency !== cfg.currency) throw new Error('paypal_payment_invalid')

  const payment = verifiedPayment(cfg, await captureOrder(cfg, await getAccessToken(cfg), orderId), consentCustomId(expectedConsent))
  if (payment.orderId !== orderId) throw new Error('paypal_payment_invalid')
  const { data: updated, error: updateError } = await supabase.from('chronosphere_paid_draws')
    .update({ status: 'ready', paypal_capture_id: payment.captureId, captured_at: payment.capturedAt })
    .eq('paypal_order_id', payment.orderId).eq('status', 'payment_pending').select('id').maybeSingle()
  if (updateError) throw new Error('capture_update_failed')
  if (!updated) {
    const { data: capturedDraw, error: capturedDrawError } = await supabase.from('chronosphere_paid_draws')
      .select('paypal_capture_id').eq('paypal_order_id', orderId).maybeSingle()
    if (capturedDrawError) throw new Error('draw_lookup_failed')
    if (capturedDraw?.paypal_capture_id !== payment.captureId) throw new Error('capture_update_failed')
  }
  return { status: 'COMPLETED', product: 'single', orderId: payment.orderId, captureId: payment.captureId, amount: payment.amount, legacy: !isNewSingle }
}

export async function handleChronospherePayPal(req, res, action) {
  let packCfg
  let singleCfg
  try {
    packCfg = runtimeConfig(PACK_CONFIGS)
    singleCfg = runtimeConfig(SINGLE_CONFIGS)
  } catch (error) {
    return res.status(error?.message === 'chronosphere_paypal_disabled' ? 404 : 503).json({ error: error?.message === 'chronosphere_paypal_disabled' ? 'not_found' : (error?.message || 'paypal_unavailable') })
  }

  if (action === 'config') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
    const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
    if (!clientId) return res.status(500).json({ error: 'paypal_not_configured' })
    const single = getChronosphereProductDefinition('single', singleCfg.env)
    const pack = getChronosphereProductDefinition('pack3', packCfg.env)
    return res.status(200).json({
      clientId,
      env: packCfg.env,
      products: {
        single: { amount: single.amount, displayAmount: single.displayAmount, currency: single.currency, credits: single.credits, consentVersion: single.consentVersion },
        pack3: { amount: pack.amount, displayAmount: pack.displayAmount, currency: pack.currency, credits: pack.credits, consentVersion: pack.consentVersion },
      },
    })
  }

  if (action === 'status') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const packToken = typeof req.body?.packToken === 'string' ? req.body.packToken.trim() : ''
    if (!packToken || !isSupabaseConfigured()) return res.status(404).json({ valid: false })
    const tokenHash = createHash('sha256').update(packToken).digest('hex')
    const { data: pack, error } = await getSupabaseAdmin().from('chronosphere_credit_packs')
      .select('credits_remaining, credits_total, status').eq('pack_token_hash', tokenHash).maybeSingle()
    if (error) return res.status(503).json({ error: 'pack_status_unavailable' })
    if (!pack) return res.status(404).json({ valid: false })
    return res.status(200).json({ valid: true, creditsRemaining: pack.credits_remaining, creditsTotal: pack.credits_total, status: pack.status })
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    if (req.body?.consentAccepted !== true) return res.status(400).json({ error: 'consent_required' })
    const product = req.body?.product
    const productDefinition = getChronosphereProductDefinition(product, packCfg.env)
    if (!productDefinition) return res.status(400).json({ error: 'invalid_product' })
    if (!isSupabaseConfigured()) return res.status(500).json({ error: 'supabase_not_configured' })
    try {
      const cfg = product === 'single' ? singleCfg : packCfg
      const consentVersion = productDefinition.consentVersion
      const accessToken = await getAccessToken(cfg)
      const response = await fetch(`${cfg.base}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': randomUUID() },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ reference_id: cfg.referenceId, description: cfg.description, amount: { currency_code: cfg.currency, value: cfg.amount }, custom_id: consentCustomId(consentVersion) }],
          payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')
      const token = generateChronospherePaymentToken()
      const supabase = getSupabaseAdmin()
      const { error: insertError } = product === 'single'
        ? await supabase.from('chronosphere_paid_draws').insert({
          draw_token_hash: token.hash, paypal_order_id: data.id, paypal_env: cfg.env, amount_cents: cents(cfg.amount), currency: cfg.currency,
          status: 'payment_pending', consent_version: SINGLE_CONSENT_VERSION, consent_accepted_at: new Date().toISOString(),
        })
        : await supabase.from('chronosphere_credit_packs').insert({
          pack_token_hash: token.hash, paypal_order_id: data.id, paypal_env: cfg.env, amount_cents: cents(cfg.amount), currency: cfg.currency,
          credits_total: PACK_CREDITS, credits_remaining: 0, status: 'payment_pending', consent_version: PACK_CONSENT_VERSION, consent_accepted_at: new Date().toISOString(),
        })
      if (insertError) throw new Error(product === 'single' ? 'draw_insert_failed' : 'pack_insert_failed')
      return product === 'single'
        ? res.status(201).json({ id: data.id, product, drawToken: token.token })
        : res.status(201).json({ id: data.id, product, packToken: token.token, credits: PACK_CREDITS })
    } catch (error) {
      const code = error?.message || 'paypal_create_order_failed'
      console.error('[chronosphere-paypal] create failed:', code)
      return res.status(['paypal_not_configured', 'supabase_not_configured'].includes(code) ? 500 : 502).json({ error: code })
    }
  }

  if (action === 'capture') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : ''
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(orderId)) return res.status(400).json({ error: 'invalid_order_id' })
    if (!isSupabaseConfigured()) return res.status(500).json({ error: 'supabase_not_configured' })
    try {
      const supabase = getSupabaseAdmin()
      const { data: pack, error: lookupError } = await supabase.from('chronosphere_credit_packs')
        .select('id, status, consent_version, consent_accepted_at, paypal_env, amount_cents, currency, paypal_capture_id, credits_remaining, credits_total')
        .eq('paypal_order_id', orderId).maybeSingle()
      if (lookupError) throw new Error('pack_lookup_failed')
      if (!pack) {
        const single = await captureSingleDraw({ supabase, orderId })
        if (single) return res.status(200).json(single)
        throw new Error('pack_not_found')
      }
      if (pack.consent_version !== PACK_CONSENT_VERSION || !pack.consent_accepted_at) throw new Error('paypal_consent_mismatch')
      if (pack.paypal_env !== packCfg.env || pack.amount_cents !== cents(packCfg.amount) || pack.currency !== packCfg.currency) throw new Error('paypal_payment_invalid')
      const payment = verifiedPayment(packCfg, await captureOrder(packCfg, await getAccessToken(packCfg), orderId), consentCustomId(PACK_CONSENT_VERSION))
      if (payment.orderId !== orderId) throw new Error('paypal_payment_invalid')
      const { data: updated, error: updateError } = await supabase.from('chronosphere_credit_packs')
        .update({ status: 'active', credits_remaining: PACK_CREDITS, paypal_capture_id: payment.captureId, captured_at: payment.capturedAt })
        .eq('paypal_order_id', payment.orderId).eq('status', 'payment_pending').select('credits_remaining, credits_total, status, paypal_capture_id').maybeSingle()
      if (updateError) throw new Error('capture_update_failed')
      let state = updated
      if (!state) {
        const { data: capturedPack, error: capturedPackError } = await supabase.from('chronosphere_credit_packs')
          .select('credits_remaining, credits_total, status, paypal_capture_id').eq('paypal_order_id', orderId).maybeSingle()
        if (capturedPackError) throw new Error('pack_lookup_failed')
        if (capturedPack?.paypal_capture_id !== payment.captureId) throw new Error('capture_update_failed')
        state = capturedPack
      }
      return res.status(200).json({ status: 'COMPLETED', product: 'pack3', orderId: payment.orderId, captureId: payment.captureId, amount: payment.amount, creditsRemaining: state.credits_remaining, creditsTotal: state.credits_total, packStatus: state.status })
    } catch (error) {
      const code = error?.message || 'paypal_capture_failed'
      console.error('[chronosphere-paypal] capture failed:', code)
      return res.status(['paypal_not_configured', 'supabase_not_configured'].includes(code) ? 500 : 502).json({ error: code })
    }
  }

  return res.status(400).json({ error: 'invalid_chronosphere_paypal_action' })
}
