/**
 * Soldes des visios — étape Google d'un rétablissement, et sa reprise après
 * interruption (issue #147, revue PR #148).
 *
 * Une restauration commence en base (statut google_pending), puis l'événement
 * Google est réactivé ou recréé avec un identifiant fixe. Chaque essai Google
 * se fait sous un verrou de reprise (claim_rdv_balance_restore_resume, 5 min)
 * et chaque essai est journalisé (attempts, last_error).
 *
 *   restored | created                  → complete_rdv_balance_restore
 *   uncertain (délai, coupure, 5xx)     → reste en attente, jamais compensé :
 *                                         Google a pu appliquer la modification ;
 *                                         l'essai suivant est sans doublon.
 *   Google déconnecté / jeton invalide  → reste en attente + alerte : rien n'est
 *                                         écrit, jamais conclu comme synchronisé.
 *   failed (refus net de Google)        → compensate_rdv_balance_restore
 *                                         (retour à l'état annulé), sauf si un
 *                                         paiement a commencé : examen manuel.
 *
 * Une reprise différée revérifie d'abord le créneau dans Google (en ignorant
 * seulement les événements de cette réservation) : nouveau conflit → examen
 * manuel, aucune écriture.
 *
 * Les restaurations restées en attente sont reprises par le cron quotidien
 * (budget de temps strict) ou par le bouton « Reprendre » du tableau de bord ;
 * le propriétaire est alerté si la reprise échoue ou si la restauration est abandonnée.
 */
import { googleSlotIsFree, recreatedEventId, restoreBalanceBookingEvent } from './rdvBalanceGoogle.js'
import { sendOwnerBalanceAlert } from './rdvBalanceOwnerAlerts.js'

const DONE_STATUSES = new Set(['restored', 'created'])
// Accès au calendrier impossible : rien n'a été écrit chez Google.
const DISCONNECTED_REASONS = new Set(['token_error', 'missing_calendar_id', 'calendar_unavailable'])
const isDisconnected = (google) => google.status === 'not_connected' || DISCONNECTED_REASONS.has(google.reason)
// Délai avant que le cron ne reprenne une restauration : laisse finir la requête d'origine.
export const RESUME_GRACE_MS = 2 * 60_000
// Au-delà de ce nombre d'essais incertains, le propriétaire est prévenu (une fois).
export const RESUME_ALERT_ATTEMPTS = 3
// Cron : petit lot et délai Google court pour ne jamais retarder le reste.
export const CRON_RESUME_LIMIT = 3
export const CRON_GOOGLE_TIMEOUT_MS = 4000

async function recordFailure(supabase, restorationId, error) {
  await supabase.rpc('record_rdv_balance_restore_failure', { p_restoration_id: restorationId, p_error: error })
    .then(() => null, () => null)
}

export async function loadRestorationContext(supabase, bookingId) {
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, starts_at, ends_at, timezone, status, google_event_id, booked_price_cents, balance_reminder_sent_at')
    .eq('id', bookingId)
    .maybeSingle()
  if (!booking) return null
  const [{ data: service }, { data: paid }, { data: practitioner }] = await Promise.all([
    supabase.from('booking_services').select('id, title, modality').eq('id', booking.service_id).maybeSingle(),
    supabase.rpc('rdv_booking_paid_cents', { p_booking_id: booking.id }),
    supabase.from('booking_practitioners').select('id, buffer_before_min, buffer_after_min').eq('id', booking.practitioner_id).maybeSingle(),
  ])
  return { booking, service, practitioner, paidCents: Number(paid || 0) }
}

/**
 * Un essai Google pour une restauration en attente. Le verrou de reprise doit
 * déjà être pris par l'appelant. Ne lance jamais d'exception.
 * outcome : completed | pending | compensated | manual_review
 */
export async function attemptRestorationGoogle({ supabase, restorationId, booking, service, paidCents, dueCents, fetchImpl, timeoutMs, deadlineAt }) {
  const google = await restoreBalanceBookingEvent({
    supabase,
    booking: { ...booking, status: 'confirmed' },
    service,
    paidCents,
    dueCents,
    operationId: restorationId,
    fetchImpl,
    timeoutMs,
    deadlineAt,
  }).catch(() => ({ status: 'uncertain', reason: 'exception' }))

  if (isDisconnected(google)) {
    await recordFailure(supabase, restorationId, 'google_disconnected')
    return { outcome: 'pending', reason: 'google_disconnected', google_status: google.status }
  }

  if (DONE_STATUSES.has(google.status)) {
    const { data: completed, error } = await supabase.rpc('complete_rdv_balance_restore', {
      p_restoration_id: restorationId,
      p_google_status: google.status,
      p_google_event_id: google.google_event_id && google.google_event_id !== booking.google_event_id ? google.google_event_id : null,
    }).then(r => r, () => ({ error: true }))
    if (error || !completed?.ok) {
      // Google est à jour mais la base n'a pas confirmé : la reprise rejouera
      // le PATCH (idempotent) puis la clôture.
      await recordFailure(supabase, restorationId, 'completion_failed')
      return { outcome: 'pending', reason: 'completion_failed', google_status: google.status }
    }
    return { outcome: 'completed', google_status: google.status }
  }

  if (google.status === 'uncertain') {
    await recordFailure(supabase, restorationId, `google_${google.reason || 'uncertain'}`)
    return { outcome: 'pending', reason: google.reason || 'uncertain', google_status: google.status }
  }

  const reason = `google_${google.reason || 'failed'}`
  const { data: compensated } = await supabase.rpc('compensate_rdv_balance_restore', {
    p_restoration_id: restorationId,
    p_reason: reason,
  }).then(r => r, () => ({ data: null }))
  if (compensated?.ok) return { outcome: 'compensated', reason, google_status: google.status }
  await recordFailure(supabase, restorationId, `compensation_${compensated?.error || 'failed'}`)
  return { outcome: 'manual_review', reason: compensated?.error || 'compensation_failed', google_status: google.status }
}

// Événements Google appartenant à cette réservation (jamais considérés comme un conflit).
export function ownEventIds(booking, restorationId) {
  return [booking.google_event_id, recreatedEventId(booking.id, restorationId), recreatedEventId(booking.id, booking.id)].filter(Boolean)
}

/**
 * Reprend une restauration en attente (cron ou bouton « Reprendre »).
 * outcome : completed | pending | conflict | compensated | manual_review | busy | not_pending | error
 */
export async function resumeRestoration({ supabase, restorationId, now = new Date(), fetchImpl, timeoutMs, deadlineAt }) {
  const { data: claim, error } = await supabase.rpc('claim_rdv_balance_restore_resume', {
    p_restoration_id: restorationId,
    p_now: now.toISOString(),
  }).then(r => r, () => ({ error: true }))
  if (error) return { outcome: 'error', reason: 'claim_failed' }
  if (!claim?.ok) {
    if (claim?.error === 'resume_in_progress') return { outcome: 'busy', reason: 'resume_in_progress' }
    if (claim?.error === 'restoration_not_pending') return { outcome: 'not_pending', status: claim.status || null }
    return { outcome: 'error', reason: claim?.error || 'claim_failed' }
  }
  const context = await loadRestorationContext(supabase, claim.booking_id)
  if (!context) {
    await recordFailure(supabase, restorationId, 'booking_not_found')
    return { outcome: 'error', reason: 'booking_not_found' }
  }
  const base = { attempts: Number(claim.attempts), bookingId: claim.booking_id, context, dueCents: Number(claim.due_cents) }
  // Rendez-vous déjà commencé : jamais d'écriture Google sur un créneau passé.
  if (new Date(context.booking.starts_at).getTime() <= now.getTime()) {
    await recordFailure(supabase, restorationId, 'appointment_started')
    return { outcome: 'overdue', reason: 'appointment_started', ...base }
  }
  // Reprise différée : le créneau a pu être occupé dans Google entre-temps.
  const free = await googleSlotIsFree({
    supabase,
    booking: context.booking,
    practitioner: context.practitioner,
    ownEventIds: ownEventIds(context.booking, restorationId),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(deadlineAt ? { deadlineAt } : {}),
  })
  if (!free.ok) {
    const conflict = free.error === 'google_slot_busy'
    const reason = conflict ? 'google_slot_conflict' : (free.error === 'google_calendar_unavailable' ? 'google_disconnected' : free.error)
    await recordFailure(supabase, restorationId, reason)
    return { outcome: conflict ? 'conflict' : 'pending', reason, ...base }
  }
  const result = await attemptRestorationGoogle({
    supabase,
    restorationId,
    booking: context.booking,
    service: context.service,
    paidCents: context.paidCents,
    dueCents: Number(claim.due_cents),
    fetchImpl,
    timeoutMs,
    deadlineAt,
  })
  return { ...result, ...base }
}

const ALERT_REASON = {
  compensated: 'restore_compensated',
  manual_review: 'restore_manual_review',
  conflict: 'restore_conflict',
  overdue: 'restore_started',
}

/**
 * Exécute `run` sans jamais dépasser l'échéance globale : passé ce délai, on
 * cesse d'attendre (résultat « deferred_budget ») ; l'opération en cours garde
 * son verrou en base et sera reprise au passage suivant, sans doublon.
 */
export async function withinDeadline(deadline, clock, run) {
  const left = deadline - clock()
  if (!(left > 0)) return { outcome: 'deferred_budget' }
  const work = Promise.resolve().then(run).catch(() => ({ outcome: 'error', reason: 'exception' }))
  if (!Number.isFinite(left)) return work
  let timer
  const expiry = new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'deferred_budget' }), left) })
  try {
    return await Promise.race([work, expiry])
  } finally {
    clearTimeout(timer)
  }
}

function alertReasonFor(result) {
  if (ALERT_REASON[result.outcome]) return ALERT_REASON[result.outcome]
  if (result.outcome !== 'pending') return null
  if (result.reason === 'google_disconnected') return 'restore_google_disconnected'
  return result.attempts >= RESUME_ALERT_ATTEMPTS ? 'restore_google_retrying' : null
}

// Annulations revendiquées puis abandonnées (processus interrompu) : libérées
// en tête de cron pour ne pas bloquer paiements et décisions.
export async function releaseStaleCancelClaims({ supabase, now = new Date() }) {
  const { data } = await supabase.rpc('release_stale_rdv_balance_cancel_claims', { p_now: now.toISOString() })
    .then(r => r, () => ({ data: 0 }))
  return Number(data || 0)
}

/**
 * Cron : reprise des restaurations en attente depuis plus de RESUME_GRACE_MS,
 * par petit lot. Échéance `deadline` STRICTE : aucun appel Google lancé après
 * elle, chaque appel est coupé à elle, et l'attente globale aussi
 * (withinDeadline). Ce qui n'a pas pu être traité est reporté.
 */
export async function reconcilePendingRestorations({
  supabase, now = new Date(), limit = CRON_RESUME_LIMIT, fetchImpl, sendAlert = sendOwnerBalanceAlert,
  deadline = Infinity, clock = Date.now, timeoutMs = CRON_GOOGLE_TIMEOUT_MS,
}) {
  const summary = { examined: 0, deferred: 0, outcomes: {}, alerts: {} }
  const { data: pending, error } = await supabase
    .from('rdv_balance_restorations')
    .select('id, booking_id, attempts, created_at')
    .eq('status', 'google_pending')
    .lt('created_at', new Date(now.getTime() - RESUME_GRACE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) return { ...summary, error: 'restoration_lookup_failed' }

  const deadlineAt = Number.isFinite(deadline) ? deadline : null
  for (const row of pending || []) {
    if (clock() >= deadline) { summary.deferred += 1; continue }
    const result = await withinDeadline(deadline, clock, () => resumeRestoration({ supabase, restorationId: row.id, now, fetchImpl, timeoutMs, deadlineAt }))
    if (result.outcome === 'deferred_budget') { summary.deferred += 1; continue }
    summary.examined += 1
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1
    const reason = alertReasonFor(result)
    if (!reason || !result.context) continue
    const alert = await sendAlert({
      supabase,
      item: { booking: result.context.booking, service: result.context.service, dueCents: result.dueCents },
      kind: result.outcome === 'overdue' ? 'google_overdue' : 'restore',
      reason,
      now,
    }).catch(() => ({ status: 'failed' }))
    summary.alerts[alert.status] = (summary.alerts[alert.status] || 0) + 1
  }
  return summary
}
