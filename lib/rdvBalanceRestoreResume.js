/**
 * Soldes des visios — étape Google d'un rétablissement, et sa reprise après
 * interruption (issue #147, revue PR #148).
 *
 * Une restauration commence en base (statut google_pending), puis l'événement
 * Google est réactivé ou recréé avec un identifiant fixe. Chaque essai Google
 * se fait sous un verrou de reprise (claim_rdv_balance_restore_resume, 5 min)
 * et chaque essai est journalisé (attempts, last_error).
 *
 *   restored | created | not_connected → complete_rdv_balance_restore
 *   uncertain (délai, coupure, 5xx)     → reste en attente, jamais compensé :
 *                                         Google a pu appliquer la modification ;
 *                                         l'essai suivant est sans doublon.
 *   failed (refus net de Google)        → compensate_rdv_balance_restore
 *                                         (retour à l'état annulé), sauf si un
 *                                         paiement a commencé : examen manuel.
 *
 * Les restaurations restées en attente sont reprises par le cron quotidien ou
 * par le bouton « Reprendre » du tableau de bord ; le propriétaire est alerté
 * si la reprise échoue ou si la restauration est abandonnée.
 */
import { restoreBalanceBookingEvent } from './rdvBalanceGoogle.js'
import { sendOwnerBalanceAlert } from './rdvBalanceOwnerAlerts.js'

const DONE_STATUSES = new Set(['restored', 'created', 'not_connected'])
// Délai avant que le cron ne reprenne une restauration : laisse finir la requête d'origine.
export const RESUME_GRACE_MS = 2 * 60_000
// Au-delà de ce nombre d'essais incertains, le propriétaire est prévenu (une fois).
export const RESUME_ALERT_ATTEMPTS = 3

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
  const [{ data: service }, { data: paid }] = await Promise.all([
    supabase.from('booking_services').select('id, title, modality').eq('id', booking.service_id).maybeSingle(),
    supabase.rpc('rdv_booking_paid_cents', { p_booking_id: booking.id }),
  ])
  return { booking, service, paidCents: Number(paid || 0) }
}

/**
 * Un essai Google pour une restauration en attente. Le verrou de reprise doit
 * déjà être pris par l'appelant. Ne lance jamais d'exception.
 * outcome : completed | pending | compensated | manual_review
 */
export async function attemptRestorationGoogle({ supabase, restorationId, booking, service, paidCents, dueCents, fetchImpl }) {
  const google = await restoreBalanceBookingEvent({
    supabase,
    booking: { ...booking, status: 'confirmed' },
    service,
    paidCents,
    dueCents,
    operationId: restorationId,
    fetchImpl,
  }).catch(() => ({ status: 'uncertain', reason: 'exception' }))

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

/**
 * Reprend une restauration en attente (cron ou bouton « Reprendre »).
 * outcome : completed | pending | compensated | manual_review | busy | not_pending | error
 */
export async function resumeRestoration({ supabase, restorationId, now = new Date(), fetchImpl }) {
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
  const result = await attemptRestorationGoogle({
    supabase,
    restorationId,
    booking: context.booking,
    service: context.service,
    paidCents: context.paidCents,
    dueCents: Number(claim.due_cents),
    fetchImpl,
  })
  return { ...result, attempts: Number(claim.attempts), bookingId: claim.booking_id, context, dueCents: Number(claim.due_cents) }
}

const ALERT_REASON = {
  compensated: 'restore_compensated',
  manual_review: 'restore_manual_review',
}

/**
 * Cron : release des annulations revendiquées puis abandonnées, puis reprise
 * des restaurations en attente depuis plus de RESUME_GRACE_MS.
 */
export async function reconcilePendingRestorations({
  supabase, now = new Date(), limit = 10, fetchImpl, sendAlert = sendOwnerBalanceAlert,
}) {
  const summary = { released_cancel_claims: 0, examined: 0, outcomes: {}, alerts: {} }
  const { data: released } = await supabase.rpc('release_stale_rdv_balance_cancel_claims', { p_now: now.toISOString() })
    .then(r => r, () => ({ data: 0 }))
  summary.released_cancel_claims = Number(released || 0)

  const { data: pending, error } = await supabase
    .from('rdv_balance_restorations')
    .select('id, booking_id, attempts, created_at')
    .eq('status', 'google_pending')
    .lt('created_at', new Date(now.getTime() - RESUME_GRACE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) return { ...summary, error: 'restoration_lookup_failed' }

  for (const row of pending || []) {
    summary.examined += 1
    const result = await resumeRestoration({ supabase, restorationId: row.id, now, fetchImpl })
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1
    const reason = ALERT_REASON[result.outcome]
      || (result.outcome === 'pending' && result.attempts >= RESUME_ALERT_ATTEMPTS ? 'restore_google_retrying' : null)
    if (!reason || !result.context) continue
    const alert = await sendAlert({
      supabase,
      item: { booking: result.context.booking, service: result.context.service, dueCents: result.dueCents },
      kind: 'restore',
      reason,
      now,
    }).catch(() => ({ status: 'failed' }))
    summary.alerts[alert.status] = (summary.alerts[alert.status] || 0) + 1
  }
  return summary
}
