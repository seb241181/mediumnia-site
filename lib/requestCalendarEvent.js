/**
 * Événement Google Agenda d'une demande confirmée (flux action=requests).
 *
 * Règle métier : la visio de Sébastien se fait par WhatsApp ou FaceTime,
 * JAMAIS par Google Meet. Ce module ne demande donc jamais de visioconférence :
 * les options de synchronisation ne contiennent pas createConference, et la
 * description indique seulement le canal (« Visio — WhatsApp », « Visio —
 * FaceTime » ou « Visio — canal à confirmer »).
 */

export const VIDEO_CHANNELS = ['whatsapp', 'facetime', 'a_preciser']
export const VIDEO_CHANNEL_LABELS = { whatsapp: 'WhatsApp', facetime: 'FaceTime', a_preciser: 'canal à confirmer' }

export function videoChannelLabel(request) {
  if (request?.requested_modality !== 'video') return null
  const channel = VIDEO_CHANNELS.includes(request.video_channel) ? request.video_channel : 'a_preciser'
  return `Visio — ${VIDEO_CHANNEL_LABELS[channel]}`
}

export function requestLocation(request) {
  if (!request?.address_line1) return null
  return [request.address_line1, request.address_line2, `${request.postal_code} ${request.city}`].filter(Boolean).join(', ')
}

// Options complètes pour syncBookingToGoogleCalendar : jamais de Meet.
export function requestCalendarSync({ supabase, practitionerId, booking, request, serviceTitle, finalPrice = null }) {
  const name = `${booking?.customer_first_name} ${booking?.customer_last_name}`
  const visio = videoChannelLabel(request)
  const description = [
    'MediumIA Rendez-vous', '',
    `Client : ${name}`,
    `Téléphone : ${booking?.customer_phone || 'Non renseigné'}`,
    `Email : ${booking?.customer_email}`,
    `Prestation : ${serviceTitle || ''}`,
    ...(visio ? [visio] : []),
    ...(finalPrice != null ? [`Montant : ${(finalPrice / 100).toFixed(2)} € TTC`] : []),
    `Identifiant MediumIA : ${booking?.id}`,
  ].join('\n')
  return {
    supabase,
    practitionerId,
    bookingId: booking?.id,
    currentGoogleEventId: booking?.google_event_id || null,
    event: {
      title: `${serviceTitle || 'Rendez-vous'} — ${name}`,
      startsAt: booking?.starts_at,
      endsAt: booking?.ends_at,
      timezone: booking?.timezone || 'Europe/Paris',
      location: requestLocation(request),
      description,
    },
  }
}
