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
  if (env.VERCEL_ENV === 'preview') {
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

  // Si un événement Google existe, ne pas libérer le créneau si la suppression
  // Google n'est pas confirmée. 404/410 sont acceptés comme "déjà absent".
  const google = await deleteGoogle({
    supabase: db, practitionerId, googleEventId: booking.google_event_id,
  })
  if (booking.google_event_id && !['deleted', 'already_deleted'].includes(google.status)) {
    return { status: 503, body: { error: 'google_delete_unconfirmed', google_status: google.status } }
  }

  const cancelledAt = now().toISOString()
  const { data: cancelled, error: cancelError } = await db.from('bookings')
    .update({
      status: 'cancelled', cancelled_at: cancelledAt,
      cancel_reason: 'practitioner_manual', updated_at: cancelledAt,
    })
    .eq('id', booking.id).eq('practitioner_id', practitionerId)
    .eq('status', 'confirmed').select('id').maybeSingle()
  if (cancelError) return { status: 503, body: { error: 'booking_update_unconfirmed' } }
  if (!cancelled) {
    const { data: current } = await db.from('bookings')
      .select('status').eq('id', booking.id).eq('practitioner_id', practitionerId).maybeSingle()
    if (current?.status === 'cancelled') {
      return { status: 200, body: { ok: true, already_cancelled: true, booking_id: booking.id } }
    }
    return { status: 409, body: { error: 'booking_status_changed' } }
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
    paid_cents: Math.max(0, paidCents),
    financial_review_required: paidCents > 0 || providerCaptured || expectsReservationPayment,
  } }
}
