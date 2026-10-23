import { CONFERENCE_FIVE_PLAN, conferenceFiveDueDates } from './conferenceFiveInstallments.js'

/**
 * Extract only dates and cycle counts confirmed by PayPal Subscriptions.
 * Never infer billing dates from payment capture time or a user's browser.
 * Fail closed when the provider's billing schedule is absent or inconsistent.
 */
export function readFiveProviderSchedule(detail) {
  const bad = reason => ({ valid: false, reason })
  if (!detail || !['ACTIVE', 'EXPIRED'].includes(detail.status)) return bad('subscription_not_active')
  const starts = new Date(detail.start_time)
  if (!Number.isFinite(starts.getTime())) return bad('billing_anchor_missing')
  const regular = detail.billing_info?.cycle_executions?.filter(c => c?.tenure_type === 'REGULAR')
  if (!Array.isArray(regular) || regular.length !== 1) return bad('regular_cycle_missing')
  const cycle = regular[0]
  if (cycle.total_cycles !== CONFERENCE_FIVE_PLAN.instalments
    || !Number.isInteger(cycle.cycles_completed)
    || cycle.cycles_completed < 0
    || cycle.cycles_completed > CONFERENCE_FIVE_PLAN.instalments) return bad('regular_cycle_invalid')
  const due = conferenceFiveDueDates(starts)
  const nextRaw = detail.billing_info?.next_billing_time
  let next = null
  if (cycle.cycles_completed < CONFERENCE_FIVE_PLAN.instalments) {
    if (!nextRaw) return bad('next_billing_missing')
    const nextDate = new Date(nextRaw)
    if (!Number.isFinite(nextDate.getTime())) return bad('next_billing_invalid')
    next = nextDate.toISOString()
    // PayPal's schedule can drift slightly with month end / DST, but never
    // silently use a different monthly anchor. Flag it for manual review.
    const expectedIndex = cycle.cycles_completed
    const delta = Math.abs(nextDate.getTime() - new Date(due[expectedIndex]).getTime())
    if (delta > 3 * 86400000) return bad('unexpected_billing_calendar')
  } else if (detail.status !== 'EXPIRED' && detail.status !== 'ACTIVE') {
    return bad('final_cycle_status_invalid')
  }
  return {
    valid: true,
    anchor: starts.toISOString(),
    dueDates: due,
    nextBillingAt: next,
    cyclesCompleted: cycle.cycles_completed,
  }
}
