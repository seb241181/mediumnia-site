// Owner dashboard display only: final decisions are folded into history.
// An unknown or partially refunded state remains actionable/visible, to avoid
// hiding money that still requires a decision or reconciliation.
const FINAL_SETTLEMENT_STATES = new Set(['refunded', 'transferred', 'retained'])

export function groupDepositSettlements(items = []) {
  const active = []
  const archived = []
  for (const item of items) {
    if (FINAL_SETTLEMENT_STATES.has(item.settlement_status)) archived.push(item)
    else active.push(item)
  }
  return { active, archived }
}
