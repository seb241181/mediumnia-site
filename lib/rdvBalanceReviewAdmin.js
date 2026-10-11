/* global process */
/**
 * Soldes des visios — tableau de bord du propriétaire (issue #147).
 *
 *   GET  : visios à venir avec solde dû ou annulées pour solde, état PayPal,
 *          alertes, décision, motif de blocage éventuel (lecture seule).
 *   POST op=decision : Maintenir / approuver l'annulation / lever la décision.
 *   POST op=restore  : rétablir une visio annulée pour solde et générer un
 *                      nouveau lien du solde exact (fonction activable).
 *   POST op=rotate   : nouveau lien pour une visio rétablie encore due.
 *   POST op=resume   : reprendre une restauration interrompue (Google n'avait
 *                      pas répondu), puis générer le lien du solde.
 *
 * Réservé au propriétaire du profil ET à l'administration de la plateforme
 * (même règle que les arrhes : l'argent est sur le compte PayPal principal).
 * Aucune donnée n'est exposée publiquement ; les règles sont en base.
 */
import { createHash, randomBytes } from 'node:crypto'
import { authorizeSettlement } from './rdvDepositSettlements.js'
import { googleAccessToken } from './rdvSlotOffers.js'
import { attemptRestorationGoogle, resumeRestoration } from './rdvBalanceRestoreResume.js'
import { balancePaymentUrl, buildRdvBalanceRestored } from './rdvBalanceEmail.js'
import { runtimeRdvBalancePayPalConfig } from './rdvBalancePayPal.js'
import { ownerAlertRecipient } from './rdvBalanceOwnerAlerts.js'
import { sendEmail } from './transactionalEmail.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const LATE_WINDOW_HOURS = [1, 2, 6, 24]
// Pages Google lues au plus (250 événements chacune) ; au-delà, refus : jamais de conclusion sur une liste tronquée.
export const GOOGLE_SLOT_MAX_PAGES = 8

const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex')
const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } })

export function restoreEnabled(env = process.env) {
  return String(env.RDV_BALANCE_RESTORE_ENABLED || '').trim() === 'true'
}

async function authorize(supabase, userId, practitionerId) {
  if (!UUID_RE.test(String(practitionerId || ''))) return fail(400, 'invalid_request')
  const auth = await authorizeSettlement(supabase, userId, practitionerId)
  return auth?.status ? auth : null
}

async function loadBooking(supabase, practitionerId, bookingId) {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, starts_at, ends_at, timezone, status, google_event_id, booked_price_cents')
    .eq('id', bookingId)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (!booking) return null
  const [{ data: service }, { data: practitioner }] = await Promise.all([
    supabase.from('booking_services').select('id, title, modality').eq('id', booking.service_id).maybeSingle(),
    supabase.from('booking_practitioners').select('id, buffer_before_min, buffer_after_min').eq('id', practitionerId).maybeSingle(),
  ])
  return { booking, service, practitioner }
}

// Le créneau doit être libre AUSSI dans Google Agenda (rendez-vous saisis à la
// main, blocages). Toutes les pages de résultats sont lues (nextPageToken) ;
// sans accès à Google ou si la liste est tronquée, on refuse : jamais de
// restauration à l'aveugle.
export async function googleSlotIsFree({ supabase, booking, practitioner, fetchImpl = fetch, maxPages = GOOGLE_SLOT_MAX_PAGES }) {
  let access
  try {
    access = await googleAccessToken(supabase, booking.practitioner_id)
  } catch {
    return { ok: false, error: 'google_calendar_unavailable' }
  }
  const beforeMs = (practitioner?.buffer_before_min ?? 0) * 60_000
  const afterMs = (practitioner?.buffer_after_min ?? 0) * 60_000
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(access.calendarId)}/events`
  let pageToken = null
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        timeMin: new Date(new Date(booking.starts_at).getTime() - beforeMs).toISOString(),
        timeMax: new Date(new Date(booking.ends_at).getTime() + afterMs).toISOString(),
        singleEvents: 'true',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,transparency)',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const response = await fetchImpl(`${base}?${params}`, {
        headers: { Authorization: `Bearer ${access.accessToken}` },
      })
      if (!response.ok) return { ok: false, error: 'google_calendar_unavailable' }
      const body = await response.json()
      if (!body || (body.items != null && !Array.isArray(body.items))) return { ok: false, error: 'google_calendar_unavailable' }
      const busy = (body.items || []).some(event => event?.status !== 'cancelled'
        && event?.transparency !== 'transparent'
        && event?.id !== booking.google_event_id)
      if (busy) return { ok: false, error: 'google_slot_busy' }
      pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null
      if (!pageToken) return { ok: true, pages: page + 1 }
    }
    return { ok: false, error: 'google_calendar_truncated' }
  } catch {
    return { ok: false, error: 'google_calendar_unavailable' }
  }
}

export async function listBalanceWatch({ supabase, userId, practitionerId, env = process.env, now = new Date() }) {
  const denied = await authorize(supabase, userId, practitionerId)
  if (denied) return denied
  const [{ data: items, error }, { data: settings }] = await Promise.all([
    supabase.rpc('rdv_balance_watch', { p_practitioner_id: practitionerId, p_now: now.toISOString(), p_horizon_days: 10 }),
    supabase.from('rdv_balance_runtime_settings').select('auto_cancel_mode, require_owner_alert, owner_alert_min_lead_hours').maybeSingle(),
  ])
  if (error) return fail(error.code === 'PGRST202' ? 503 : 500, error.code === 'PGRST202' ? 'migration_pending' : 'watch_failed')
  return {
    status: 200,
    body: {
      items: items || [],
      settings: settings || null,
      restore_enabled: restoreEnabled(env),
      owner_alert_configured: Boolean(ownerAlertRecipient(env)),
      late_window_hours: LATE_WINDOW_HOURS,
    },
  }
}

export async function setBalanceDecision({ supabase, userId, input = {} }) {
  const denied = await authorize(supabase, userId, input.practitioner_id)
  if (denied) return denied
  if (!UUID_RE.test(String(input.booking_id || ''))) return fail(400, 'invalid_request')
  const decision = input.decision === 'hold' || input.decision === 'cancel' ? input.decision : null
  if (input.decision != null && decision === null) return fail(400, 'invalid_decision')
  const { data, error } = await supabase.rpc('set_rdv_balance_owner_decision', {
    p_booking_id: input.booking_id,
    p_practitioner_id: input.practitioner_id,
    p_actor: userId,
    p_decision: decision,
    p_note: typeof input.note === 'string' ? input.note.slice(0, 500) : null,
  })
  if (error) return fail(500, 'decision_failed')
  if (!data?.ok) return fail(409, data?.error || 'decision_failed')
  return { status: 200, body: { ok: true, decision: data.decision, replay: !!data.replay } }
}

async function sendRestoredEmail({ booking, service, dueCents, paidCents, lateUntil, paymentUrl, idempotencyKey, send }) {
  const message = buildRdvBalanceRestored({
    firstName: booking.customer_first_name,
    serviceTitle: service?.title || 'Visio',
    startsAt: booking.starts_at,
    timezone: booking.timezone || 'Europe/Paris',
    balanceCents: dueCents,
    paidCents,
    deadlineAt: lateUntil,
    paymentUrl,
  })
  try {
    const sent = await send({ to: booking.customer_email, ...message, idempotencyKey })
    return sent.status === 'sent' ? 'sent' : (sent.uncertain ? 'uncertain' : 'failed')
  } catch {
    return 'uncertain'
  }
}

export async function restoreBalanceBooking({
  supabase, userId, input = {}, env = process.env, now = new Date(), fetchImpl = fetch, send = sendEmail,
}) {
  if (!restoreEnabled(env)) return fail(403, 'restore_disabled')
  const denied = await authorize(supabase, userId, input.practitioner_id)
  if (denied) return denied
  if (!UUID_RE.test(String(input.booking_id || '')) || !UUID_RE.test(String(input.idempotency_key || ''))) return fail(400, 'invalid_request')
  if (input.confirm_no_external_payment !== true) return fail(400, 'external_payment_confirmation_required')
  const hours = Number(input.hours_before)
  if (!LATE_WINDOW_HOURS.includes(hours)) return fail(400, 'invalid_late_window')

  const context = await loadBooking(supabase, input.practitioner_id, input.booking_id)
  if (!context) return fail(404, 'booking_not_found')
  const { booking, service, practitioner } = context

  // 0. Même clé déjà utilisée (réponse perdue, double clic) : reprise, sans
  //    nouveau contrôle de créneau puisque la visio est déjà rétablie en base.
  const { data: previous, error: previousError } = await supabase
    .from('rdv_balance_restorations')
    .select('id, booking_id, status')
    .eq('idempotency_key', input.idempotency_key)
    .maybeSingle()
  if (previousError) return fail(500, 'restore_check_failed')
  if (previous) {
    if (previous.booking_id !== booking.id) return fail(409, 'idempotency_key_reused')
    return finishResume({ supabase, userId, input, env, now, fetchImpl, send, restorationId: previous.id, replay: true })
  }

  // 1. Contrôle commun (sans écriture) avant d'interroger Google.
  const { data: blocker, error: blockerError } = await supabase.rpc('rdv_balance_restore_blocker', { p_booking_id: booking.id, p_now: now.toISOString() })
  if (blockerError) return fail(500, 'restore_check_failed')
  if (blocker) return fail(409, blocker)

  // 2. Créneau libre dans Google Agenda.
  const free = await googleSlotIsFree({ supabase, booking, practitioner, fetchImpl })
  if (!free.ok) return fail(409, free.error)

  let paypalEnv
  try {
    paypalEnv = runtimeRdvBalancePayPalConfig().env
  } catch {
    return fail(503, 'paypal_not_configured')
  }

  // 3. Restauration sous verrou (la base refait tous les contrôles).
  const token = randomBytes(32).toString('base64url')
  const lateUntil = new Date(new Date(booking.starts_at).getTime() - hours * 3_600_000)
  const { data: restored, error: restoreError } = await supabase.rpc('restore_rdv_balance_cancelled_booking', {
    p_booking_id: booking.id,
    p_practitioner_id: input.practitioner_id,
    p_actor: userId,
    p_idempotency_key: input.idempotency_key,
    p_token_hash: hashToken(token),
    p_late_until: lateUntil.toISOString(),
    p_paypal_env: paypalEnv,
    p_no_external_payment_confirmed: true,
  })
  if (restoreError) return fail(500, 'restore_failed')
  if (!restored?.ok) return fail(409, restored?.error || 'restore_failed')
  if (restored.replay) {
    // Requête rejouée (réponse perdue, double clic) : on reprend là où elle
    // s'est arrêtée. Le jeton d'origine n'est jamais conservé en clair : le
    // lien est régénéré une fois la restauration terminée.
    return finishResume({ supabase, userId, input, env, now, fetchImpl, send, restorationId: restored.restoration_id, replay: true })
  }

  // 4. Google sous verrou de reprise : réactivation de l'événement (ou
  //    recréation à identifiant fixe). Incertain → en attente, jamais compensé.
  const { data: claim } = await supabase.rpc('claim_rdv_balance_restore_resume', {
    p_restoration_id: restored.restoration_id,
    p_now: now.toISOString(),
  }).then(r => r, () => ({ data: null }))
  if (!claim?.ok) return pendingResponse(restored.restoration_id, 'resume_claim_failed')
  const attempt = await attemptRestorationGoogle({
    supabase,
    restorationId: restored.restoration_id,
    booking,
    service,
    paidCents: Number(restored.paid_cents),
    dueCents: Number(restored.due_cents),
    fetchImpl,
  })
  if (attempt.outcome === 'pending') return pendingResponse(restored.restoration_id, attempt.reason)
  if (attempt.outcome === 'compensated') return fail(502, 'google_restore_failed', { compensated: true })
  if (attempt.outcome === 'manual_review') return fail(409, 'restore_manual_review', { restoration_id: restored.restoration_id })
  const google = { status: attempt.google_status }

  const paymentUrl = balancePaymentUrl(token)
  let emailStatus = 'not_requested'
  if (input.send_email === true) {
    emailStatus = await sendRestoredEmail({
      booking, service,
      dueCents: Number(restored.due_cents),
      paidCents: Number(restored.paid_cents),
      lateUntil,
      paymentUrl,
      idempotencyKey: `rdv-balance-restore/${restored.restoration_id}`,
      send,
    })
    await supabase.rpc('record_rdv_balance_restore_email', { p_restoration_id: restored.restoration_id, p_email_status: emailStatus })
  }

  return {
    status: 200,
    body: {
      ok: true,
      restoration_id: restored.restoration_id,
      payment_url: paymentUrl,
      due_cents: Number(restored.due_cents),
      paid_cents: Number(restored.paid_cents),
      late_until: lateUntil.toISOString(),
      google_status: google.status,
      email_status: emailStatus,
    },
  }
}

// Restauration en base faite, Google pas encore confirmé : le rendez-vous reste
// réservé, la reprise (cron ou « Reprendre ») terminera sans doublon.
function pendingResponse(restorationId, reason) {
  return { status: 202, body: { ok: true, pending: true, restoration_id: restorationId, reason: reason || 'google_uncertain' } }
}

async function finishResume({ supabase, userId, input, env, now, fetchImpl, send, restorationId, replay = false }) {
  const result = await resumeRestoration({ supabase, restorationId, now, fetchImpl })
  const done = result.outcome === 'completed' || (result.outcome === 'not_pending' && result.status === 'completed')
  if (done) {
    if (!restoreEnabled(env)) return { status: 200, body: { ok: true, replay, completed: true, payment_url: null } }
    const link = await rotateBalanceLink({ supabase, userId, input, env, send })
    if (link.status !== 200) return { status: link.status, body: { ...link.body, completed: true, replay } }
    return { status: 200, body: { ...link.body, completed: true, replay, restoration_id: restorationId } }
  }
  if (result.outcome === 'pending' || result.outcome === 'busy') return pendingResponse(restorationId, result.reason)
  if (result.outcome === 'compensated' || (result.outcome === 'not_pending' && result.status === 'compensated')) {
    return fail(502, 'google_restore_failed', { compensated: true, replay })
  }
  if (result.outcome === 'manual_review') return fail(409, 'restore_manual_review', { restoration_id: restorationId })
  return fail(500, result.reason || 'resume_failed', { restoration_id: restorationId })
}

// Bouton « Reprendre » : restauration restée en attente (coupure, délai Google).
export async function resumeBalanceRestoration({
  supabase, userId, input = {}, env = process.env, now = new Date(), fetchImpl = fetch, send = sendEmail,
}) {
  const denied = await authorize(supabase, userId, input.practitioner_id)
  if (denied) return denied
  if (!UUID_RE.test(String(input.booking_id || ''))) return fail(400, 'invalid_request')
  const context = await loadBooking(supabase, input.practitioner_id, input.booking_id)
  if (!context) return fail(404, 'booking_not_found')
  const { data: pending, error } = await supabase
    .from('rdv_balance_restorations')
    .select('id')
    .eq('booking_id', input.booking_id)
    .eq('status', 'google_pending')
    .maybeSingle()
  if (error) return fail(500, 'resume_failed')
  if (!pending) return fail(409, 'restoration_not_pending')
  return finishResume({ supabase, userId, input, env, now, fetchImpl, send, restorationId: pending.id })
}

export async function rotateBalanceLink({ supabase, userId, input = {}, env = process.env, send = sendEmail }) {
  if (!restoreEnabled(env)) return fail(403, 'restore_disabled')
  const denied = await authorize(supabase, userId, input.practitioner_id)
  if (denied) return denied
  if (!UUID_RE.test(String(input.booking_id || ''))) return fail(400, 'invalid_request')
  const context = await loadBooking(supabase, input.practitioner_id, input.booking_id)
  if (!context) return fail(404, 'booking_not_found')

  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const { data, error } = await supabase.rpc('rotate_rdv_balance_restore_token', {
    p_booking_id: input.booking_id,
    p_practitioner_id: input.practitioner_id,
    p_actor: userId,
    p_token_hash: tokenHash,
  })
  if (error) return fail(500, 'rotate_failed')
  if (!data?.ok) return fail(409, data?.error || 'rotate_failed')

  const paymentUrl = balancePaymentUrl(token)
  let emailStatus = 'not_requested'
  if (input.send_email === true) {
    const { data: paid } = await supabase.rpc('rdv_booking_paid_cents', { p_booking_id: input.booking_id })
    emailStatus = await sendRestoredEmail({
      booking: context.booking,
      service: context.service,
      dueCents: Number(data.due_cents),
      paidCents: Number(paid || 0),
      lateUntil: new Date(data.late_until),
      paymentUrl,
      idempotencyKey: `rdv-balance-restore-link/${input.booking_id}/${tokenHash.slice(0, 16)}`,
      send,
    })
  }
  return { status: 200, body: { ok: true, payment_url: paymentUrl, due_cents: Number(data.due_cents), late_until: data.late_until, email_status: emailStatus } }
}
