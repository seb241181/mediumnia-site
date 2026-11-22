// Owner dashboard display only: final decisions are folded into history.
// An unknown or partially refunded state remains actionable/visible, to avoid
// hiding money that still requires a decision or reconciliation.
const FINAL_SETTLEMENT_STATES = new Set(['refunded', 'transferred', 'retained'])

export function groupDepositSettlements(items = []) {
  const active = []
  const archived = []
  for (const item of items) {
    // Un règlement intégral remboursé partiellement suivant la nouvelle règle
    // (ex. 80 € réglés, 60 € remboursés, 20 € d'arrhes conservés) est traité.
    const settledByNewPolicy = item.settlement_status === 'partially_refunded'
      && item.new_terms === true
      && item.policy_guidance?.code === 'late_arrhes_review'
      && item.policy_guidance.recommendedRefundCents > 0
      && Number(item.refunded_cents || 0) >= item.policy_guidance.recommendedRefundCents
    if (FINAL_SETTLEMENT_STATES.has(item.settlement_status) || settledByNewPolicy) archived.push(item)
    else active.push(item)
  }
  return { active, archived }
}
