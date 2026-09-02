import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'

const FOLLOW_AMOUNT = '7.90'
const FOLLOW_AMOUNT_CENTS = 790
const FOLLOW_CURRENCY = 'EUR'
const FOLLOW_DAYS = 90
const FOLLOW_RETURNS = 2
const FOLLOW_REFERENCE = 'CHRONOSPHERE_FOLLOW_90_SANDBOX'
const FOLLOW_PRODUCT = 'chronosphere-follow-90'
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com'

function assertPreview() {
  if (process.env.VERCEL_ENV === 'production') throw new Error('not_found')
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function validOrderId(value) {
  return /^[A-Za-z0-9_-]{5,80}$/.test(String(value || '').trim())
}

function validFollowToken(value) {
  return /^[A-Za-z0-9_-]{32,100}$/.test(String(value || '').trim())
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function makeFollowToken() {
  return randomBytes(32).toString('base64url')
}

function customId(lineId) {
  return `CHRONOSPHERE_FOLLOW:${lineId}`
}

function publicPlan(row) {
  const maxReturns = Number(row?.max_returns) || FOLLOW_RETURNS
  const usedReturns = Number(row?.used_returns) || 0
  const active = row?.status === 'active' && new Date(row.expires_at).getTime() > Date.now() && usedReturns < maxReturns
  return {
    status: active ? 'active' : row?.status || 'unknown',
    active,
    lineId: row?.line_id || null,
    activatedAt: row?.activated_at || null,
    expiresAt: row?.expires_at || null,
    maxReturns,
    usedReturns,
    remaining: active ? Math.max(maxReturns - usedReturns, 0) : 0,
    product: row?.product_code || FOLLOW_PRODUCT,
  }
}

async function getAccessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) throw new Error('paypal_not_configured')

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) throw new Error('paypal_auth_failed')
  return data.access_token
}

async function fetchOrder(accessToken, orderId) {
  const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}

async function captureOrder(accessToken, orderId) {
  const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `chronosphere-follow-${orderId}`.slice(0, 108),
    },
  })
  let data = await response.json().catch(() => ({}))

  if (!response.ok || data.status !== 'COMPLETED') {
    const fetched = await fetchOrder(accessToken, orderId)
    if (!fetched.response.ok || fetched.data.status !== 'COMPLETED') throw new Error('paypal_capture_failed')
    data = fetched.data
  }
  return data
}

function verifyCompletedOrder(data, lineId) {
  const unit = (data.purchase_units || []).find(item => item.reference_id === FOLLOW_REFERENCE)
  const capture = unit?.payments?.captures?.find(item => item.status === 'COMPLETED')
  if (!unit || !capture?.id) throw new Error('paypal_payment_invalid')
  if (unit.custom_id !== customId(lineId)) throw new Error('paypal_line_mismatch')
  if (capture.amount?.currency_code !== FOLLOW_CURRENCY || capture.amount?.value !== FOLLOW_AMOUNT) {
    throw new Error('paypal_amount_mismatch')
  }
  return {
    orderId: data.id,
    captureId: capture.id,
    capturedAt: capture.create_time || new Date().toISOString(),
  }
}

async function refreshPlanRow(supabase, row) {
  if (!row) return null
  let status = row.status
  const expired = new Date(row.expires_at).getTime() <= Date.now()
  const exhausted = Number(row.used_returns) >= Number(row.max_returns)
  if (status === 'active' && expired) status = 'expired'
  else if (status === 'active' && exhausted) status = 'exhausted'

  if (status !== row.status) {
    const { data, error } = await supabase
      .from('oracle_timeline_follow_plans')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error) throw new Error('follow_status_update_failed')
    return data
  }
  return row
}

async function findPlanByLine(supabase, lineId) {
  const { data, error } = await supabase
    .from('oracle_timeline_follow_plans')
    .select('*')
    .eq('line_id', lineId)
    .maybeSingle()
  if (error) throw new Error('follow_plan_read_failed')
  return refreshPlanRow(supabase, data)
}

async function findAuthorizedPlan(supabase, lineId, followToken) {
  const hash = tokenHash(followToken)
  const { data, error } = await supabase
    .from('oracle_timeline_follow_plans')
    .select('*')
    .eq('line_id', lineId)
    .eq('token_hash', hash)
    .maybeSingle()
  if (error) throw new Error('follow_plan_read_failed')
  return refreshPlanRow(supabase, data)
}

async function provisionFollowPlan(lineId, payment) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured')
  const supabase = getSupabaseAdmin()

  const { data: existingOrder, error: orderError } = await supabase
    .from('oracle_timeline_follow_plans')
    .select('*')
    .eq('paypal_order_id', payment.orderId)
    .maybeSingle()
  if (orderError) throw new Error('follow_plan_read_failed')

  const freshToken = makeFollowToken()
  const freshHash = tokenHash(freshToken)

  if (existingOrder) {
    if (existingOrder.line_id !== lineId || existingOrder.paypal_capture_id !== payment.captureId) {
      throw new Error('follow_purchase_mismatch')
    }
    const { data, error } = await supabase
      .from('oracle_timeline_follow_plans')
      .update({ token_hash: freshHash, updated_at: new Date().toISOString() })
      .eq('id', existingOrder.id)
      .select('*')
      .single()
    if (error) throw new Error('follow_token_rotate_failed')
    return { plan: publicPlan(await refreshPlanRow(supabase, data)), followToken: freshToken, alreadyProvisioned: true }
  }

  const existingLine = await findPlanByLine(supabase, lineId)
  if (existingLine) throw new Error('follow_line_already_registered')

  const activatedAt = new Date(payment.capturedAt)
  const expiresAt = new Date(activatedAt.getTime() + FOLLOW_DAYS * 24 * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from('oracle_timeline_follow_plans')
    .insert({
      line_id: lineId,
      token_hash: freshHash,
      paypal_order_id: payment.orderId,
      paypal_capture_id: payment.captureId,
      paypal_env: 'sandbox',
      product_code: FOLLOW_PRODUCT,
      amount_cents: FOLLOW_AMOUNT_CENTS,
      currency: FOLLOW_CURRENCY,
      status: 'active',
      activated_at: activatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      max_returns: FOLLOW_RETURNS,
      used_returns: 0,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error('follow_plan_insert_failed')

  return { plan: publicPlan(data), followToken: freshToken, alreadyProvisioned: false }
}

async function createPayPalOrder(lineId) {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured')
  const supabase = getSupabaseAdmin()
  const existing = await findPlanByLine(supabase, lineId)
  if (existing) throw new Error('follow_line_already_registered')

  const accessToken = await getAccessToken()
  const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': randomUUID(),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: FOLLOW_REFERENCE,
        custom_id: customId(lineId),
        description: 'CHRONOSPHERE 999 — suivi de ligne 90 jours · 2 retours',
        amount: { currency_code: FOLLOW_CURRENCY, value: FOLLOW_AMOUNT },
      }],
      payment_source: {
        paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } },
      },
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id) throw new Error('paypal_create_order_failed')
  return data.id
}

function errorStatus(code) {
  if (code === 'not_found') return 404
  if (code === 'invalid_line_id' || code === 'invalid_order_id' || code === 'invalid_follow_token') return 400
  if (code === 'follow_not_found') return 404
  if (code === 'follow_not_active' || code === 'follow_line_already_registered') return 409
  if (code === 'paypal_not_configured' || code === 'supabase_not_configured') return 500
  return 502
}

export async function handleOracleFollowPayPal(req, res, action) {
  try {
    assertPreview()
  } catch (error) {
    return res.status(404).json({ error: 'not_found' })
  }

  try {
    if (action === 'config') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })
      const clientId = String(process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '').trim()
      if (!clientId) throw new Error('paypal_not_configured')
      return res.status(200).json({
        clientId,
        amount: FOLLOW_AMOUNT,
        currency: FOLLOW_CURRENCY,
        days: FOLLOW_DAYS,
        maxReturns: FOLLOW_RETURNS,
        env: 'sandbox',
      })
    }

    if (!isSupabaseConfigured()) throw new Error('supabase_not_configured')
    const supabase = getSupabaseAdmin()

    if (action === 'create') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      const lineId = String(req.body?.lineId || '').trim()
      if (!validUuid(lineId)) throw new Error('invalid_line_id')
      const id = await createPayPalOrder(lineId)
      return res.status(201).json({ id })
    }

    if (action === 'capture') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      const lineId = String(req.body?.lineId || '').trim()
      const orderId = String(req.body?.orderId || '').trim()
      if (!validUuid(lineId)) throw new Error('invalid_line_id')
      if (!validOrderId(orderId)) throw new Error('invalid_order_id')

      const accessToken = await getAccessToken()
      const completed = await captureOrder(accessToken, orderId)
      const payment = verifyCompletedOrder(completed, lineId)
      const provisioned = await provisionFollowPlan(lineId, payment)
      return res.status(200).json({
        status: completed.status,
        orderId: payment.orderId,
        captureId: payment.captureId,
        plan: provisioned.plan,
        followToken: provisioned.followToken,
        alreadyProvisioned: provisioned.alreadyProvisioned,
      })
    }

    if (action === 'status') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      const lineId = String(req.body?.lineId || '').trim()
      const followToken = String(req.body?.followToken || '').trim()
      if (!validUuid(lineId)) throw new Error('invalid_line_id')
      if (!validFollowToken(followToken)) throw new Error('invalid_follow_token')
      const row = await findAuthorizedPlan(supabase, lineId, followToken)
      if (!row) throw new Error('follow_not_found')
      return res.status(200).json({ plan: publicPlan(row) })
    }

    if (action === 'consume') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
      const lineId = String(req.body?.lineId || '').trim()
      const followToken = String(req.body?.followToken || '').trim()
      if (!validUuid(lineId)) throw new Error('invalid_line_id')
      if (!validFollowToken(followToken)) throw new Error('invalid_follow_token')

      const { data, error } = await supabase.rpc('oracle_consume_follow_return', {
        p_line_id: lineId,
        p_token_hash: tokenHash(followToken),
      })
      if (error) throw new Error('follow_consume_failed')
      if (!data || data.status === 'not_found') throw new Error('follow_not_found')
      if (data.status !== 'consumed') {
        return res.status(409).json({ error: 'follow_not_active', plan: data })
      }
      return res.status(200).json({ plan: data })
    }

    return res.status(400).json({ error: 'invalid_follow_action' })
  } catch (error) {
    const code = error?.message || 'follow_unavailable'
    console.error('[chronosphere-follow]', action, code)
    return res.status(errorStatus(code)).json({ error: code })
  }
}
