/**
 * Parcours MediumIA au mois — règles métier (sans réseau ni base, testables).
 *
 *   29 € Découverte (module 1) → 34 € par échéance (2 modules) → échéance finale
 *   « Intégration » ajustée pour que le total encaissé fasse exactement 397 €
 *   (modules restants jusqu'au 25). « Tout débloquer » = 397 € − déjà encaissé.
 *
 * Tous les montants sont en centimes. `value_cents` est la valeur du paiement
 * pour le parcours : identique au montant encaissé en production ; en Sandbox,
 * la Découverte et l'ancien achat complet sont facturés 1,00 € mais valent leur
 * prix réel, pour que les tests du plafond aient du sens.
 */
export const CAP_CENTS = 39700
export const STEP_CENTS = 3400
export const DISCOVERY_CENTS = 2900
export const TOTAL_MODULES = 25
export const MODULES_PER_STEP = 2
export const COACH_MONTHS_AFTER_LAST_PAYMENT = 12
export const DISCOVERY_COACH_DAYS = 30
export const PAYMENT_KINDS = ['discovery', 'full', 'monthly', 'unlock', 'refund']

function addMonths(date, months) {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

// payments: [{ kind, value_cents, paid_at, refunded_kind? }]
export function summarize(payments = []) {
  let paidCents = 0
  let monthlyCount = 0
  let hasDiscovery = false
  let hasFull = false
  let lastPaidAt = null
  let discoveryPaidAt = null
  for (const p of payments) {
    const value = Number(p.value_cents) || 0
    if (p.kind === 'refund') {
      paidCents -= Math.abs(value)
      if (p.refunded_kind === 'monthly') monthlyCount = Math.max(0, monthlyCount - 1)
      continue
    }
    paidCents += value
    if (p.kind === 'monthly') monthlyCount += 1
    if (p.kind === 'discovery') { hasDiscovery = true; discoveryPaidAt = p.paid_at }
    if (p.kind === 'full') hasFull = true
    if (p.kind !== 'discovery' && (!lastPaidAt || new Date(p.paid_at) > new Date(lastPaidAt))) lastPaidAt = p.paid_at
  }
  paidCents = Math.max(0, paidCents)
  const complete = hasFull || paidCents >= CAP_CENTS
  // Each intermediate step opens 2 modules; the payment that brings the total
  // to 397 € opens every remaining module up to 25.
  const maxModule = complete
    ? TOTAL_MODULES
    : (hasDiscovery || monthlyCount > 0 ? Math.min(TOTAL_MODULES, 1 + MODULES_PER_STEP * monthlyCount) : 0)
  const remainingCents = complete ? 0 : CAP_CENTS - paidCents
  const coachUntil = lastPaidAt
    ? addMonths(lastPaidAt, COACH_MONTHS_AFTER_LAST_PAYMENT).toISOString()
    : (discoveryPaidAt ? new Date(new Date(discoveryPaidAt).getTime() + DISCOVERY_COACH_DAYS * 86_400_000).toISOString() : null)
  return { paidCents, monthlyCount, hasDiscovery, hasFull, complete, maxModule, remainingCents, lastPaidAt, coachUntil }
}

// Monthly schedule for what is left: 34 € while more than 34 € remains, then
// one final instalment equal to the rest. Never more than the remaining amount.
export function scheduleFor(remainingCents) {
  const remaining = Math.floor(Number(remainingCents) || 0)
  if (remaining <= 0) return null
  if (remaining <= STEP_CENTS) return { mode: 'single', regularCount: 0, finalCents: remaining, totalCents: remaining }
  const regularCount = Math.ceil(remaining / STEP_CENTS) - 1
  const finalCents = remaining - regularCount * STEP_CENTS
  return { mode: 'subscription', regularCount, finalCents, totalCents: remaining }
}

// Modules opened by the next payment, for the page ("modules 4 et 5").
export function nextStepModules(summary) {
  if (summary.complete) return []
  const from = summary.maxModule + 1
  const schedule = scheduleFor(summary.remainingCents)
  const last = schedule && schedule.regularCount === 0 ? TOTAL_MODULES : Math.min(TOTAL_MODULES, from + MODULES_PER_STEP - 1)
  const out = []
  for (let m = from; m <= last; m += 1) out.push(m)
  return out
}

// Server-side guard: a payment that would take the total above 397 € must not
// be accepted (the subscription is cancelled and the owner warned instead).
export function exceedsCap(summary, extraCents) {
  return summary.paidCents + Math.max(0, Number(extraCents) || 0) > CAP_CENTS
}

export const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',').replace(',00', '')} €`
