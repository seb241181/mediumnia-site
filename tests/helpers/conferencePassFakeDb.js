// Base simulée pour les tests du Pass conférence : mêmes requêtes que le code réel
// (conference_passes, conference_events, conference_pass_events, mediumia_paypal_purchases)
// et RPC de réservation / libération qui suivent les règles SQL des migrations.

export const OLD_CHECKOUT = '2026-11-01T12:20:06Z'

export function fakeConferenceDb({
  pass,
  event = { title: 'Conférence', pass_offer_amount_cents: 49900, pass_offer_currency: 'EUR', pass_offer_enabled: true, pass_normal_amount_cents: 59700 },
  validate = { ok: true, offerEnabled: true, offerAmountCents: 49900 },
  checkoutStartedAt = OLD_CHECKOUT,
  paymentRecordedFor = [],
  purchasesFor = [],
  failEvidence = false,
} = {}) {
  const calls = []
  const events = []
  const state = { pass: pass ? { ...pass } : null }

  function rows(table, filters) {
    if (table === 'conference_passes') return state.pass
    if (table === 'conference_events') return event
    if (table === 'mediumia_paypal_purchases') {
      if (failEvidence) return { error: true }
      return purchasesFor.includes(filters.paypal_order_id) ? { id: 'purchase' } : null
    }
    if (table === 'conference_pass_events') {
      if (filters.event_name === 'checkout_started') return checkoutStartedAt ? { created_at: checkoutStartedAt } : null
      if (filters.event_name === 'payment_completed') {
        if (failEvidence) return { error: true }
        const orderId = filters['metadata->>orderId']
        const logged = events.some((e) => e.event_name === 'payment_completed' && e.metadata?.orderId === orderId)
        return paymentRecordedFor.includes(orderId) || logged ? { id: 'event' } : null
      }
    }
    return null
  }

  const db = {
    calls,
    events,
    state,
    rpc(name, args) {
      calls.push({ rpc: name, args })
      if (name === 'validate_conference_pass') return Promise.resolve({ data: validate, error: null })
      if (name === 'release_conference_pass_checkout') {
        // Règle SQL : libération uniquement de la commande actuelle, jamais d'un Pass payé.
        if (!state.pass || state.pass.paypal_order_id !== args.p_paypal_order_id) return Promise.resolve({ data: { ok: false, reason: 'pass_not_found' }, error: null })
        if (state.pass.paypal_capture_id || state.pass.redeemed_at) return Promise.resolve({ data: { ok: false, reason: 'captured_payment_requires_reconciliation' }, error: null })
        state.pass = { ...state.pass, status: 'released' }
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      if (name === 'reserve_conference_pass_checkout') {
        const p = state.pass
        if (p.paypal_order_id === args.p_paypal_order_id && p.status === 'reserved') return Promise.resolve({ data: { ok: true, alreadyReserved: true, orderId: p.paypal_order_id }, error: null })
        if (p.paypal_order_id && p.paypal_order_id !== args.p_paypal_order_id && !['released', 'failed'].includes(p.status)) {
          return Promise.resolve({ data: { ok: false, reason: 'already_reserved', orderId: p.paypal_order_id }, error: null })
        }
        state.pass = { ...p, status: 'reserved', paypal_order_id: args.p_paypal_order_id, paypal_env: args.p_paypal_env, amount_cents: args.p_amount_cents, currency: args.p_currency, reference_id: args.p_reference_id }
        return Promise.resolve({ data: { ok: true, alreadyReserved: false, orderId: args.p_paypal_order_id }, error: null })
      }
      return Promise.resolve({ data: null, error: { message: `rpc ${name} non simulée` } })
    },
    from(table) {
      const filters = {}
      calls.push({ from: table, filters })
      const result = () => {
        const value = rows(table, filters)
        if (value && value.error) return { data: null, error: { message: 'lecture impossible' } }
        return { data: value ?? null, error: null }
      }
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder, is: () => builder, in: () => builder, update: () => builder,
        eq(column, value) { filters[column] = value; return builder },
        insert(row) { calls.push({ insert: table, row }); if (table === 'conference_pass_events') events.push(row); return Promise.resolve({ error: null }) },
        maybeSingle: () => Promise.resolve(result()),
        single: () => Promise.resolve(result()),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      }
      return builder
    },
  }
  return db
}
