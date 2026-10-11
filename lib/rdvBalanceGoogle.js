// Événement Google d'une visio avec solde (même texte que la réservation en
// ligne : rdvDepositApiHandler). Sert à la restauration (#147) et au
// rattrapage quand une annulation automatique est interrompue après la
// suppression Google.
import { restoreBookingInGoogleCalendar } from './googleCalendarEvents.js'
import { googleAccessToken } from './rdvSlotOffers.js'
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

// Identifiant Google fixe pour un événement recréé : [0-9a-v], dérivé du
// rendez-vous et de l'opération (restauration ou rattrapage), donc rejouable sans doublon.
export function recreatedEventId(bookingId, operationId) {
  return `${String(bookingId).replace(/-/g, '')}r${String(operationId).replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, 32)}`
}

export async function restoreBalanceBookingEvent({ supabase, booking, service, paidCents, dueCents, operationId, fetchImpl, timeoutMs }) {
  return restoreBookingInGoogleCalendar({
    supabase,
    practitionerId: booking.practitioner_id,
    googleEventId: booking.google_event_id,
    recreateEventId: recreatedEventId(booking.id, operationId || booking.id),
    event: balanceBookingGoogleEvent({ booking, service, paidCents, dueCents }),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  })
}

// Pages Google lues au plus (250 événements chacune) ; au-delà, refus : jamais de conclusion sur une liste tronquée.
export const GOOGLE_SLOT_MAX_PAGES = 8

// Le créneau doit être libre AUSSI dans Google Agenda (rendez-vous saisis à la
// main, blocages). Toutes les pages de résultats sont lues (nextPageToken) ;
// sans accès à Google, délai dépassé ou liste tronquée : refus, jamais de
// restauration à l'aveugle. Seuls les événements de CETTE réservation
// (ownEventIds) sont ignorés.
export async function googleSlotIsFree({
  supabase, booking, practitioner, fetchImpl = fetch, maxPages = GOOGLE_SLOT_MAX_PAGES, ownEventIds = [], timeoutMs = 8000,
}) {
  const own = new Set([booking.google_event_id, ...ownEventIds].filter(Boolean))
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
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      let response
      try {
        response = await fetchImpl(`${base}?${params}`, {
          headers: { Authorization: `Bearer ${access.accessToken}` },
          ...(controller ? { signal: controller.signal } : {}),
        })
      } finally {
        if (timer) clearTimeout(timer)
      }
      if (!response.ok) return { ok: false, error: 'google_calendar_unavailable' }
      const body = await response.json()
      if (!body || (body.items != null && !Array.isArray(body.items))) return { ok: false, error: 'google_calendar_unavailable' }
      const busy = (body.items || []).some(event => event?.status !== 'cancelled'
        && event?.transparency !== 'transparent'
        && !own.has(event?.id))
      if (busy) return { ok: false, error: 'google_slot_busy' }
      pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null
      if (!pageToken) return { ok: true, pages: page + 1 }
    }
    return { ok: false, error: 'google_calendar_truncated' }
  } catch {
    return { ok: false, error: 'google_calendar_unavailable' }
  }
}
