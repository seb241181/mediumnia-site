/**
 * Rendez-vous « manual » issus d'une demande d'agent (Lumia…) confirmée dans
 * l'espace RDV. Ils doivent recevoir le rappel général J-3 et le SMS J-1 comme
 * un rendez-vous MediumIA — mais PAS les autres bookings « manual » (saisies,
 * Reservio…), ni le circuit du solde (réservé au paiement en ligne MediumIA).
 *
 * Un booking est « Lumia » s'il est le confirmed_booking_id d'une
 * booking_requests dont intake_agent n'est pas nul.
 */

// bookingId → { requested_modality, video_channel } de la demande d'origine.
// En cas d'erreur (ex. migration Lumia pas encore appliquée) : aucun lien, donc
// aucun booking « manual » ajouté — comportement d'avant.
export async function lumiaLinkedRequests(supabase, bookingIds = []) {
  const ids = [...new Set(bookingIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase
    .from('booking_requests')
    .select('confirmed_booking_id, requested_modality, video_channel')
    .in('confirmed_booking_id', ids)
    .not('intake_agent', 'is', null)
  if (error || !Array.isArray(data)) return new Map()
  return new Map(data.filter((r) => r.confirmed_booking_id).map((r) => [r.confirmed_booking_id, {
    requested_modality: r.requested_modality || null,
    video_channel: r.video_channel || null,
  }]))
}

// Rendez-vous à rappeler : MediumIA, plus les « manual » reliés à une demande Lumia.
export async function reminderEligibleBookings(supabase, bookings = []) {
  const manualIds = bookings.filter((b) => b.booking_source === 'manual').map((b) => b.id)
  const lumia = await lumiaLinkedRequests(supabase, manualIds)
  const eligible = bookings.filter((b) => (b.booking_source || 'mediumia') === 'mediumia'
    || (b.booking_source === 'manual' && lumia.has(b.id)))
  return { eligible, lumia }
}
