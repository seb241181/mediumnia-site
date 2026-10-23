/**
 * Business-only contract for the proposed one-person Pass Conference 5x TEST.
 *
 * Not an active checkout. Never grant training rights from this module alone:
 * rights must be provisioned by the server after five unique, provider-verified
 * settled payments and after handling any refunds.
 */
export const CONFERENCE_FIVE_PLAN = Object.freeze({
  code: 'conference-pass-499-five-monthly',
  currency: 'EUR',
  totalCents: 49900,
  instalmentCents: 9980,
  instalments: 5,
})

/** Return five monthly due dates, starting at first charge date, anchoring on
 * the original calendar day and clamping at month end (UTC, no local DST shift).
 * Dates are informational until a provider-approved subscription exists.
 */
export function conferenceFiveDueDates(firstChargeAt) {
  const first = new Date(firstChargeAt)
  if (!Number.isFinite(first.getTime())) throw new TypeError('invalid_first_charge_date')
  const year = first.getUTCFullYear()
  const month = first.getUTCMonth()
  const day = first.getUTCDate()
  const hour = first.getUTCHours()
  const minute = first.getUTCMinutes()
  const second = first.getUTCSeconds()
  return Array.from({ length: CONFERENCE_FIVE_PLAN.instalments }, (_, i) => {
    const monthStart = new Date(Date.UTC(year, month + i, 1, hour, minute, second))
    const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate()
    monthStart.setUTCDate(Math.min(day, lastDay))
    return monthStart.toISOString()
  })
}

/**
 * Summarize a ledger of provider-verified captures/refunds only.
 * Must not be called on arbitrary client-submitted events.
 *
 * Captures: [{ captureId, status, amountCents, currency, paypalEnv }]
 * Refunds: [{ refundId, captureId, status, amountCents, currency, paypalEnv }]
 * Exactly five unique complete instalments with no remaining refund balance
 * are needed for fullyPaid. Replays and mismatched/partial captures never count.
 */
export function summarizeConferenceFiveLedger({ captures = [], refunds = [], paypalEnv = 'sandbox' } = {}) {
  if (!['sandbox', 'live'].includes(paypalEnv)) throw new TypeError('invalid_paypal_env')
  const plan = CONFERENCE_FIVE_PLAN
  const unique = new Map()
  const anomalies = []
  for (const capture of captures) {
    if (capture?.paypalEnv !== paypalEnv || capture?.status !== 'COMPLETED') continue
    if (typeof capture.captureId !== 'string' || !capture.captureId) {
      anomalies.push('missing_capture_id')
      continue
    }
    if (unique.has(capture.captureId)) continue // verified webhook replay
    if (capture.currency !== plan.currency || capture.amountCents !== plan.instalmentCents) {
      anomalies.push('unexpected_capture_amount')
      continue
    }
    unique.set(capture.captureId, { paidCents: plan.instalmentCents, refundedCents: 0 })
  }

  const seenRefunds = new Set()
  for (const refund of refunds) {
    if (refund?.paypalEnv !== paypalEnv || refund?.status !== 'COMPLETED') continue
    if (typeof refund.refundId !== 'string' || !refund.refundId) {
      anomalies.push('missing_refund_id')
      continue
    }
    if (seenRefunds.has(refund.refundId)) continue
    seenRefunds.add(refund.refundId)
    const capture = unique.get(refund.captureId)
    if (!capture || refund.currency !== plan.currency || !Number.isInteger(refund.amountCents) || refund.amountCents <= 0) {
      anomalies.push('invalid_refund')
      continue
    }
    capture.refundedCents += refund.amountCents
    if (capture.refundedCents > capture.paidCents) anomalies.push('refund_exceeds_capture')
  }

  const netCents = [...unique.values()].reduce((total, entry) => total + entry.paidCents - entry.refundedCents, 0)
  const paidInstalments = [...unique.values()].filter(entry => entry.refundedCents === 0).length
  if (unique.size > plan.instalments) anomalies.push('too_many_captures')
  return {
    netCents,
    paidInstalments,
    remainingCents: Math.max(0, plan.totalCents - netCents),
    fullyPaid: anomalies.length === 0 && unique.size === plan.instalments && paidInstalments === plan.instalments && netCents === plan.totalCents,
    anomalies,
  }
}


/**
 * Conference-only provisional access for an individually approved 5x Pass.
 *
 * IMPORTANT: call server-side with a verified, owner-approved contract and
 * provider-reconciled captures/refunds, never with a browser-supplied contract.
 * This function grants NO module access and does NOT grant a full entitlement.
 * At booking and again before sharing a private meeting link, recompute from
 * the current subscription and payment ledger. Past bookings must be reviewed
 * if a subsequent instalment fails or is refunded.
 *
 * The five dueDates must be persisted from the approved PayPal subscription,
 * not guessed from conferenceFiveDueDates().
 */
export function conferenceFiveMeetingEligibility({
  userId,
  contract,
  captures = [],
  refunds = [],
  dueDates = [],
  now = new Date(),
  paypalEnv = 'sandbox',
} = {}) {
  const deny = (reason) => ({ eligible: false, reason, scope: 'conference_meetings_only' })
  const nowDate = new Date(now)
  if (!Number.isFinite(nowDate.getTime())) return deny('invalid_current_time')
  if (!userId || !contract || contract.userId !== userId) return deny('not_individually_authorized')
  if (contract.offerCode !== CONFERENCE_FIVE_PLAN.code || contract.meetingsApproved !== true) return deny('not_individually_authorized')
  if (contract.paypalEnv !== paypalEnv || !['live', 'sandbox'].includes(paypalEnv)) return deny('payment_environment_mismatch')
  if (!['active', 'completed'].includes(contract.status)) return deny('contract_not_active')
  if (!Array.isArray(dueDates) || dueDates.length !== CONFERENCE_FIVE_PLAN.instalments) return deny('invalid_payment_schedule')
  const parsed = dueDates.map(d => new Date(d).getTime())
  if (parsed.some(time => !Number.isFinite(time)) || parsed.some((value, i) => i && value <= parsed[i - 1])) return deny('invalid_payment_schedule')

  const ledger = summarizeConferenceFiveLedger({ captures, refunds, paypalEnv })
  if (ledger.anomalies.length) return deny('payment_requires_review')
  if (ledger.paidInstalments < 1) return deny('first_payment_missing')
  const dueCount = parsed.filter(time => time <= nowDate.getTime()).length
  if (dueCount === 0) return deny('contract_not_started')
  // No grace by default: an instalment outstanding as of its scheduled due date
  // pauses new reservations and permission to attend until verified settlement.
  if (ledger.paidInstalments < dueCount) return deny('payment_overdue')
  // A partial refund still reduces the net and therefore suspends the benefit.
  if (ledger.netCents !== ledger.paidInstalments * CONFERENCE_FIVE_PLAN.instalmentCents) return deny('payment_refunded')
  if (ledger.fullyPaid) return { eligible: true, reason: null, scope: 'conference_meetings_only', fullyPaid: true }
  return { eligible: true, reason: null, scope: 'conference_meetings_only', fullyPaid: false }
}
