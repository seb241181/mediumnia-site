/* global process, Buffer, fetch */
import { createHash } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { PLATFORM_ADMIN_PRACTITIONER_SLUGS } from './pilotageConference.js'
import { CONFERENCE_FIVE_PLAN, summarizeConferenceFiveLedger, conferenceFiveDueDates } from './conferenceFiveInstallments.js'

const TEST_PROJECT = 'wnbwhnqiulsdjcvkuwos'
const BASE = 'https://api-m.sandbox.paypal.com'
const TERMS = 'conference-five-sandbox-DRAFT-no-live-sale'
const ACTIONS = new Set(['offer', 'status', 'invite', 'subscribe', 'sync'])

export function fiveSandboxEnabled(env = process.env) {
  return env.VERCEL_ENV !== 'production'
    && env.CONFERENCE_FIVE_SANDBOX_ENABLED === 'true'
    && String(env.SUPABASE_URL || '').replace(/\/$/, '') === `https://${TEST_PROJECT}.supabase.co`
    && env.PAYPAL_ENV !== 'live'
}
const requestId = (type, id) => createHash('sha256').update(`mediumia-five:${type}:${id}`).digest('hex')
const money = cents => (cents / 100).toFixed(2)
const fromMoney = value => /^\d+\.\d{2}$/.test(String(value)) ? Math.round(Number(value) * 100) : null

export function fivePlanBody(productId) {
  return {
    product_id: productId,
    name: 'MediumIA — Pass conférence 5 mensualités TEST',
    description: 'TEST exclusivement. Pas une offre commerciale en production.',
    status: 'ACTIVE',
    billing_cycles: [{
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      tenure_type: 'REGULAR',
      sequence: 1,
      total_cycles: CONFERENCE_FIVE_PLAN.instalments,
      pricing_scheme: {
        fixed_price: { value: money(CONFERENCE_FIVE_PLAN.instalmentCents), currency_code: 'EUR' },
      },
    }],
    payment_preferences: { auto_bill_outstanding: false, payment_failure_threshold: 1 },
  }
}

export function fiveVerifiedTransactions(transactions, subscriptionId) {
  if (!Array.isArray(transactions) || transactions.length > 100) throw new Error('transactions_invalid')
  const captures = []
  const refunds = []
  const records = []
  const seen = new Set()
  for (const tx of transactions) {
    if (!tx || typeof tx.id !== 'string' || !/^[A-Za-z0-9_-]{3,70}$/.test(tx.id) || seen.has(tx.id)) {
      throw new Error('transaction_reference_invalid')
    }
    seen.add(tx.id)
    const amount = tx.amount_with_breakdown?.gross_amount
    const cents = fromMoney(amount?.value)
    if (amount?.currency_code !== 'EUR' || cents !== CONFERENCE_FIVE_PLAN.instalmentCents) {
      throw new Error('transaction_amount_invalid')
    }
    if (!['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PENDING', 'FAILED', 'DECLINED'].includes(tx.status)) {
      throw new Error('transaction_status_invalid')
    }
    // A partial refund's exact net amount cannot be inferred from this API's gross total.
    // Suspend instead of granting eligibility using a guessed amount.
    if (tx.status === 'PARTIALLY_REFUNDED') throw new Error('partial_refund_requires_review')
    if (tx.status !== 'COMPLETED' && tx.status !== 'REFUNDED') continue
    const time = new Date(tx.time)
    if (!Number.isFinite(time.getTime())) throw new Error('transaction_date_invalid')
    const base = { captureId: tx.id, amountCents: cents, currency: 'EUR', status: 'COMPLETED', paypalEnv: 'sandbox', subscriptionId }
    captures.push(base)
    records.push({ provider_id: tx.id, capture_id: tx.id, kind: 'capture', status: 'COMPLETED', amount_cents: cents, currency: 'EUR', paypal_env: 'sandbox', paypal_subscription_id: subscriptionId, paid_at: time.toISOString() })
    if (tx.status === 'REFUNDED') {
      refunds.push({ refundId: `refund:${tx.id}`, captureId: tx.id, amountCents: cents, currency: 'EUR', status: 'COMPLETED', paypalEnv: 'sandbox', subscriptionId })
      records.push({ provider_id: `refund:${tx.id}`, capture_id: tx.id, kind: 'refund', status: 'COMPLETED', amount_cents: cents, currency: 'EUR', paypal_env: 'sandbox', paypal_subscription_id: subscriptionId, paid_at: time.toISOString() })
    }
  }
  const summary = summarizeConferenceFiveLedger({ captures, refunds, paypalEnv: 'sandbox' })
  // Refunds must also suspend provisional meeting benefits after ledger refresh.
  return { captures, refunds, records, summary }
}

async function paypalToken() {
  const id = String(process.env.PAYPAL_CLIENT_ID || '').trim()
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  if (!id || !secret) throw new Error('sandbox_credentials_missing')
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) throw new Error('sandbox_auth_failed')
  return d.access_token
}
async function paypal(access, method, path, body = undefined, idempotencyKey = null) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`sandbox_provider_${r.status}`)
  return data
}

async function userFromRequest(req, db) {
  const token = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const { data, error } = await db.auth.getUser(token)
  return error ? null : data?.user || null
}
async function isPlatformOwner(db, userId) {
  const { data, error } = await db.from('booking_practitioners')
    .select('id').eq('owner_id', userId)
    .in('slug', PLATFORM_ADMIN_PRACTITIONER_SLUGS).limit(1)
  return !error && !!data?.length
}
async function forUser(db, userId) {
  const { data, error } = await db.from('conference_five_contracts')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('contract_lookup_failed')
  return data
}
async function log(db, contractId, eventName) {
  const { error } = await db.from('conference_five_audit').insert({ contract_id: contractId, event_name: eventName, details: {} })
  if (error) throw new Error('audit_failed')
}
async function ensurePlan(contract, db, access) {
  if (contract.paypal_plan_id) return contract.paypal_plan_id
  const prod = await paypal(access, 'POST', '/v1/catalogs/products', {
    name: 'MediumIA — conférence 5X TEST',
    description: 'Essai technique uniquement',
    type: 'SERVICE', category: 'EDUCATIONAL_AND_TEXTBOOKS',
  }, requestId('product', contract.id))
  if (!/^PROD-/.test(prod.id || '')) throw new Error('sandbox_product_invalid')
  const plan = await paypal(access, 'POST', '/v1/billing/plans', fivePlanBody(prod.id), requestId('plan', contract.id))
  if (!/^P-/.test(plan.id || '')) throw new Error('sandbox_plan_invalid')
  const { error } = await db.from('conference_five_contracts').update({
    paypal_plan_id: plan.id, updated_at: new Date().toISOString(),
  }).eq('id', contract.id).eq('status', 'creating')
  if (error) throw new Error('plan_save_failed')
  return plan.id
}

async function reconcile(db, contract, access) {
  if (!contract.paypal_subscription_id || !contract.paypal_plan_id) throw new Error('subscription_not_started')
  const subId = contract.paypal_subscription_id
  const detail = await paypal(access, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(subId)}`)
  if (detail.id !== subId || detail.plan_id !== contract.paypal_plan_id || detail.custom_id !== contract.id) {
    throw new Error('subscription_identity_mismatch')
  }
  if (!['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED'].includes(detail.status)) {
    throw new Error('subscription_status_unknown')
  }
  const end = new Date()
  const start = new Date(new Date(contract.created_at).getTime() - 86400000)
  // PayPal transactions are authoritative. Do not rely on webhook payloads.
  const route = `/v1/billing/subscriptions/${encodeURIComponent(subId)}/transactions?start_time=${encodeURIComponent(start.toISOString())}&end_time=${encodeURIComponent(end.toISOString())}`
  const provider = await paypal(access, 'GET', route)
  const { records, summary, captures, refunds } = fiveVerifiedTransactions(provider.transactions || [], subId)
  if (summary.anomalies.length) throw new Error('payment_anomalies')
  if (records.length) {
    const { error } = await db.from('conference_five_transactions').upsert(records.map(r => ({ ...r, contract_id: contract.id, verified_at: new Date().toISOString() })), { onConflict: 'provider_id' })
    if (error) throw new Error('transactions_store_failed')
  }
  let status = 'approval_pending'
  if (detail.status === 'ACTIVE') status = summary.fullyPaid ? 'completed' : 'active'
  if (detail.status === 'CANCELLED') status = 'cancelled'
  if (detail.status === 'SUSPENDED') status = 'suspended'
  if (detail.status === 'EXPIRED') status = summary.fullyPaid ? 'completed' : 'review_required'
  if (refunds.length) status = 'review_required'
  const firstPaidAt = captures.length
    ? [...(provider.transactions || [])].filter(t => ['COMPLETED','REFUNDED'].includes(t.status)).map(t => t.time).sort()[0]
    : null
  const { error } = await db.from('conference_five_contracts').update({
    status, first_paid_at: firstPaidAt || null, provider_last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', contract.id).eq('paypal_subscription_id', subId)
  if (error) throw new Error('contract_update_failed')
  return {
    status, paypalStatus: detail.status,
    paidInstalments: summary.paidInstalments,
    netCents: summary.netCents,
    remainingCents: summary.remainingCents,
    fullyPaid: summary.fullyPaid,
    // No booking authorization here: PR #169 must recheck due dates and ledger live.
    informationalDueDates: firstPaidAt ? conferenceFiveDueDates(firstPaidAt) : [],
    // IMPORTANT: The accurate due schedule still needs to come from the
    // provider-approved billing terms before integration with PR #169.
  }
}

export async function handleConferenceFiveSandbox(req, res, actionOverride = null) {
  res.setHeader('Cache-Control', 'no-store')
  // The whole handler is invisible outside the isolated, explicitly enabled TEST project.
  if (!fiveSandboxEnabled()) return res.status(404).json({ error: 'not_found' })
  if (!isSupabaseConfigured()) return res.status(503).json({ error: 'not_configured' })
  const action = String(actionOverride || req.query?.action || '')
  if (!ACTIONS.has(action)) return res.status(404).json({ error: 'unknown_action' })
  if (req.method !== (['invite','subscribe','sync'].includes(action) ? 'POST' : 'GET')) return res.status(405).json({ error: 'method_not_allowed' })
  const db = getSupabaseAdmin()
  const user = await userFromRequest(req, db)
  if (!user) return res.status(401).json({ error: 'auth_required' })
  try {
    if (action === 'invite') {
      if (!(await isPlatformOwner(db, user.id))) return res.status(403).json({ error: 'forbidden' })
      const registrationId = String(req.body?.registrationId || '')
      if (!/^[0-9a-f-]{36}$/i.test(registrationId) || req.body?.approveMeetings !== true) return res.status(400).json({ error: 'invalid_invitation' })
      const { data: reg, error: regError } = await db.from('conference_registrations')
        .select('id,event_id,status,email_normalized,conference_events!inner(slug)').eq('id', registrationId).maybeSingle()
      if (regError || !reg || reg.status !== 'attended' || reg.conference_events?.slug !== 'premiere-conference-mediumia') return res.status(409).json({ error: 'participant_not_eligible' })
      const { data: existingId, error: userError } = await db.rpc('mediumia_find_user_id_by_email', { p_email: reg.email_normalized })
      if (userError || !existingId) return res.status(409).json({ error: 'student_account_required' })
      const { data: created, error } = await db.from('conference_five_contracts').insert({
        registration_id: reg.id, user_id: existingId, approved_by: user.id,
        offer_code: CONFERENCE_FIVE_PLAN.code, meetings_approved: true,
      }).select('id').single()
      if (error) return res.status(409).json({ error: 'invitation_conflict' })
      await log(db, created.id, 'individual_invitation_approved')
      return res.status(201).json({ ok: true, contractId: created.id })
    }
    const contract = await forUser(db, user.id)
    if (!contract || contract.paypal_env !== 'sandbox' || contract.offer_code !== CONFERENCE_FIVE_PLAN.code) {
      return res.status(404).json({ error: 'no_individual_offer' })
    }
    if (action === 'offer') return res.status(200).json({
      totalCents: 49900, instalments: 5, instalmentCents: 9980, currency: 'EUR',
      status: contract.status, meetingsApproved: contract.meetings_approved,
      sandbox: true, termsVersion: TERMS,
    })
    if (action === 'status') return res.status(200).json({
      status: contract.status, createdAt: contract.created_at,
      paypalSubscriptionPresent: !!contract.paypal_subscription_id,
      lastCheckedAt: contract.provider_last_checked_at,
      sandbox: true,
    })
    if (action === 'subscribe') {
      if (req.body?.consent !== true) return res.status(400).json({ error: 'consent_required' })
      if (contract.status !== 'invited' || contract.paypal_subscription_id) return res.status(409).json({ error: 'subscription_already_started' })
      // Missing/invalid Sandbox credentials must not consume a one-time invite.
      const access = await paypalToken()
      const { data: claimed, error: lockError } = await db.from('conference_five_contracts')
        .update({ status: 'creating', terms_version: TERMS, terms_accepted_at: new Date().toISOString() })
        .eq('id', contract.id).eq('status', 'invited').is('paypal_subscription_id', null).select('id').maybeSingle()
      if (lockError || !claimed) return res.status(409).json({ error: 'subscription_race' })
      // A post-PayPal failure leaves 'creating' for owner reconciliation:
      // never automatically start a second potentially billable subscription.
      const planId = await ensurePlan({ ...contract, status: 'creating' }, db, access)
      const sub = await paypal(access, 'POST', '/v1/billing/subscriptions', {
        plan_id: planId,
        custom_id: contract.id,
        application_context: {
          brand_name: 'MediumIA TEST',
          locale: 'fr-FR',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'SUBSCRIBE_NOW',
          return_url: 'https://mediumia-pr156-seguins-projects-a1d4673f.vercel.app/formation/conference-5x-test',
          cancel_url: 'https://mediumia-pr156-seguins-projects-a1d4673f.vercel.app/formation/conference-5x-test',
        },
      }, requestId('subscription', contract.id))
      if (!/^I-/.test(sub.id || '')) throw new Error('sandbox_subscription_invalid')
      const { error: saveError } = await db.from('conference_five_contracts').update({
        status: 'approval_pending', paypal_plan_id: planId,
        paypal_subscription_id: sub.id, updated_at: new Date().toISOString(),
      }).eq('id', contract.id).eq('status', 'creating')
      if (saveError) throw new Error('subscription_save_failed')
      await log(db, contract.id, 'sandbox_subscription_created')
      const approveUrl = sub.links?.find(x => x.rel === 'approve' && /^https:\/\/www\.sandbox\.paypal\.com\//.test(x.href))?.href
      return res.status(201).json({ id: sub.id, approveUrl: approveUrl || null, sandbox: true })
    }
    if (action === 'sync') {
      if (!contract.paypal_subscription_id) return res.status(409).json({ error: 'subscription_not_started' })
      const result = await reconcile(db, contract, await paypalToken())
      await log(db, contract.id, 'sandbox_subscription_reconciled')
      return res.status(200).json(result)
    }
    return res.status(404).json({ error: 'not_found' })
  } catch (error) {
    console.error('[conference-five-sandbox]', String(error?.message || 'internal').slice(0,90))
    return res.status(502).json({ error: 'sandbox_operation_failed' })
  }
}

export const __conferenceFiveSandboxTest = { fivePlanBody, fiveVerifiedTransactions, fiveSandboxEnabled }
