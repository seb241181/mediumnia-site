/**
 * Soldes des visios — remise de l'événement Google après une annulation
 * automatique interrompue (issue #147, seconde revue PR #148).
 *
 * claim_rdv_balance_auto_cancel pose un repère durable (balance_google_resync_at)
 * AVANT la suppression Google ; seule la finalisation de l'annulation l'efface.
 * Si le traitement s'arrête entre les deux (réponse Google perdue, finalisation
 * refusée, processus coupé), la réservation reste confirmée et son événement
 * est remis :
 *   - réactivation de SON identifiant (PATCH, idempotent) ;
 *   - sinon recréation à identifiant fixe dérivé de la réservation (409 →
 *     réactivation du même) : jamais de doublon, jamais un autre événement
 *     (rendez-vous saisi à la main) modifié.
 * Google déconnecté, refus ou réponse incertaine : le repère reste, l'essai
 * est journalisé et le propriétaire alerté ; le cron suivant réessaie.
 */
import { restoreBalanceBookingEvent } from './rdvBalanceGoogle.js'
import { loadRestorationContext, CRON_GOOGLE_TIMEOUT_MS } from './rdvBalanceRestoreResume.js'
import { sendOwnerBalanceAlert } from './rdvBalanceOwnerAlerts.js'

export const CRON_RESYNC_LIMIT = 5

async function recordFailure(supabase, bookingId, error) {
  await supabase.rpc('record_rdv_balance_google_resync_failure', { p_booking_id: bookingId, p_error: error })
    .then(() => null, () => null)
}

/**
 * Remet l'événement Google d'une réservation confirmée portant le repère.
 * outcome : resynced | not_needed | busy | failed | error
 */
export async function resyncBookingEvent({ supabase, bookingId, now = new Date(), fetchImpl, timeoutMs }) {
  const { data: claim, error } = await supabase.rpc('claim_rdv_balance_google_resync', {
    p_booking_id: bookingId,
    p_now: now.toISOString(),
  }).then(r => r, () => ({ error: true }))
  if (error) return { outcome: 'error', reason: 'claim_failed' }
  if (!claim?.ok) {
    if (claim?.error === 'not_needed') return { outcome: 'not_needed' }
    if (claim?.error === 'cancel_in_progress' || claim?.error === 'resync_in_progress') return { outcome: 'busy', reason: claim.error }
    return { outcome: 'error', reason: claim?.error || 'claim_failed' }
  }

  const context = await loadRestorationContext(supabase, bookingId)
  if (!context) {
    await recordFailure(supabase, bookingId, 'booking_not_found')
    return { outcome: 'error', reason: 'booking_not_found' }
  }
  // Jamais synchronisée avec Google : rien à remettre.
  if (!context.booking.google_event_id) {
    await supabase.rpc('complete_rdv_balance_google_resync', { p_booking_id: bookingId, p_google_status: 'not_synced', p_google_event_id: null })
      .then(() => null, () => null)
    return { outcome: 'resynced', google_status: 'not_synced', context }
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
    return { outcome: 'failed', reason: 'completion_failed', context }
  }
  const reason = google.status === 'not_connected' ? 'google_disconnected' : `google_${google.reason || google.status}`
  await recordFailure(supabase, bookingId, reason)
  return { outcome: 'failed', reason, google_status: google.status, context }
}

/**
 * Cron : réservations confirmées dont l'événement Google reste à remettre,
 * par petit lot et sans dépasser l'échéance `deadline`.
 */
export async function reconcileGoogleResyncs({
  supabase, now = new Date(), limit = CRON_RESYNC_LIMIT, fetchImpl, sendAlert = sendOwnerBalanceAlert,
  deadline = Infinity, clock = Date.now, timeoutMs = CRON_GOOGLE_TIMEOUT_MS,
}) {
  const summary = { examined: 0, deferred: 0, outcomes: {}, alerts: {} }
  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('status', 'confirmed')
    .not('balance_google_resync_at', 'is', null)
    .gt('starts_at', now.toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit)
  if (error) return { ...summary, error: 'resync_lookup_failed' }

  for (const row of rows || []) {
    if (clock() >= deadline) { summary.deferred += 1; continue }
    summary.examined += 1
    const result = await resyncBookingEvent({ supabase, bookingId: row.id, now, fetchImpl, timeoutMs })
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1
    if (result.outcome !== 'failed' || !result.context) continue
    const { booking, service, paidCents } = result.context
    const alert = await sendAlert({
      supabase,
      item: { booking, service, dueCents: Math.max(Number(booking.booked_price_cents || 0) - paidCents, 0) },
      kind: 'google_sync',
      reason: 'google_resync_failed',
      now,
    }).catch(() => ({ status: 'failed' }))
    summary.alerts[alert.status] = (summary.alerts[alert.status] || 0) + 1
  }
  return summary
}
