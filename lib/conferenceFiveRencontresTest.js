/**
 * TEST-only bridge from a verified conference 5× PayPal Sandbox ledger to the
 * rencontres booking permission. NO full training entitlement is created.
 * Never use this bridge in production: contractual/legal review is pending.
 */
import { CONFERENCE_FIVE_PLAN, conferenceFiveMeetingEligibility, conferenceFiveDueDates } from './conferenceFiveInstallments.js'
import { RENCONTRES_RIGHTS_MONTHS, RENCONTRES_CYCLE_1 } from './formationRencontres.js'

const TEST_SUPABASE_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
const MAX_RECONCILIATION_AGE_MS = 15 * 60 * 1000

export function fiveBridgeEnabled(env = process.env, paymentEnv = 'sandbox') {
  return paymentEnv === 'sandbox'
    && env.VERCEL_ENV !== 'production'
    && env.CONFERENCE_FIVE_SANDBOX_ENABLED === 'true'
    && String(env.SUPABASE_URL || '').replace(/\/$/, '') === TEST_SUPABASE_URL
}

function plusCalendarMonths(source, count) {
  const start = new Date(source)
  const target = new Date(start)
  const day = target.getUTCDate()
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + count)
  const endOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, endOfMonth))
  return target
}

export function evaluateFiveBridge({ userId, contract, transactions = [], now = new Date() }) {
  if (!contract?.first_paid_at || !contract?.provider_last_checked_at || !contract.paypal_subscription_id) return null
  if (!contract.paypal_billing_anchor_at
    || !Number.isInteger(contract.paypal_regular_cycles_completed)
    || contract.paypal_regular_cycles_completed < 1
    || contract.paypal_regular_cycles_completed > CONFERENCE_FIVE_PLAN.instalments) return null
  const time = new Date(now)
  const checked = new Date(contract.provider_last_checked_at)
  const started = new Date(contract.paypal_billing_anchor_at)
  const firstPayment = new Date(contract.first_paid_at)
  if (![time, checked, started, firstPayment].every(d => Number.isFinite(d.getTime()))) return null
  // PayPal's schedule takes precedence over capture-time estimates.
  const due = conferenceFiveDueDates(started)
  const completed = contract.paypal_regular_cycles_completed
  if (completed < CONFERENCE_FIVE_PLAN.instalments) {
    const next = new Date(contract.paypal_next_billing_at)
    if (!contract.paypal_next_billing_at || !Number.isFinite(next.getTime())) return null
    if (Math.abs(next.getTime() - new Date(due[completed]).getTime()) > 3 * 86400000) return null
  }
  const freshness = time.getTime() - checked.getTime()
  if (freshness < 0 || freshness > MAX_RECONCILIATION_AGE_MS) return null
  if (transactions.length > 30) return null

  const captures = []
  const refunds = []
  const seen = new Set()
  for (const tx of transactions) {
    if (!tx.provider_id || seen.has(tx.provider_id) || tx.paypal_subscription_id !== contract.paypal_subscription_id || tx.paypal_env !== 'sandbox' || tx.currency !== 'EUR') return null
    seen.add(tx.provider_id)
    const row = { subscriptionId: contract.paypal_subscription_id, captureId: tx.capture_id, amountCents: tx.amount_cents, currency: 'EUR', status: tx.status, paypalEnv: 'sandbox' }
    if (tx.kind === 'capture') captures.push(row)
    else if (tx.kind === 'refund') refunds.push({ ...row, refundId: tx.provider_id })
    else return null
  }

  const r = conferenceFiveMeetingEligibility({
    userId,
    contract: {
      userId: contract.user_id,
      offerCode: contract.offer_code,
      paypalEnv: contract.paypal_env,
      paypalSubscriptionId: contract.paypal_subscription_id,
      meetingsApproved: contract.meetings_approved,
      status: contract.status,
    },
    captures, refunds,
    dueDates: due,
    now: time,
    paypalEnv: 'sandbox',
  })
  if (!r.eligible || completed > captures.length) return null
  const from = started
  const until = new Date(Math.max(
    plusCalendarMonths(started, RENCONTRES_RIGHTS_MONTHS).getTime(),
    new Date(RENCONTRES_CYCLE_1.at(-1).endsAt).getTime(),
  ))
  return { eligible: true, reason: null, from: from.toISOString(), until: until.toISOString(), scope: 'conference_5x_test', fullTrainingAccess: false }
}

export async function loadFiveBridgeRights(supabase, userId, env, now = new Date()) {
  if (!fiveBridgeEnabled(process.env, env)) return null
  const { data: contract, error } = await supabase.from('conference_five_contracts')
    .select('id,user_id,offer_code,paypal_env,meetings_approved,status,paypal_subscription_id,first_paid_at,provider_last_checked_at,paypal_billing_anchor_at,paypal_next_billing_at,paypal_regular_cycles_completed')
    .eq('user_id', userId).in('status', ['active', 'completed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !contract || contract.offer_code !== CONFERENCE_FIVE_PLAN.code) return null
  const { data: tx, error: txErr } = await supabase.from('conference_five_transactions')
    .select('provider_id,paypal_subscription_id,paypal_env,currency,kind,capture_id,status,amount_cents')
    .eq('contract_id', contract.id)
  if (txErr || !tx) return null
  return evaluateFiveBridge({ userId, contract, transactions: tx, now })
}
