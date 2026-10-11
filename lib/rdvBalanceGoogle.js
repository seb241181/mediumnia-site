// Événement Google d'une visio avec solde (même texte que la réservation en
// ligne : rdvDepositApiHandler). Sert à la restauration (#147) et au
// rattrapage quand une annulation automatique est interrompue après la
// suppression Google.
import { restoreBookingInGoogleCalendar } from './googleCalendarEvents.js'
import { visioLabel } from './visioChannel.js'

const euros = (cents) => `${(Number(cents || 0) / 100).toFixed(2)} EUR`

export function balanceBookingGoogleEvent({ booking, service, paidCents, dueCents }) {
  return {
    title: `${service?.title || 'Visio'} — ${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim(),
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    timezone: booking.timezone || 'Europe/Paris',
    description: [
      'MediumIA Rendez-vous', '',
      `Client : ${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim(),
      `Email : ${booking.customer_email || 'Non renseigné'}`,
      `Téléphone : ${booking.customer_phone || 'Non renseigné'}`,
      `Déjà réglé : ${euros(paidCents)}`,
      `Solde restant : ${euros(dueCents)}`,
      visioLabel('a_preciser'),
      `Identifiant MediumIA : ${booking.id}`,
    ].join('\n'),
  }
}

export async function restoreBalanceBookingEvent({ supabase, booking, service, paidCents, dueCents, fetchImpl }) {
  return restoreBookingInGoogleCalendar({
    supabase,
    practitionerId: booking.practitioner_id,
    googleEventId: booking.google_event_id,
    event: balanceBookingGoogleEvent({ booking, service, paidCents, dueCents }),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
