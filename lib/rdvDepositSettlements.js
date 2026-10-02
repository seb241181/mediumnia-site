/* global process */
/**
 * Arrhes des rendez-vous annulés : remboursement PayPal, transfert vers un
 * autre rendez-vous, conservation. Réservé à l'administration (propriétaire
 * du profil ET administrateur de la plateforme : l'argent est sur le compte
 * PayPal de MediumIA).
 *
 * Règles :
 * - l'annulation d'un rendez-vous ne déclenche jamais de remboursement ;
 * - le client (navigateur) n'envoie que des identifiants de rendez-vous : la
 *   capture PayPal, son environnement et le montant viennent de la base ;
 * - chaque demande est d'abord réservée en base (begin_rdv_payment_refund),
 *   avec une clé PayPal-Request-Id fixe : une reprise ne crée jamais un second
 *   remboursement ;
 * - avant tout envoi, l'ordre PayPal est relu (capture réelle, montant,
 *   remboursements déjà faits) ; après une réponse ambiguë, aucune reprise
 *   avant réconciliation, et jamais dans les 2 minutes qui suivent l'envoi ;
 * - aucune donnée personnelle ni secret dans les réponses d'erreur ou les logs.
 */
import { isPlatformAdmin } from './proWorkspace.js'
import {
  fetchRdvDepositOrder,
  fetchRdvRefund,
  formatRdvDepositAmount,
  rdvRefundCustomId,
  rdvRefundOutcome,
  refundRdvDepositCapture,
  runtimeRdvRefundPayPalConfig,
} from './rdvDepositPayPal.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const REFUND_RETRY_AFTER_MS = 2 * 60_000

export const defaultPayPal = {
  config: runtimeRdvRefundPayPalConfig,
  refund: refundRdvDepositCapture,
  getOrder: fetchRdvDepositOrder,
  getRefund: fetchRdvRefund,
}

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

function missingSchema(error) {
  return error && (error.code === '42703' || error.code === '42P01' || error.code === 'PGRST202'
    || /settlement_status|rdv_payment_refunds|begin_rdv_payment_refund/.test(error.message || ''))
}

export async function authorizeSettlement(supabase, userId, practitionerId) {
  if (!isUuid(practitionerId)) return { status: 400, body: { error: 'invalid_request' } }
  const { data: owned } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .maybeSingle()
  if (!owned) return { status: 403, body: { error: 'forbidden' } }
  const admin = await isPlatformAdmin(supabase, userId)
  if (admin.error) return { status: 500, body: { error: 'access_check_failed' } }
  if (!admin.allowed) return { status: 403, body: { error: 'forbidden' } }
  return null
}

function captureAndRefunds(order) {
  const units = order?.purchase_units || []
  return {
    captures: units.flatMap((u) => u?.payments?.captures || []),
    refunds: units.flatMap((u) => u?.payments?.refunds || []),
  }
}

/**
 * Lit l'ordre PayPal et dit ce qu'il faut faire pour ce remboursement :
 * - ours     : PayPal connaît déjà ce remboursement (custom_id ou id) ;
 * - adopt    : un remboursement inconnu de MediumIA, de même montant, existe
 *              déjà (fait dans PayPal, ou le nôtre sans custom_id visible) ;
 * - mismatch : état incohérent → aucune action automatique ;
 * - clear    : rien n'a été remboursé pour cette demande, l'envoi est sûr.
 */
export function analyzeOrderForRefund({ order, refund, paymentAmountCents, knownRefundIds = [] }) {
  const { captures, refunds } = captureAndRefunds(order)
  const capture = captures.find((c) => c?.id === refund.paypal_capture_id)
  if (!capture) return { kind: 'mismatch', errorCode: 'paypal_capture_not_found' }
  if (capture.amount?.currency_code !== 'EUR' || capture.amount?.value !== formatRdvDepositAmount(paymentAmountCents)) {
    return { kind: 'mismatch', errorCode: 'paypal_capture_amount_mismatch' }
  }
  const ours = refunds.find((r) => r?.custom_id === rdvRefundCustomId(refund.id)
    || (refund.paypal_refund_id && r?.id === refund.paypal_refund_id))
  if (ours) return { kind: 'ours', outcome: rdvRefundOutcome(ours.status), paypalRefundId: ours.id, paypalStatus: ours.status || null }

  const untracked = refunds.filter((r) => r?.id && !knownRefundIds.includes(r.id) && ['COMPLETED', 'PENDING'].includes(r.status))
  if (!untracked.length) {
    if (capture.status === 'REFUNDED') return { kind: 'mismatch', errorCode: 'paypal_capture_already_refunded' }
    return { kind: 'clear' }
  }
  const [only] = untracked
  if (untracked.length === 1 && only.status === 'COMPLETED'
    && only.amount?.currency_code === 'EUR' && only.amount?.value === formatRdvDepositAmount(refund.amount_cents)) {
    return { kind: 'adopt', paypalRefundId: only.id, paypalStatus: only.status }
  }
  return { kind: 'mismatch', errorCode: 'paypal_external_refund_mismatch' }
}

async function record(supabase, refund, outcome, { paypalRefundId = null, paypalStatus = null, errorCode = null, adopted = false } = {}) {
  const { data, error } = await supabase.rpc('record_rdv_payment_refund_result', {
    p_refund_id: refund.id,
    p_outcome: outcome,
    p_paypal_refund_id: paypalRefundId,
    p_paypal_status: paypalStatus,
    p_error_code: errorCode,
    p_adopted_external: adopted,
  })
  if (error || !data?.ok) return { recorded: false, error: data?.error || 'refund_record_failed' }
  return { recorded: true, status: data.status }
}

function reply(outcome, errorCode = null) {
  if (outcome === 'completed') return { status: 200, body: { status: 'completed' } }
  if (outcome === 'pending') return { status: 202, body: { status: 'pending' } }
  if (outcome === 'check_later') return { status: 202, body: { status: 'check_later' } }
  if (outcome === 'unknown') return { status: 202, body: { status: 'unknown', ...(errorCode ? { error: errorCode } : {}) } }
  if (outcome === 'manual_review') return { status: 409, body: { status: 'manual_review', error: errorCode } }
  return { status: 502, body: { status: 'failed', error: errorCode || 'paypal_refund_failed' } }
}

async function applyAnalysis(supabase, refund, analysis) {
  if (analysis.kind === 'ours') {
    await record(supabase, refund, analysis.outcome, { paypalRefundId: analysis.paypalRefundId, paypalStatus: analysis.paypalStatus })
    return reply(analysis.outcome)
  }
  if (analysis.kind === 'adopt') {
    // Jamais envoyé par MediumIA : remboursement fait directement dans PayPal.
    await record(supabase, refund, 'completed', { paypalRefundId: analysis.paypalRefundId, paypalStatus: analysis.paypalStatus, adopted: Number(refund.attempt_count || 0) === 0 })
    return reply('completed')
  }
  return null
}

async function processRefund({ supabase, paypal, cfg, refund, fresh, now }) {
  const startedAt = new Date(refund.last_attempt_at || refund.requested_at).getTime()
  const sentBefore = Number(refund.attempt_count || 0) > 0

  // Remboursement accepté par PayPal mais pas encore finalisé : on relit son état.
  if (refund.status === 'pending' && refund.paypal_refund_id) {
    let data
    try {
      data = await paypal.getRefund({ cfg, paypalRefundId: refund.paypal_refund_id })
    } catch {
      return reply('check_later')
    }
    const outcome = rdvRefundOutcome(data.status)
    if (outcome === 'unknown') return reply('pending')
    await record(supabase, refund, outcome, { paypalRefundId: data.id, paypalStatus: data.status })
    return reply(outcome)
  }

  // Une autre requête traite (ou vient de traiter) cette demande : on attend.
  if (!fresh && now() - startedAt < REFUND_RETRY_AFTER_MS) return reply('check_later')

  const [{ data: payment }, { data: siblings }] = await Promise.all([
    supabase.from('rdv_paypal_payments').select('amount_cents').eq('id', refund.payment_id).single(),
    supabase.from('rdv_payment_refunds').select('id, paypal_refund_id').eq('payment_id', refund.payment_id),
  ])
  const knownRefundIds = (siblings || []).filter((r) => r.id !== refund.id && r.paypal_refund_id).map((r) => r.paypal_refund_id)

  let order
  try {
    order = await paypal.getOrder({ cfg, orderId: refund.paypal_order_id })
  } catch {
    if (!sentBefore) {
      // Rien n'a été envoyé : échec certain, on peut redemander plus tard.
      await record(supabase, refund, 'failed', { errorCode: 'paypal_lookup_failed' })
      return reply('failed', 'paypal_lookup_failed')
    }
    return reply('check_later')
  }

  const analysis = analyzeOrderForRefund({ order, refund, paymentAmountCents: payment?.amount_cents, knownRefundIds })
  const applied = await applyAnalysis(supabase, refund, analysis)
  if (applied) return applied
  if (analysis.kind === 'mismatch') {
    if (!sentBefore) {
      await record(supabase, refund, 'failed', { errorCode: analysis.errorCode })
      return reply('failed', analysis.errorCode)
    }
    await record(supabase, refund, 'unknown', { errorCode: analysis.errorCode })
    return reply('manual_review', analysis.errorCode)
  }

  // clear : aucune trace de ce remboursement chez PayPal → envoi (ou reprise
  // avec la MÊME clé PayPal-Request-Id : PayPal renverrait l'original).
  const { data: marked } = await supabase.rpc('mark_rdv_payment_refund_attempt', { p_refund_id: refund.id })
  if (!marked?.ok) return reply('check_later')
  const result = await paypal.refund({
    cfg,
    captureId: refund.paypal_capture_id,
    amountCents: refund.amount_cents,
    requestId: refund.paypal_request_id,
    refundId: refund.id,
  })

  if (result.outcome === 'already_refunded') {
    let again
    try {
      again = analyzeOrderForRefund({ order: await paypal.getOrder({ cfg, orderId: refund.paypal_order_id }), refund, paymentAmountCents: payment?.amount_cents, knownRefundIds })
    } catch {
      again = { kind: 'mismatch', errorCode: 'paypal_lookup_failed' }
    }
    const adopted = await applyAnalysis(supabase, { ...refund, attempt_count: 0 }, again)
    if (adopted) return adopted
    // PayPal a refusé cette demande (rien n'a été remboursé par elle), mais son
    // état ne correspond pas à MediumIA : vérification manuelle dans PayPal.
    await record(supabase, refund, 'failed', { errorCode: again.errorCode || result.errorCode })
    return reply('manual_review', again.errorCode || result.errorCode)
  }
  if (result.outcome === 'failed' && result.sent === false && sentBefore) {
    // Rien n'est parti cette fois-ci, mais un envoi précédent reste ambigu.
    await record(supabase, refund, 'unknown', { errorCode: result.errorCode })
    return reply('unknown', result.errorCode)
  }
  await record(supabase, refund, result.outcome, { paypalRefundId: result.paypalRefundId, paypalStatus: result.paypalStatus, errorCode: result.errorCode })
  return reply(result.outcome, result.errorCode)
}

export async function refundBookingDeposit({ supabase, userId, input = {}, env = process.env, paypal = defaultPayPal, now = () => Date.now() }) {
  const { practitioner_id: practitionerId, booking_id: bookingId, idempotency_key: key } = input
  const amount = input.amount_cents == null ? null : Number(input.amount_cents)
  if (!isUuid(bookingId) || !isUuid(key) || (amount != null && (!Number.isInteger(amount) || amount <= 0))) {
    return { status: 400, body: { error: 'invalid_request' } }
  }
  const denied = await authorizeSettlement(supabase, userId, practitionerId)
  if (denied) return denied

  let cfg
  try {
    cfg = paypal.config(env)
  } catch (error) {
    return { status: 503, body: { error: error.message === 'rdv_refunds_disabled' ? 'refunds_disabled' : 'paypal_unavailable' } }
  }

  const { data: begun, error } = await supabase.rpc('begin_rdv_payment_refund', {
    p_booking_id: bookingId,
    p_practitioner_id: practitionerId,
    p_amount_cents: amount,
    p_paypal_env: cfg.env,
    p_idempotency_key: key,
    p_actor: userId,
  })
  if (missingSchema(error)) return { status: 503, body: { error: 'migration_pending' } }
  if (error || !begun) return { status: 500, body: { error: 'refund_begin_failed' } }
  if (!begun.ok && begun.error !== 'refund_in_progress') {
    return { status: 409, body: { error: begun.error, ...(begun.remaining_cents != null ? { remaining_cents: begun.remaining_cents } : {}) } }
  }

  const refund = begun.refund
  if (begun.ok && begun.replay) {
    // Double clic / requête rejouée : on renvoie l'état, sans rien relancer.
    if (refund.status === 'completed') return reply('completed')
    if (refund.status === 'failed') return reply('failed', refund.error_code)
    return reply('check_later')
  }
  if (refund.paypal_env !== cfg.env) return { status: 409, body: { error: 'paypal_environment_mismatch' } }
  return processRefund({ supabase, paypal, cfg, refund, fresh: begun.ok === true, now })
}

export async function transferBookingDeposit({ supabase, userId, input = {} }) {
  const { practitioner_id: practitionerId, booking_id: bookingId, target_booking_id: targetId, idempotency_key: key } = input
  if (!isUuid(bookingId) || !isUuid(targetId) || !isUuid(key)) return { status: 400, body: { error: 'invalid_request' } }
  const denied = await authorizeSettlement(supabase, userId, practitionerId)
  if (denied) return denied
  const { data, error } = await supabase.rpc('transfer_rdv_deposit', {
    p_booking_id: bookingId,
    p_target_booking_id: targetId,
    p_practitioner_id: practitionerId,
    p_idempotency_key: key,
    p_actor: userId,
  })
  if (missingSchema(error)) return { status: 503, body: { error: 'migration_pending' } }
  if (error || !data) return { status: 500, body: { error: 'transfer_failed' } }
  if (!data.ok) return { status: 409, body: { error: data.error, ...(data.due_cents != null ? { due_cents: data.due_cents } : {}) } }
  return { status: 200, body: { status: 'transferred', remaining_due_cents: data.remaining_due_cents ?? null } }
}

export async function retainBookingDeposit({ supabase, userId, input = {} }) {
  const { practitioner_id: practitionerId, booking_id: bookingId } = input
  if (!isUuid(bookingId)) return { status: 400, body: { error: 'invalid_request' } }
  const denied = await authorizeSettlement(supabase, userId, practitionerId)
  if (denied) return denied
  const { data, error } = await supabase.rpc('retain_rdv_deposit', {
    p_booking_id: bookingId,
    p_practitioner_id: practitionerId,
    p_actor: userId,
  })
  if (missingSchema(error)) return { status: 503, body: { error: 'migration_pending' } }
  if (error || !data) return { status: 500, body: { error: 'retain_failed' } }
  if (!data.ok) return { status: 409, body: { error: data.error } }
  return { status: 200, body: { status: 'retained' } }
}

// Actions possibles, recalculées côté serveur (l'écran ne fait qu'afficher).
export function allowedActions({ bookingStatus, settlementStatus, refundedCents, activeRefund, paypalEnv, runtimeEnv, refundsEnabled, hasTargets }) {
  const cancelled = bookingStatus === 'cancelled'
  const sameEnv = paypalEnv === runtimeEnv
  return {
    refund: cancelled && refundsEnabled && sameEnv && !activeRefund && ['open', 'partially_refunded'].includes(settlementStatus),
    reconcile: refundsEnabled && sameEnv && Boolean(activeRefund),
    transfer: cancelled && settlementStatus === 'open' && !refundedCents && !activeRefund && hasTargets,
    retain: cancelled && settlementStatus === 'open' && !activeRefund,
  }
}

function ledgerPaid(entries) {
  const paid = new Map()
  for (const e of entries || []) {
    const delta = e.direction === 'refund' ? -Number(e.gross_cents || 0) : Number(e.gross_cents || 0)
    paid.set(e.booking_id, (paid.get(e.booking_id) || 0) + delta)
  }
  return paid
}

export async function listDepositSettlements({ supabase, userId, practitionerId, env = process.env, paypal = defaultPayPal, now = () => Date.now() }) {
  const denied = await authorizeSettlement(supabase, userId, practitionerId)
  if (denied) return denied

  let runtimeEnv = null
  let refundsEnabled = true
  try {
    runtimeEnv = paypal.config(env).env
  } catch (error) {
    refundsEnabled = false
    runtimeEnv = env.VERCEL_ENV === 'production' ? 'live' : 'sandbox'
    if (error.message !== 'rdv_refunds_disabled') runtimeEnv = null
  }

  const { data: payments, error } = await supabase
    .from('rdv_paypal_payments')
    .select('id, paypal_capture_id, paypal_env, amount_cents, captured_at, settlement_status, refunded_cents, settlement_updated_at, hold:rdv_booking_holds!inner(practitioner_id, converted_booking_id)')
    .eq('status', 'captured')
    .eq('hold.practitioner_id', practitionerId)
    .order('captured_at', { ascending: false })
    .limit(1000)
  if (missingSchema(error)) return { status: 200, body: { migration_pending: true, items: [], runtime_env: runtimeEnv, refunds_enabled: refundsEnabled } }
  if (error) return { status: 500, body: { error: 'settlements_lookup_failed' } }

  const byBooking = new Map((payments || []).filter((p) => p.hold?.converted_booking_id).map((p) => [p.hold.converted_booking_id, p]))
  if (!byBooking.size) return { status: 200, body: { items: [], runtime_env: runtimeEnv, refunds_enabled: refundsEnabled } }

  const { data: cancelled, error: bookingError } = await supabase
    .from('bookings')
    .select('id, service_id, status, starts_at, cancelled_at, cancel_reason, customer_first_name, customer_last_name, customer_email')
    .in('id', [...byBooking.keys()])
    .eq('status', 'cancelled')
    .order('starts_at', { ascending: false })
    .limit(100)
  if (bookingError) return { status: 500, body: { error: 'settlements_lookup_failed' } }
  if (!cancelled?.length) return { status: 200, body: { items: [], runtime_env: runtimeEnv, refunds_enabled: refundsEnabled } }

  const paymentIds = cancelled.map((b) => byBooking.get(b.id).id)
  const emails = new Set(cancelled.map((b) => String(b.customer_email || '').toLowerCase()).filter(Boolean))
  const [{ data: refunds }, { data: transfers }, { data: upcoming }] = await Promise.all([
    supabase.from('rdv_payment_refunds')
      .select('id, payment_id, status, amount_cents, paypal_refund_id, error_code, adopted_external, attempt_count, requested_at, last_attempt_at, completed_at, failed_at')
      .in('payment_id', paymentIds)
      .order('requested_at', { ascending: true }),
    supabase.from('rdv_deposit_transfers')
      .select('payment_id, target_booking_id, amount_cents, created_at')
      .in('payment_id', paymentIds),
    supabase.from('bookings')
      .select('id, service_id, starts_at, customer_email, booked_price_cents')
      .eq('practitioner_id', practitionerId)
      .eq('status', 'confirmed')
      .gt('starts_at', new Date(now()).toISOString())
      .order('starts_at')
      .limit(300),
  ])
  const sameCustomer = (upcoming || []).filter((b) => emails.has(String(b.customer_email || '').toLowerCase()))
  const transferTargets = (transfers || []).map((t) => t.target_booking_id)
  const [{ data: services }, { data: targetBookings }, { data: entries }] = await Promise.all([
    supabase.from('booking_services').select('id, title')
      .in('id', [...new Set([...cancelled, ...sameCustomer].map((b) => b.service_id).filter(Boolean))]),
    transferTargets.length
      ? supabase.from('bookings').select('id, starts_at').in('id', transferTargets)
      : Promise.resolve({ data: [] }),
    sameCustomer.length
      ? supabase.from('rdv_financial_entries').select('booking_id, direction, gross_cents').eq('source', 'mediumia').in('booking_id', sameCustomer.map((b) => b.id))
      : Promise.resolve({ data: [] }),
  ])
  const title = new Map((services || []).map((s) => [s.id, s.title]))
  const targetStart = new Map((targetBookings || []).map((b) => [b.id, b.starts_at]))
  const paid = ledgerPaid(entries)

  const items = cancelled.map((booking) => {
    const payment = byBooking.get(booking.id)
    const ownRefunds = (refunds || []).filter((r) => r.payment_id === payment.id)
    const activeRefund = ownRefunds.find((r) => ['pending', 'unknown'].includes(r.status)) || null
    const transfer = (transfers || []).find((t) => t.payment_id === payment.id) || null
    const email = String(booking.customer_email || '').toLowerCase()
    const targets = sameCustomer
      .filter((b) => String(b.customer_email || '').toLowerCase() === email && b.booked_price_cents)
      .map((b) => ({ booking_id: b.id, starts_at: b.starts_at, service_title: title.get(b.service_id) || null, due_cents: Math.max(0, b.booked_price_cents - (paid.get(b.id) || 0)) }))
      .filter((t) => t.due_cents >= payment.amount_cents)
    return {
      booking_id: booking.id,
      starts_at: booking.starts_at,
      cancelled_at: booking.cancelled_at,
      cancel_reason: booking.cancel_reason,
      customer_name: [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' '),
      service_title: title.get(booking.service_id) || null,
      amount_cents: payment.amount_cents,
      refunded_cents: payment.refunded_cents,
      paypal_env: payment.paypal_env,
      paypal_capture_id: payment.paypal_capture_id,
      captured_at: payment.captured_at,
      settlement_status: payment.settlement_status,
      settlement_updated_at: payment.settlement_updated_at,
      refunds: ownRefunds,
      transfer: transfer ? { ...transfer, payment_id: undefined, target_starts_at: targetStart.get(transfer.target_booking_id) || null } : null,
      targets,
      allowed: allowedActions({
        bookingStatus: booking.status,
        settlementStatus: payment.settlement_status,
        refundedCents: payment.refunded_cents,
        activeRefund,
        paypalEnv: payment.paypal_env,
        runtimeEnv,
        refundsEnabled,
        hasTargets: targets.length > 0,
      }),
    }
  })
  return { status: 200, body: { items, runtime_env: runtimeEnv, refunds_enabled: refundsEnabled } }
}
