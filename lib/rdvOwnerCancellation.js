/**
 * Annulation explicite par le propriétaire depuis les Coulisses.
 *
 * Ne supprime jamais la réservation ni les écritures, ne rembourse rien et ne
 * réinitialise aucun solde/arrhe. Toute action financière reste dans la caisse.
 * Les prévisualisations sont en lecture seule pour protéger la base PROD liée.
 */
import { deleteBookingFromGoogleCalendar } from './googleCalendarEvents.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = value => UUID_RE.test(String(value || ''))

export async function cancelOwnedBooking({
  db, userId, input = {}, env = process.env, now = () => new Date(),
  deleteGoogle = deleteBookingFromGoogleCalendar, send = sendEmail,
}) {
  // OFF par défaut, y compris après une fusion accidentelle. Une activation
  // explicite n'est possible qu'après les tests transactionnels et Google.
  if (env.RDV_OWNER_CANCEL_ENABLED !== 'true') {
    return { status: 403, body: { error: 'owner_cancel_not_enabled' } }
  }
  if (env.VERCEL_ENV !== 'production' && env.VERCEL_ENV !== 'test') {
    return { status: 403, body: { error: 'preview_booking_cancel_disabled' } }
  }
  const bookingId = String(input.id || '')
  const practitionerId = String(input.practitioner_id || '')
  if (!isUuid(bookingId) || !isUuid(practitionerId) || input.confirm !== true) {
    return { status: 400, body: { error: 'invalid_cancellation_request' } }
  }

  const ownerCheck = await db.from('booking_practitioners')
    .select('id').eq('id', practitionerId).eq('owner_id', userId).maybeSingle()
  if (ownerCheck.error) return { status: 503, body: { error: 'owner_check_unavailable' } }
  if (!ownerCheck.data) return { status: 403, body: { error: 'forbidden' } }

  const { data: booking, error: bookingError } = await db.from('bookings')
    .select('id, practitioner_id, service_id, customer_first_name, customer_email, starts_at, timezone, status, google_event_id, booking_source, reservation_payment_cents')
    .eq('id', bookingId).eq('practitioner_id', practitionerId).maybeSingle()
  if (bookingError) return { status: 503, body: { error: 'booking_lookup_unavailable' } }
  if (!booking) return { status: 404, body: { error: 'booking_not_found' } }
  if (booking.status === 'cancelled') {
    return { status: 200, body: { ok: true, already_cancelled: true, booking_id: booking.id } }
  }
  if (booking.status !== 'confirmed') return { status: 409, body: { error: 'booking_not_confirmed' } }
  if (!Number.isFinite(Date.parse(booking.starts_at)) || Date.parse(booking.starts_at) <= now().getTime()) {
    return { status: 409, body: { error: 'past_booking_cannot_cancel' } }
  }

  // Aucune requalification silencieuse de carte cadeau ou de règlement :
  // on vérifie les écritures puis on laisse les avoirs/remboursements à l'admin.
  const { data: entries, error: entryError } = await db.from('rdv_financial_entries')
    .select('gross_cents, direction, payment_method').eq('booking_id', booking.id).eq('practitioner_id', practitionerId)
  if (entryError) return { status: 503, body: { error: 'payment_review_unavailable' } }
  if ((entries || []).some(entry => entry.payment_method === 'gift_card')) {
    return { status: 409, body: { error: 'gift_card_requires_manual_review' } }
  }
  const paidCents = (entries || []).reduce((sum, entry) =>
    sum + (entry.direction === 'refund' ? -1 : 1) * Number(entry.gross_cents || 0), 0)

  // Le journal financier n'est pas la seule source : les réservations PayPal
  // possèdent leur propre registre (via les holds), tout comme les soldes
  // PayPal et les consommations de cartes cadeaux. L'absence de preuve dans
  // le journal ne signifie JAMAIS absence de paiement.
  const [giftResult, balanceResult, holdsResult] = await Promise.all([
    db.from('gift_card_redemptions').select('id').eq('booking_id', booking.id).limit(1),
    db.from('rdv_balance_payments').select('id, status, paypal_capture_id').eq('booking_id', booking.id).limit(100),
    db.from('rdv_booking_holds').select('id').eq('converted_booking_id', booking.id)
      .eq('practitioner_id', practitionerId).limit(100),
  ])
  if (giftResult.error || balanceResult.error || holdsResult.error) {
    return { status: 503, body: { error: 'payment_review_unavailable' } }
  }
  if ((giftResult.data || []).length > 0) {
    return { status: 409, body: { error: 'gift_card_requires_manual_review' } }
  }

  const holdIds = (holdsResult.data || []).map(hold => hold.id)
  const depositResult = holdIds.length
    ? await db.from('rdv_paypal_payments').select('status, paypal_capture_id, amount_cents')
      .in('hold_id', holdIds).limit(100)
    : { data: [], error: null }
  if (depositResult.error) return { status: 503, body: { error: 'payment_review_unavailable' } }

  const depositPayments = depositResult.data || []
  const balancePayments = balanceResult.data || []
  // Des captures en cours et des ordres encore ouverts sont traités séparément :
  // le propriétaire ne doit pas annuler pendant une capture incertaine.
  const providerPayments = [...depositPayments, ...balancePayments]
  if (providerPayments.some(payment => payment.status !== 'captured')) {
    return { status: 409, body: { error: 'payment_in_progress_requires_review' } }
  }
  if (providerPayments.some(payment => !payment.paypal_capture_id)) {
    return { status: 409, body: { error: 'payment_reconciliation_required' } }
  }
  const providerCaptured = providerPayments.length > 0
  const expectsReservationPayment = Number(booking.reservation_payment_cents || 0) > 0
  if ((providerCaptured || expectsReservationPayment) && paidCents <= 0) {
    return { status: 409, body: { error: 'payment_reconciliation_required' } }
  }

  // Verrou de réservation atomique en base AVANT toute opération externe.
  // Les triggers SQL sérialisent les paiements sur la même ligne et interdisent
  // toute mutation financière pendant ce claim. Les lectures applicatives plus
  // haut sont informatives, non la source définitive de vérité.
  const { data: claim, error: claimError } = await db.rpc('claim_owner_booking_cancel', {
    p_booking_id: booking.id,
    p_practitioner_id: practitionerId,
    p_actor: userId,
  })
  if (claimError || !claim) return { status: 503, body: { error: 'owner_cancel_claim_unavailable' } }
  if (!claim.ok) {
    return { status: claim.error === 'forbidden' ? 403 : 409,
      body: { error: claim.error || 'owner_cancel_pending_review' } }
  }
  if (claim.already_cancelled) {
    return { status: 200, body: { ok: true, already_cancelled: true, booking_id: booking.id } }
  }
  if (!isUuid(claim.claim_id)) return { status: 503, body: { error: 'owner_cancel_claim_unavailable' } }

  // A partir de ce moment le claim n'est JAMAIS effacé automatiquement :
  // une suppression Google incertaine exige une réconciliation humaine.
  let google
  try {
    google = await deleteGoogle({
      supabase: db, practitionerId, googleEventId: booking.google_event_id,
    })
  } catch {
    return { status: 503, body: {
      error: 'google_delete_unconfirmed',
      google_status: 'unknown',
      manual_review_required: true,
    } }
  }
  const googleConfirmed = !booking.google_event_id
    ? google.status === 'not_synced'
    : ['deleted', 'already_deleted'].includes(google.status)
  if (!googleConfirmed) {
    return { status: 503, body: {
      error: 'google_delete_unconfirmed', google_status: google.status,
      manual_review_required: true,
    } }
  }

  const { data: finish, error: finishError } = await db.rpc('finalize_owner_booking_cancel', {
    p_booking_id: booking.id,
    p_practitioner_id: practitionerId,
    p_actor: userId,
    p_claim_id: claim.claim_id,
    p_google_confirmed: true,
  })
  if (finishError || !finish?.ok) {
    return { status: 503, body: {
      error: finish?.error || 'booking_update_unconfirmed',
      manual_review_required: true,
    } }
  }
  if (finish.already_cancelled) {
    return { status: 200, body: { ok: true, already_cancelled: true, booking_id: booking.id } }
  }

  // Après commit seulement. Échec d'e-mail ne doit jamais faire croire que
  // l'annulation elle-même a échoué ni réessayer une opération financière.
  let emailStatus = 'not_sent'
  if (booking.customer_email) {
    const date = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(booking.starts_at))
    const firstName = booking.customer_first_name || 'Madame, Monsieur'
    try {
      const message = `Bonjour ${firstName},\n\nVotre rendez-vous MediumIA du ${date} a été annulé par le praticien.\n\nSi vous avez effectué un règlement, son traitement est indépendant de cette annulation et vous sera confirmé séparément.\n\nMediumIA`
      const result = await send({
        to: booking.customer_email,
        subject: 'MediumIA — Annulation de votre rendez-vous',
        text: message,
        html: `<p>Bonjour ${escapeHtml(firstName)},</p><p>Votre rendez-vous MediumIA du ${escapeHtml(date)} a été annulé par le praticien.</p><p>Si vous avez effectué un règlement, son traitement est indépendant de cette annulation et vous sera confirmé séparément.</p><p>MediumIA</p>`,
        idempotencyKey: `booking-owner-cancellation/${booking.id}`,
      })
      emailStatus = result.status || 'unknown'
    } catch {
      emailStatus = 'error'
    }
  }
  return { status: 200, body: {
    ok: true, booking_id: booking.id, cancelled: true,
    google_status: google.status, email_status: emailStatus,
    paid_cents: Math.max(0, Number(claim.paid_cents || 0)),
    financial_review_required: Boolean(claim.financial_review_required || providerCaptured || expectsReservationPayment),
  } }
}
