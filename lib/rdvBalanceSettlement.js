// Règlement du solde d'un rendez-vous : reprise, remplacement et encaissement.
//
// Trois règles, jamais contournées :
//   1. Une seule commande PayPal est rattachée à un rendez-vous, et le serveur
//      est le seul à pouvoir encaisser — uniquement la commande rattachée.
//      Une commande remplacée ne peut donc plus jamais être encaissée.
//   2. Une commande n'est remplacée qu'après lecture de son état réel chez
//      PayPal, et l'échange ancienne → nouvelle est atomique et journalisé.
//   3. Situation incertaine : aucun nouveau prélèvement, le rendez-vous est
//      protégé de l'annulation automatique et le propriétaire est alerté.
import {
  captureRdvBalancePayPalOrder,
  classifyRdvBalanceOrder,
  createRdvBalancePayPalOrder,
  inspectRdvBalancePayPalOrder,
  verifyRdvBalancePayPalPayment,
} from './rdvBalancePayPal.js'
import { sendOwnerBalanceAlert } from './rdvBalanceOwnerAlerts.js'

const PAYMENT_COLUMNS = 'id, booking_id, client_checkout_id, paypal_order_id, paypal_capture_id, paypal_env, amount_cents, currency, status, capture_claimed_at, last_error_code, updated_at'

// Au-delà, une commande non validée est remplacée plutôt que représentée au
// client : PayPal ne garantit pas la durée de validité d'une commande ouverte.
export const ORDER_REUSE_MAX_MS = 2 * 3_600_000
// Une commande introuvable chez PayPal alors qu'elle est récente trahit plutôt
// une configuration PayPal changée qu'une expiration.
export const NOT_FOUND_MIN_AGE_MS = 3 * 3_600_000
// Même délai que claim_rdv_balance_capture.
export const CAPTURE_CLAIM_MS = 10 * 60_000

// Derniers codes connus avec lesquels aucun encaissement n'a pu avoir lieu.
const NO_CAPTURE_CODES = new Set([null, undefined, '', 'paypal_order_replaced', 'paypal_order_not_approved', 'paypal_approval_expired', 'paypal_payment_declined', 'paypal_order_status_unavailable', 'stale_paypal_order_reissued'])
export const REFUSED_CODES = new Set(['paypal_approval_expired', 'paypal_payment_declined'])

export const defaultPayPal = {
  inspect: inspectRdvBalancePayPalOrder,
  create: createRdvBalancePayPalOrder,
  capture: captureRdvBalancePayPalOrder,
}

const problem = (error, http = 409) => ({ ok: false, error, http })

export async function loadBalancePayment(supabase, column, value) {
  const { data, error } = await supabase
    .from('rdv_balance_payments')
    .select(PAYMENT_COLUMNS)
    .eq(column, value)
    .maybeSingle()
  if (error) throw new Error('balance_lookup_failed')
  return data || null
}

async function logEvent(supabase, bookingId, event, detail) {
  const { error } = await supabase.from('rdv_balance_review_events').insert({ booking_id: bookingId, event, detail })
  return !error
}

// Vérification humaine demandée : journal + une seule alerte interne par
// rendez-vous (jamais d'e-mail au client). Ne fait jamais échouer l'appelant.
export async function flagUncertainPayment(supabase, payment, code, { sendAlert = sendOwnerBalanceAlert, now = new Date() } = {}) {
  console.error(`[rdv-balance] review required: ${code} payment=${String(payment.id).slice(0, 8)}`)
  try {
    await logEvent(supabase, payment.booking_id, 'payment_review_required', { code, status: payment.status, paypal_order_id: payment.paypal_order_id })
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, service_id, customer_first_name, customer_last_name, starts_at, timezone, balance_reminder_sent_at')
      .eq('id', payment.booking_id)
      .maybeSingle()
    if (!booking) return { status: 'booking_not_found' }
    const { data: service } = await supabase.from('booking_services').select('title').eq('id', booking.service_id).maybeSingle()
    return await sendAlert({
      supabase,
      item: { booking, service, dueCents: Number(payment.amount_cents) },
      kind: 'review',
      reason: 'payment_uncertain',
      now,
    })
  } catch {
    return { status: 'error' }
  }
}

// Encaissement constaté chez PayPal : on l'enregistre (aucun prélèvement).
async function recordCapture(supabase, payment, order, { onPaid, options }) {
  const amountCents = Number(payment.amount_cents)
  let verified
  try {
    verified = verifyRdvBalancePayPalPayment({ cfg: order.cfg, data: order.data, bookingId: payment.booking_id, amountCents, currency: payment.currency })
  } catch (error) {
    await flagUncertainPayment(supabase, payment, error.message, options)
    return problem('balance_payment_review_required')
  }

  // Payé mais jamais enregistré (coupure) : la ligne doit être revendiquée pour
  // être finalisée, et reste protégée de l'annulation si la finalisation échoue.
  if (payment.status === 'order_pending') {
    const { data: claimed, error } = await supabase
      .from('rdv_balance_payments')
      .update({ status: 'capture_in_progress', capture_claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', payment.id)
      .eq('status', 'order_pending')
      .eq('paypal_order_id', payment.paypal_order_id)
      .select('id')
      .maybeSingle()
    if (error || !claimed) return problem('balance_capture_in_progress')
  }

  const { data: finalized, error: finalError } = await supabase.rpc('finalize_rdv_balance_capture', {
    p_paypal_order_id: verified.orderId,
    p_paypal_capture_id: verified.captureId,
    p_captured_at: verified.capturedAt,
    p_paypal_env: order.cfg.env,
    p_amount_cents: amountCents,
    p_currency: payment.currency,
  })
  if (finalError || !finalized?.ok) {
    await flagUncertainPayment(supabase, payment, finalized?.error || 'balance_finalize_failed', options)
    return problem('balance_payment_review_required')
  }

  // L'argent est enregistré : un e-mail en panne ne doit plus rien annuler.
  let emailStatus = 'not_sent'
  if (!finalized.already_captured && onPaid) {
    try { emailStatus = await onPaid(payment.booking_id, amountCents) } catch { emailStatus = 'error' }
  }
  return { ok: true, status: 'COMPLETED', bookingId: payment.booking_id, amountCents, emailStatus, alreadyCaptured: !!finalized.already_captured }
}

async function releaseCapture(supabase, orderId, code) {
  try {
    await supabase.rpc('release_rdv_balance_capture', { p_paypal_order_id: orderId, p_error_code: code })
  } catch {
    // La ligne reste « capture_in_progress » : état le plus protecteur.
  }
}

const expectedOf = payment => ({ bookingId: payment.booking_id, amountCents: Number(payment.amount_cents), currency: payment.currency })

// Retour de PayPal (ou confirmation d'une commande déjà approuvée).
export async function settleBalanceOrder(supabase, orderId, { paypal = defaultPayPal, onPaid, ...options } = {}) {
  // Avant la revendication (qui efface ces traces) : un encaissement a-t-il pu
  // être envoyé lors d'un passage précédent, resté sans réponse ?
  const previous = await loadBalancePayment(supabase, 'paypal_order_id', orderId)
  const maybeCaptured = !!previous && (previous.status === 'capture_in_progress' || !NO_CAPTURE_CODES.has(previous.last_error_code))

  const { data: claim, error: claimError } = await supabase.rpc('claim_rdv_balance_capture', { p_paypal_order_id: orderId })
  if (claimError) return problem('balance_capture_failed', 500)
  if (claim?.already_captured) {
    return { ok: true, status: 'COMPLETED', bookingId: claim.booking_id, amountCents: Number(claim.amount_cents), alreadyCaptured: true }
  }

  if (!claim?.ok) {
    const refusal = claim?.error || 'balance_capture_failed'
    if (!['balance_payment_expired', 'balance_capture_in_progress'].includes(refusal)) return problem(refusal)
    // Refus de la base : rien ne sera encaissé. Mais un encaissement antérieur
    // interrompu a pu réussir ; on le constate plutôt que de répondre « expiré ».
    const payment = await loadBalancePayment(supabase, 'paypal_order_id', orderId)
    if (!payment) return problem(refusal)
    return recoverBalancePayment(supabase, payment, { paypal, onPaid, fallback: refusal, ...options })
  }

  const payment = await loadBalancePayment(supabase, 'paypal_order_id', orderId)
  if (!payment || payment.status !== 'capture_in_progress') return problem('balance_capture_in_progress')

  // Contrôle AVANT encaissement : bon rendez-vous, bon montant, vraiment approuvée.
  let order
  try {
    order = await paypal.inspect(orderId)
  } catch {
    if (maybeCaptured) return problem('paypal_capture_uncertain')
    await releaseCapture(supabase, orderId, 'paypal_order_status_unavailable')
    return problem('paypal_order_status_unavailable', 503)
  }
  const before = classifyRdvBalanceOrder(order, expectedOf(payment))
  if (before === 'captured') return recordCapture(supabase, payment, order, { onPaid, options })
  // Commande disparue après un encaissement resté sans réponse : on ne conclut pas.
  if (before === 'gone' && maybeCaptured) {
    await flagUncertainPayment(supabase, payment, 'order_not_found_after_capture_attempt', options)
    return problem('balance_payment_review_required')
  }
  // Ancien onglet de retour rouvert, commande expirée ou jamais validée : rien
  // n'a pu être encaissé, le lien du client reste utilisable.
  if (before === 'payable' || before === 'gone') {
    await releaseCapture(supabase, orderId, 'paypal_order_not_approved')
    return problem('paypal_order_not_approved')
  }
  if (before === 'declined') {
    await releaseCapture(supabase, orderId, 'paypal_payment_declined')
    return problem('paypal_payment_declined')
  }
  if (before === 'pending') {
    await flagUncertainPayment(supabase, payment, 'paypal_capture_pending', options)
    return problem('paypal_capture_pending')
  }
  if (before === 'wrong_amount') {
    // Rien d'encaissé : le client reprend avec une commande au montant exact.
    await releaseCapture(supabase, orderId, 'paypal_order_not_approved')
    return problem('paypal_order_amount_changed')
  }
  if (before !== 'approved') {
    await flagUncertainPayment(supabase, payment, 'paypal_order_uncertain', options)
    return problem('balance_payment_review_required')
  }

  let attempt
  try {
    attempt = await paypal.capture(orderId, { approvedAt: order.data?.update_time || '' })
  } catch {
    // Jeton PayPal refusé : la demande d'encaissement n'est pas partie.
    await releaseCapture(supabase, orderId, 'paypal_order_status_unavailable')
    return problem('paypal_order_status_unavailable', 503)
  }

  let after
  try {
    order = await paypal.inspect(orderId)
    after = classifyRdvBalanceOrder(order, expectedOf(payment))
  } catch {
    after = 'unreachable'
  }
  if (after === 'captured') return recordCapture(supabase, payment, order, { onPaid, options })
  if (after === 'declined' || (['approved', 'payable'].includes(after) && attempt.refusal)) {
    const code = after === 'declined' ? 'paypal_payment_declined' : attempt.refusal
    await releaseCapture(supabase, orderId, code)
    return problem(code)
  }
  // Pas de refus certain : encaissement peut-être en cours. La ligne reste
  // « capture_in_progress », ce qui interdit annulation et nouvelle commande.
  await flagUncertainPayment(supabase, payment, after === 'pending' ? 'paypal_capture_pending' : 'paypal_capture_uncertain', options)
  return problem(after === 'pending' ? 'paypal_capture_pending' : 'paypal_capture_uncertain')
}

// Constate un encaissement déjà fait, sans jamais en provoquer un.
export async function recoverBalancePayment(supabase, payment, { paypal = defaultPayPal, onPaid, fallback = 'balance_payment_review_required', ...options } = {}) {
  let order
  try {
    order = await paypal.inspect(payment.paypal_order_id)
  } catch {
    return problem('paypal_order_status_unavailable', 503)
  }
  const state = classifyRdvBalanceOrder(order, expectedOf(payment))
  if (state === 'captured') return recordCapture(supabase, payment, order, { onPaid, options })
  if (state === 'pending') return problem('paypal_capture_pending')
  if (state === 'uncertain') {
    await flagUncertainPayment(supabase, payment, 'paypal_order_uncertain', options)
    return problem('balance_payment_review_required')
  }
  return problem(fallback)
}

// Échange atomique ancienne → nouvelle commande. La ligne n'est jamais sans
// commande : une panne au milieu laisse l'ancienne en place.
async function replaceOrder(supabase, payment, { bookingId, amountCents, serviceTitle, reason, paypal }) {
  let created
  try {
    created = await paypal.create({
      bookingId,
      paymentId: payment.id,
      amountCents,
      currency: payment.currency,
      serviceTitle,
      replacesOrderId: payment.paypal_order_id,
    })
  } catch (error) {
    return problem(String(error?.message || '').startsWith('paypal_') ? error.message : 'paypal_create_order_failed', 502)
  }

  // Trace obligatoire de l'ancienne commande : sans elle, pas de remplacement.
  const logged = await logEvent(supabase, bookingId, 'paypal_order_replaced', {
    old_order_id: payment.paypal_order_id, new_order_id: created.orderId, paypal_state: reason,
    old_amount_cents: Number(payment.amount_cents), new_amount_cents: amountCents,
  })
  if (!logged) return problem('balance_payment_unavailable', 500)

  let update = supabase
    .from('rdv_balance_payments')
    .update({
      paypal_order_id: created.orderId,
      amount_cents: amountCents,
      status: 'order_pending',
      capture_claimed_at: null,
      last_error_code: 'paypal_order_replaced',
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)
    .eq('status', payment.status)
    .eq('paypal_order_id', payment.paypal_order_id)
    .eq('amount_cents', payment.amount_cents)
  // Encaissement interrompu : seulement si personne ne l'a repris entre-temps.
  if (payment.status === 'capture_in_progress') {
    update = payment.capture_claimed_at ? update.eq('capture_claimed_at', payment.capture_claimed_at) : update.is('capture_claimed_at', null)
  }
  const { data: swapped, error } = await update.select('id').maybeSingle()
  if (!error && swapped) return { ok: true, id: created.orderId, approveUrl: created.approveUrl, amountCents, replaced: true }

  // Deux clics simultanés : l'autre a déjà rattaché la même commande.
  const latest = await loadBalancePayment(supabase, 'id', payment.id)
  if (latest?.status === 'order_pending' && latest.paypal_order_id === created.orderId && Number(latest.amount_cents) === amountCents) {
    return { ok: true, id: created.orderId, approveUrl: created.approveUrl, amountCents, reused: true }
  }
  return problem('balance_payment_retry_required')
}

// Prépare LA commande à présenter au client pour ce rendez-vous.
//   expectedCents : solde exact dû maintenant (contrôlé en base).
export async function prepareBalanceOrder(supabase, payment, { expectedCents, serviceTitle, paypal = defaultPayPal, onPaid, now = Date.now(), ...options }) {
  const bookingId = payment.booking_id
  if (!['order_pending', 'capture_in_progress'].includes(payment.status)) {
    await flagUncertainPayment(supabase, payment, `unexpected_status_${payment.status}`, options)
    return problem('balance_payment_review_required')
  }

  if (!payment.paypal_order_id) {
    if (payment.status !== 'order_pending') return problem('balance_payment_review_required')
    let amountCents = Number(payment.amount_cents)
    if (amountCents !== expectedCents) {
      const { data: repriced, error } = await supabase
        .from('rdv_balance_payments')
        .update({ amount_cents: expectedCents, updated_at: new Date(now).toISOString() })
        .eq('id', payment.id).eq('status', 'order_pending').is('paypal_order_id', null).eq('amount_cents', payment.amount_cents)
        .select('id').maybeSingle()
      if (error || !repriced) return problem('balance_payment_retry_required')
      amountCents = expectedCents
    }
    let created
    try {
      created = await paypal.create({ bookingId, paymentId: payment.id, amountCents, currency: payment.currency, serviceTitle })
    } catch (error) {
      return problem(String(error?.message || '').startsWith('paypal_') ? error.message : 'paypal_create_order_failed', 502)
    }
    // Rattachement sous verrou (#147) : refusé si une annulation pour solde a
    // été revendiquée entre-temps ou si l'échéance est passée. La commande
    // PayPal alors orpheline n'est jamais montrée au client et expire seule.
    const { data: attached, error: attachError } = await supabase.rpc('attach_rdv_balance_paypal_order', {
      p_payment_id: payment.id,
      p_paypal_order_id: created.orderId,
    })
    if (attachError) return problem('balance_payment_unavailable', 500)
    if (!attached?.ok) return problem(attached?.error || 'balance_payment_unavailable')
    // Un autre onglet a rattaché une autre commande : on ne montre que celle-là.
    if (attached.paypal_order_id !== created.orderId) return problem('balance_payment_retry_required')
    return { ok: true, id: created.orderId, approveUrl: created.approveUrl, amountCents, reused: !!attached.reused }
  }

  const claimAge = now - new Date(payment.capture_claimed_at || 0).getTime()
  const claimedNow = payment.status === 'capture_in_progress' && claimAge < CAPTURE_CLAIM_MS

  let order
  try {
    order = await paypal.inspect(payment.paypal_order_id)
  } catch {
    return problem('paypal_order_status_unavailable', 503)
  }
  const state = classifyRdvBalanceOrder(order, expectedOf(payment))
  const amountChanged = Number(payment.amount_cents) !== expectedCents
  const replace = reason => replaceOrder(supabase, payment, { bookingId, amountCents: expectedCents, serviceTitle, reason, paypal })
  const review = async code => {
    await flagUncertainPayment(supabase, payment, code, options)
    return problem('balance_payment_review_required')
  }

  if (state === 'captured') {
    // Payé à l'ancien montant alors que le solde a changé : décision humaine.
    if (amountChanged) return review('captured_amount_changed')
    const recorded = await recordCapture(supabase, payment, order, { onPaid, options })
    return recorded.ok ? { ...recorded, paid: true } : recorded
  }
  if (state === 'pending') {
    await flagUncertainPayment(supabase, payment, 'paypal_capture_pending', options)
    return problem('paypal_capture_pending')
  }
  if (state === 'uncertain') return review('paypal_order_uncertain')
  // Un encaissement est peut-être en cours d'envoi à cet instant.
  if (claimedNow) return problem('balance_capture_in_progress')

  if (state === 'gone') {
    const attempted = payment.status === 'capture_in_progress' || !NO_CAPTURE_CODES.has(payment.last_error_code)
    if (attempted) return review('order_not_found_after_capture_attempt')
    const ageMs = now - new Date(payment.updated_at).getTime()
    if (order.status === 'NOT_FOUND' && !(ageMs >= NOT_FOUND_MIN_AGE_MS)) return review('recent_order_not_found')
    return replace(order.status)
  }
  if (state === 'declined') return replace('DECLINED')
  if (state === 'wrong_amount') return order.status === 'APPROVED' ? review('approved_wrong_amount') : replace('AMOUNT_CHANGED')

  if (state === 'approved') {
    if (amountChanged) return review('approved_amount_changed')
    // PayPal a refusé d'encaisser cette approbation (refus certain) : rien n'a
    // été pris, il faut une nouvelle commande pour choisir un autre moyen.
    if (payment.status === 'order_pending' && REFUSED_CODES.has(payment.last_error_code)) return replace('APPROVED_REFUSED')
    // Déjà validée chez PayPal : on confirme CETTE commande, jamais une autre.
    return { ok: true, id: payment.paypal_order_id, approved: true, amountCents: expectedCents }
  }

  // payable : rien d'encaissé.
  const createdAt = new Date(order.data?.create_time || 0).getTime()
  const fresh = Number.isFinite(createdAt) && now - createdAt < ORDER_REUSE_MAX_MS
  if (!amountChanged && fresh && payment.status === 'order_pending') {
    return { ok: true, id: payment.paypal_order_id, approveUrl: order.approveUrl, amountCents: expectedCents, reused: true }
  }
  return replace(amountChanged ? 'AMOUNT_CHANGED' : order.status)
}

// Passage quotidien, LECTURE SEULE : aucun encaissement, aucune écriture
// comptable. Signale au propriétaire les paiements engagés non enregistrés.
export async function reportUncertainBalancePayments(supabase, { paypal = defaultPayPal, now = new Date(), limit = 10, budgetMs = 15_000, clock = Date.now, ...options } = {}) {
  const startedAt = clock()
  const { data: rows, error } = await supabase
    .from('rdv_balance_payments')
    .select(PAYMENT_COLUMNS)
    .in('status', ['order_pending', 'capture_in_progress'])
    .not('paypal_order_id', 'is', null)
    .lt('updated_at', new Date(now.getTime() - 15 * 60_000).toISOString())
    .gt('updated_at', new Date(now.getTime() - 15 * 86_400_000).toISOString())
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error('balance_report_lookup_failed')
  const report = []
  for (const payment of rows || []) {
    if (clock() - startedAt >= budgetMs) { report.push({ state: 'postponed' }); break }
    let state
    try {
      const order = await paypal.inspect(payment.paypal_order_id, { timeoutMs: 4_000 })
      state = classifyRdvBalanceOrder(order, expectedOf(payment))
    } catch {
      state = 'unreachable'
    }
    const suspicious = ['captured', 'pending', 'uncertain', 'approved'].includes(state) || payment.status === 'capture_in_progress'
    const alert = suspicious ? await flagUncertainPayment(supabase, payment, `daily_${state}`, { now, ...options }) : null
    report.push({ state, alert: alert?.status || null })
  }
  return report
}

// Dernier contrôle avant une annulation approuvée : un paiement encaissé ou
// illisible chez PayPal interdit l'annulation, même décidée par le propriétaire.
export async function balancePaymentForbidsCancel(supabase, bookingId, { paypal = defaultPayPal } = {}) {
  const payment = await loadBalancePayment(supabase, 'booking_id', bookingId)
  if (!payment?.paypal_order_id) return null
  if (payment.status === 'captured' || payment.status === 'capture_in_progress') return payment
  try {
    const order = await paypal.inspect(payment.paypal_order_id, { timeoutMs: 8_000 })
    const state = classifyRdvBalanceOrder(order, expectedOf(payment))
    if (['payable', 'approved', 'declined', 'wrong_amount'].includes(state)) return null
    if (state === 'gone' && NO_CAPTURE_CODES.has(payment.last_error_code)) return null
    return payment
  } catch {
    return payment
  }
}
