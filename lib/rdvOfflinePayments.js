/* global process */
/**
 * Règlements hors PayPal des rendez-vous (virement, chèque, espèces, carte sur place).
 *
 *   POST /api/rdv-admin?action=offline-payment  { op: 'announce' | 'confirm' | 'withdraw', ... }
 *   GET  /api/rdv-admin?action=offline-payment&practitioner_id=…&booking_id=…  (historique)
 *
 * « Annoncé » : le client dit avoir payé. Rien n'est comptabilisé ; le rendez-vous
 * n'est ni relancé ni annulé pour impayé, et le lien PayPal du solde est suspendu.
 * « Confirmé » : le propriétaire a vérifié la réception. Une seule écriture
 * comptable, jamais de transaction PayPal fictive ; le solde est recalculé.
 *
 * Toutes les règles (propriété du rendez-vous, montant ≤ reste dû, pas de
 * confirmation pendant une capture PayPal, idempotence, historique) sont
 * appliquées dans la base, sous verrou (migration 20261108120000).
 */

export const OFFLINE_METHODS = new Set(['transfer', 'check', 'cash', 'card', 'other'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883', '42P01'])

// Codes renvoyés par la base → statut HTTP.
const ERROR_STATUS = {
  booking_not_found: 404,
  offline_payment_not_found: 404,
  invalid_request: 400,
  invalid_payment_method: 400,
  invalid_amount: 400,
  invalid_received_on: 400,
  request_id_reused: 409,
  booking_not_confirmed: 409,
  nothing_due: 409,
  amount_exceeds_due: 409,
  announcement_exists: 409,
  announcement_not_open: 409,
  paypal_capture_in_progress: 409,
}

export function isMissingFunctionError(error) {
  return Boolean(error && MISSING_FUNCTION_CODES.has(String(error.code || '')))
}

// Les écritures de Preview ne vont que vers la base TEST (même règle que la caisse).
export function offlineWriteAllowed(env = process.env) {
  if (env.VERCEL_ENV === 'production') return true
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''
  return url.includes('wnbwhnqiulsdjcvkuwos')
}

export function parisToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// Date d'encaissement (heure de Paris) à partir d'une date « AAAA-MM-JJ » ou d'un horodatage.
export function receivedOnFrom(value, now = new Date()) {
  if (typeof value === 'string' && DATE_RE.test(value)) return value
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return null
  return parisToday(date) <= parisToday(now) ? parisToday(date) : null
}

function cleanText(value, max) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

function requestId(value) {
  const id = String(value || '').trim()
  return id.length >= 16 && id.length <= 120 ? id : null
}

function amountCents(value) {
  const cents = Number(value)
  return Number.isInteger(cents) && cents > 0 && cents <= 10000000 ? cents : null
}

function fromRpc(data, error) {
  if (isMissingFunctionError(error)) return { status: 503, body: { error: 'migration_pending' } }
  if (error) return { status: 500, body: { error: 'offline_payment_unavailable' } }
  if (!data?.ok) {
    const code = data?.error || 'offline_payment_unavailable'
    return { status: ERROR_STATUS[code] || 500, body: { error: code, ...(data?.due_cents != null ? { due_cents: data.due_cents } : {}) } }
  }
  return { status: data.replayed ? 200 : 201, body: data }
}

export async function announceOfflinePayment({ supabase, userId, input, env = process.env }) {
  if (!offlineWriteAllowed(env)) return { status: 403, body: { error: 'preview_manual_write_disabled' } }
  const bookingId = String(input?.booking_id || '')
  const method = String(input?.payment_method || 'transfer')
  const cents = amountCents(input?.amount_cents)
  const reqId = requestId(input?.request_id)
  if (!UUID_RE.test(bookingId) || !reqId) return { status: 400, body: { error: 'invalid_request' } }
  if (!OFFLINE_METHODS.has(method)) return { status: 400, body: { error: 'invalid_payment_method' } }
  if (!cents) return { status: 400, body: { error: 'invalid_amount' } }
  const { data, error } = await supabase.rpc('announce_rdv_offline_payment', {
    p_actor: userId,
    p_booking_id: bookingId,
    p_payment_method: method,
    p_amount_cents: cents,
    p_note: cleanText(input?.note, 500),
    p_request_id: reqId,
  })
  return fromRpc(data, error)
}

export async function confirmOfflinePayment({ supabase, userId, input, env = process.env, now = new Date() }) {
  if (!offlineWriteAllowed(env)) return { status: 403, body: { error: 'preview_manual_write_disabled' } }
  const bookingId = String(input?.booking_id || '')
  const method = String(input?.payment_method || '')
  const cents = amountCents(input?.amount_cents)
  const reqId = requestId(input?.request_id)
  const receivedOn = receivedOnFrom(input?.received_on, now)
  const offlineId = input?.offline_payment_id ? String(input.offline_payment_id) : null
  if (!UUID_RE.test(bookingId) || !reqId || (offlineId && !UUID_RE.test(offlineId))) return { status: 400, body: { error: 'invalid_request' } }
  if (!OFFLINE_METHODS.has(method)) return { status: 400, body: { error: 'invalid_payment_method' } }
  if (!cents) return { status: 400, body: { error: 'invalid_amount' } }
  if (!receivedOn) return { status: 400, body: { error: 'invalid_received_on' } }
  // Confirmation explicite : le propriétaire atteste avoir vu l'argent sur son compte.
  if (input?.receipt_verified !== true) return { status: 400, body: { error: 'receipt_confirmation_required' } }
  const { data, error } = await supabase.rpc('confirm_rdv_offline_payment', {
    p_actor: userId,
    p_booking_id: bookingId,
    p_payment_method: method,
    p_amount_cents: cents,
    p_received_on: receivedOn,
    p_reference: cleanText(input?.reference, 120),
    p_note: cleanText(input?.note, 500),
    p_request_id: reqId,
    p_offline_payment_id: offlineId,
  })
  return fromRpc(data, error)
}

export async function withdrawOfflinePayment({ supabase, userId, input, env = process.env }) {
  if (!offlineWriteAllowed(env)) return { status: 403, body: { error: 'preview_manual_write_disabled' } }
  const offlineId = String(input?.offline_payment_id || '')
  if (!UUID_RE.test(offlineId)) return { status: 400, body: { error: 'invalid_request' } }
  const { data, error } = await supabase.rpc('withdraw_rdv_offline_payment', {
    p_actor: userId,
    p_offline_payment_id: offlineId,
    p_reason: cleanText(input?.reason, 200),
  })
  return fromRpc(data, error)
}

export async function listOfflinePaymentHistory({ supabase, userId, practitionerId, bookingId }) {
  if (!UUID_RE.test(String(practitionerId || '')) || !UUID_RE.test(String(bookingId || ''))) {
    return { status: 400, body: { error: 'invalid_request' } }
  }
  const { data: owner } = await supabase.from('booking_practitioners').select('id')
    .eq('id', practitionerId).eq('owner_id', userId).maybeSingle()
  if (!owner) return { status: 403, body: { error: 'forbidden' } }
  const [payments, events] = await Promise.all([
    supabase.from('rdv_offline_payments')
      .select('id, status, payment_method, announced_amount_cents, received_amount_cents, received_on, reference, note, created_at, confirmed_at, withdrawn_at')
      .eq('practitioner_id', practitionerId).eq('booking_id', bookingId).order('created_at', { ascending: false }),
    supabase.from('rdv_offline_payment_events')
      .select('event, detail, created_at').eq('booking_id', bookingId).order('created_at', { ascending: true }),
  ])
  if (isMissingFunctionError(payments.error) || isMissingFunctionError(events.error)) return { status: 503, body: { error: 'migration_pending' } }
  if (payments.error || events.error) return { status: 500, body: { error: 'offline_payment_unavailable' } }
  return { status: 200, body: { payments: payments.data || [], events: events.data || [] } }
}

export async function handleOfflinePaymentAdmin({ supabase, userId, method, query, input }) {
  if (method === 'GET') return listOfflinePaymentHistory({ supabase, userId, practitionerId: query?.practitioner_id, bookingId: query?.booking_id })
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  if (input?.op === 'announce') return announceOfflinePayment({ supabase, userId, input })
  if (input?.op === 'confirm') return confirmOfflinePayment({ supabase, userId, input })
  if (input?.op === 'withdraw') return withdrawOfflinePayment({ supabase, userId, input })
  return { status: 400, body: { error: 'invalid_request' } }
}

// Annonces ouvertes et paiements PayPal du solde pour une liste de rendez-vous.
// Tolérant à une base sans la migration : rien d'annoncé.
export async function loadPaymentSignals(supabase, bookingIds) {
  const announced = new Map()
  const balance = new Map()
  if (!bookingIds?.length) return { announced, balance }
  const [offline, paypal] = await Promise.all([
    supabase.from('rdv_offline_payments').select('id, booking_id, payment_method, announced_amount_cents, created_at')
      .eq('status', 'announced').in('booking_id', bookingIds),
    supabase.from('rdv_balance_payments').select('booking_id, status').in('booking_id', bookingIds),
  ])
  if (!offline.error) for (const row of offline.data || []) announced.set(row.booking_id, row)
  else if (!isMissingFunctionError(offline.error)) console.error('[rdv-offline] announcements lookup failed')
  if (!paypal.error) for (const row of paypal.data || []) balance.set(row.booking_id, row.status)
  return { announced, balance }
}

// État affiché dans l'agenda propriétaire.
//   settled   : Paiement reçu et confirmé
//   to_verify : Paiement à vérifier (capture PayPal en cours ou incohérente)
//   announced : Virement annoncé, en attente de vérification
//   due       : Solde à régler
export function paymentState({ remainingCents, totalCents, status, announced, balanceStatus }) {
  if (status && status !== 'confirmed') return null
  if (totalCents > 0 && remainingCents === 0) return 'settled'
  if (balanceStatus === 'capture_in_progress' || balanceStatus === 'captured') return 'to_verify'
  if (announced) return 'announced'
  return remainingCents > 0 ? 'due' : null
}
