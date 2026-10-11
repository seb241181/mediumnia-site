/**
 * Soldes des visios — remise de l'événement Google après une annulation
 * automatique interrompue (issue #147, revues PR #148).
 *
 * claim_rdv_balance_auto_cancel pose un repère durable (balance_google_resync_at)
 * AVANT la suppression Google ; seule la finalisation de l'annulation l'efface.
 * Si le traitement s'arrête entre les deux (réponse Google perdue, finalisation
 * refusée, processus coupé), la réservation reste confirmée et son événement
 * est remis, dans cet ordre :
 *   1. rendez-vous déjà commencé → aucune écriture Google, repère conservé,
 *      incident persistant (examen manuel) et alerte urgente ;
 *   2. contrôle du créneau dans Google, en ignorant SEULEMENT les événements
 *      de cette réservation : un autre événement (rendez-vous saisi à la main)
 *      → aucune écriture, repère conservé, examen manuel, alerte ; l'autre
 *      événement n'est jamais modifié ni supprimé ;
 *   3. réactivation de SON identifiant (PATCH, idempotent), sinon recréation à
 *      identifiant fixe dérivé de la réservation (409 → même événement).
 * Google déconnecté, refus ou réponse incertaine : repère conservé, essai
 * journalisé, alerte ; le cron suivant réessaie.
 */
import { googleSlotIsFree, recreatedEventId, restoreBalanceBookingEvent } from './rdvBalanceGoogle.js'
import { CRON_GOOGLE_TIMEOUT_MS, loadRestorationContext, withinDeadline } from './rdvBalanceRestoreResume.js'
import { sendOwnerBalanceAlert } from './rdvBalanceOwnerAlerts.js'

export const CRON_RESYNC_LIMIT = 5
// Un rendez-vous qui commence avant le prochain passage du cron (quotidien) est imminent.
export const IMMINENT_MS = 26 * 3_600_000
// Temps laissé aux alertes après l'échéance Google (elles ne sont jamais sautées).
export const ALERT_GRACE_MS = 10_000

async function recordFailure(supabase, bookingId, error, manualReview = false) {
  const name = manualReview ? 'flag_rdv_balance_google_resync_review' : 'record_rdv_balance_google_resync_failure'
  await supabase.rpc(name, { p_booking_id: bookingId, p_error: error }).then(() => null, () => null)
}

// Événements Google appartenant réellement à cette réservation.
export function bookingOwnEventIds(booking) {
  return [booking.google_event_id, recreatedEventId(booking.id, booking.id)].filter(Boolean)
}

/**
 * Remet l'événement Google d'une réservation confirmée portant le repère.
 * outcome : resynced | conflict | overdue | failed | manual_review | not_needed | busy | error
 */
export async function resyncBookingEvent({ supabase, bookingId, now = new Date(), fetchImpl, timeoutMs, deadlineAt }) {
  const { data: claim, error } = await supabase.rpc('claim_rdv_balance_google_resync', {
    p_booking_id: bookingId,
    p_now: now.toISOString(),
  }).then(r => r, () => ({ error: true }))
  if (error) return { outcome: 'error', reason: 'claim_failed' }
  if (!claim?.ok) {
    if (claim?.error === 'not_needed') return { outcome: 'not_needed' }
    if (claim?.error === 'manual_review') return { outcome: 'manual_review' }
    if (claim?.error === 'appointment_started') {
      const context = await loadRestorationContext(supabase, bookingId)
      return { outcome: 'overdue', reason: 'appointment_started', first: !!claim.first, context }
    }
    if (claim?.error === 'cancel_in_progress' || claim?.error === 'resync_in_progress') return { outcome: 'busy', reason: claim.error }
    return { outcome: 'error', reason: claim?.error || 'claim_failed' }
  }

  const context = await loadRestorationContext(supabase, bookingId)
  if (!context) {
    await recordFailure(supabase, bookingId, 'booking_not_found')
    return { outcome: 'error', reason: 'booking_not_found' }
  }
  const imminent = new Date(context.booking.starts_at).getTime() - now.getTime() < IMMINENT_MS
  // Jamais synchronisée avec Google : rien à remettre.
  if (!context.booking.google_event_id) {
    await supabase.rpc('complete_rdv_balance_google_resync', { p_booking_id: bookingId, p_google_status: 'not_synced', p_google_event_id: null })
      .then(() => null, () => null)
    return { outcome: 'resynced', google_status: 'not_synced', context }
  }

  // Le créneau a pu être pris pendant que l'événement était absent.
  const free = await googleSlotIsFree({
    supabase,
    booking: context.booking,
    practitioner: context.practitioner,
    ownEventIds: bookingOwnEventIds(context.booking),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(deadlineAt ? { deadlineAt } : {}),
  })
  if (!free.ok) {
    if (free.error === 'google_slot_busy') {
      await recordFailure(supabase, bookingId, 'google_slot_conflict', true)
      return { outcome: 'conflict', reason: 'google_slot_conflict', imminent, context }
    }
    // Google injoignable, liste tronquée ou échéance du cron : aucune écriture, nouvel essai plus tard.
    const reason = free.error === 'google_calendar_unavailable' ? 'google_unavailable' : free.error
    await recordFailure(supabase, bookingId, reason)
    return { outcome: 'failed', reason, imminent, context }
  }

  const { paidCents } = context
  const google = await restoreBalanceBookingEvent({
    supabase,
    booking: context.booking,
    service: context.service,
    paidCents,
    dueCents: Math.max(Number(context.booking.booked_price_cents || 0) - paidCents, 0),
    operationId: bookingId,
    fetchImpl,
    timeoutMs,
    deadlineAt,
  }).catch(() => ({ status: 'uncertain', reason: 'exception' }))

  if (google.status === 'restored' || google.status === 'created') {
    const { data: done } = await supabase.rpc('complete_rdv_balance_google_resync', {
      p_booking_id: bookingId,
      p_google_status: google.status,
      p_google_event_id: google.google_event_id && google.google_event_id !== context.booking.google_event_id ? google.google_event_id : null,
    }).then(r => r, () => ({ data: null }))
    if (done?.ok) return { outcome: 'resynced', google_status: google.status, context }
    if (done?.error === 'superseded') return { outcome: 'busy', reason: 'superseded', context }
    await recordFailure(supabase, bookingId, 'completion_failed')
    return { outcome: 'failed', reason: 'completion_failed', imminent, context }
  }
  const reason = google.status === 'not_connected' ? 'google_disconnected' : `google_${google.reason || google.status}`
  await recordFailure(supabase, bookingId, reason)
  return { outcome: 'failed', reason, google_status: google.status, imminent, context }
}

// Alerte propriétaire selon l'issue (null : rien à signaler).
function alertFor(result) {
  if (result.outcome === 'overdue') return { kind: 'google_overdue', reason: 'google_resync_started' }
  if (result.outcome === 'conflict') return { kind: 'google_conflict', reason: result.imminent ? 'google_resync_conflict_imminent' : 'google_resync_conflict' }
  if (result.outcome === 'failed') return { kind: 'google_sync', reason: result.imminent ? 'google_resync_failed_imminent' : 'google_resync_failed' }
  return null
}

/**
 * Cron : réservations confirmées dont l'événement Google reste à remettre,
 * par petit lot, sous échéance STRICTE (aucun appel Google après `deadline`,
 * attente globale coupée à `deadline`). Les incidents déjà en examen manuel ne
 * sont plus touchés dans Google ; leur alerte est seulement assurée (une fois).
 */
export async function reconcileGoogleResyncs({
  supabase, now = new Date(), limit = CRON_RESYNC_LIMIT, fetchImpl, sendAlert = sendOwnerBalanceAlert,
  deadline = Infinity, clock = Date.now, timeoutMs = CRON_GOOGLE_TIMEOUT_MS,
}) {
  const summary = { examined: 0, deferred: 0, outcomes: {}, alerts: {} }
  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, starts_at, balance_google_resync_review_at, balance_google_resync_error')
    .eq('status', 'confirmed')
    .not('balance_google_resync_at', 'is', null)
    .gt('starts_at', new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit)
  if (error) return { ...summary, error: 'resync_lookup_failed' }

  const deadlineAt = Number.isFinite(deadline) ? deadline : null
  const notify = async (alert, context) => {
    const { booking, service, paidCents } = context
    const sent = await withinDeadline(deadline + ALERT_GRACE_MS, clock, () => sendAlert({
      supabase,
      item: { booking, service, dueCents: Math.max(Number(booking.booked_price_cents || 0) - paidCents, 0) },
      kind: alert.kind,
      reason: alert.reason,
      now,
    }))
    const status = sent.status || sent.outcome || 'failed'
    summary.alerts[status] = (summary.alerts[status] || 0) + 1
  }
  for (const row of rows || []) {
    if (row.balance_google_resync_review_at) {
      // Examen manuel : jamais d'écriture Google automatique. L'alerte est
      // assurée (déjà envoyée → rien ; échec certain → nouvel essai horaire).
      summary.outcomes.manual_review = (summary.outcomes.manual_review || 0) + 1
      const context = await loadRestorationContext(supabase, row.id)
      if (context) {
        await notify(row.balance_google_resync_error === 'appointment_started'
          ? { kind: 'google_overdue', reason: 'google_resync_started' }
          : { kind: 'google_conflict', reason: 'google_resync_conflict' }, context)
      }
      continue
    }
    if (clock() >= deadline) { summary.deferred += 1; continue }
    const result = await withinDeadline(deadline, clock, () => resyncBookingEvent({ supabase, bookingId: row.id, now, fetchImpl, timeoutMs, deadlineAt }))
    if (result.outcome === 'deferred_budget') { summary.deferred += 1; continue }
    summary.examined += 1
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1
    const alert = alertFor(result)
    if (alert && result.context) await notify(alert, result.context)
  }
  return summary
}
