/**
 * lib/googleCalendarEvents.js
 *
 * Crée ou synchronise un événement Google Calendar pour un booking MediumIA.
 *
 * Idempotent :
 *   - si booking.google_event_id est déjà renseigné → retourne already_synced
 *   - utilise un event ID déterministe (UUID sans tirets) pour éviter les
 *     doublons en cas de retry réseau
 *
 * Ne lance jamais d'exception. Ne logue jamais de tokens.
 */

import { decrypt, encrypt, refreshGoogleToken } from './googleOAuth.js'

/**
 * Convertit un UUID de booking en Google Calendar event ID valide.
 * Google event ID : 5-1024 chars, [0-9a-v].
 * UUID hex (0-9, a-f) ⊂ [0-9a-v] → suppression des tirets suffit.
 */
function toGoogleEventId(bookingId) {
  return bookingId.replace(/-/g, '') // 32 chars [0-9a-f]
}

function extractGoogleMeetLink(eventData) {
  if (typeof eventData?.hangoutLink === 'string' && eventData.hangoutLink) {
    return eventData.hangoutLink
  }
  const entryPoints = eventData?.conferenceData?.entryPoints
  if (!Array.isArray(entryPoints)) return null
  return entryPoints.find(entry => entry?.entryPointType === 'video' && entry?.uri)?.uri || null
}

async function getActiveCalendarAccess(supabase, practitionerId) {
  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitionerId)
    .eq('is_active', true)
    .single()

  if (!conn) return { status: 'not_connected' }
  if (!conn.google_calendar_id || conn.google_calendar_id === 'primary') {
    return { status: 'failed', reason: 'missing_calendar_id' }
  }

  try {
    let accessToken
    if (Date.now() > new Date(conn.token_expiry).getTime() - 60_000) {
      const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
      accessToken = refreshed.access_token
      await supabase.from('booking_calendar_connections').update({
        access_token_enc: encrypt(accessToken),
        token_expiry:     refreshed.expires_at,
        updated_at:       new Date().toISOString(),
      }).eq('practitioner_id', practitionerId)
    } else {
      accessToken = decrypt(conn.access_token_enc)
    }
    return { status: 'ready', accessToken, calendarId: conn.google_calendar_id }
  } catch {
    console.error(`[googleCalendarEvents] Erreur token pour praticien ${practitionerId}`)
    return { status: 'failed', reason: 'token_error' }
  }
}

async function fetchGoogleEvent({ accessToken, calendarId, googleEventId }) {
  const getRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}?conferenceDataVersion=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!getRes.ok) return null
  return getRes.json()
}

async function resolveMeetLink({ accessToken, calendarId, googleEventId, initialEvent }) {
  let current = initialEvent
  let meetLink = extractGoogleMeetLink(current)
  if (meetLink) return { eventData: current, meetLink }

  const conferenceStatus = current?.conferenceData?.createRequest?.status?.statusCode
  if (conferenceStatus === 'failure') return { eventData: current, meetLink: null }

  // Google peut répondre avant que la conférence Meet soit totalement générée.
  // Quelques lectures courtes suffisent généralement, sans bloquer longtemps la réservation.
  for (const delayMs of [200, 400, 800]) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
    const refreshed = await fetchGoogleEvent({ accessToken, calendarId, googleEventId })
    if (!refreshed) continue
    current = refreshed
    meetLink = extractGoogleMeetLink(current)
    if (meetLink) break
    if (current?.conferenceData?.createRequest?.status?.statusCode === 'failure') break
  }

  return { eventData: current, meetLink }
}

/**
 * @param {object}      opts
 * @param {object}      opts.supabase              Client Supabase admin
 * @param {string}      opts.practitionerId         UUID du praticien
 * @param {string}      opts.bookingId              UUID du booking
 * @param {string|null} opts.currentGoogleEventId   bookings.google_event_id actuel
 * @param {boolean}     [opts.createConference]     Crée un Google Meet pour une réservation vidéo
 * @param {object}      opts.event
 * @param {string}      opts.event.title            Résumé de l'événement
 * @param {string}      opts.event.startsAt         ISO 8601
 * @param {string}      opts.event.endsAt           ISO 8601
 * @param {string}      [opts.event.timezone]       IANA (défaut: Europe/Paris)
 * @param {string}      [opts.event.location]       Adresse si présentiel
 * @param {string}      opts.event.description      Corps de l'événement
 *
 * @returns {Promise<{
 *   status: 'synced'|'already_synced'|'not_connected'|'failed',
 *   google_event_id: string|null,
 *   google_meet_link?: string|null
 * }>}
 */
export async function syncBookingToGoogleCalendar({
  supabase,
  practitionerId,
  bookingId,
  currentGoogleEventId,
  createConference = false,
  event,
}) {
  // 1. Idempotence : déjà synchronisé
  if (currentGoogleEventId) {
    return { status: 'already_synced', google_event_id: currentGoogleEventId }
  }

  // 2. Connexion Google active, avec calendrier explicitement configuré.
  const calendar = await getActiveCalendarAccess(supabase, practitionerId)
  if (calendar.status === 'not_connected') {
    return { status: 'not_connected', google_event_id: null, google_meet_link: null }
  }
  if (calendar.status !== 'ready') {
    return { status: 'failed', google_event_id: null, google_meet_link: null, reason: calendar.reason }
  }

  const googleEventId = toGoogleEventId(bookingId)
  const { accessToken, calendarId } = calendar
  const tz = event.timezone || 'Europe/Paris'

  const eventBody = {
    id:          googleEventId,
    summary:     event.title,
    start:       { dateTime: event.startsAt, timeZone: tz },
    end:         { dateTime: event.endsAt,   timeZone: tz },
    description: event.description,
  }
  if (event.location) eventBody.location = event.location
  if (createConference) {
    eventBody.conferenceData = {
      createRequest: {
        requestId: `mediumia-${googleEventId}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }

  // 4. Création via Google Calendar API.
  // conferenceDataVersion=1 est indispensable pour que conferenceData.createRequest
  // génère réellement un Google Meet.
  try {
    const query = createConference ? '?conferenceDataVersion=1' : ''
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${query}`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    )

    if (calRes.ok) {
      let calData = await calRes.json()
      let meetLink = extractGoogleMeetLink(calData)
      if (createConference && !meetLink) {
        const resolved = await resolveMeetLink({
          accessToken,
          calendarId,
          googleEventId: calData.id || googleEventId,
          initialEvent: calData,
        })
        calData = resolved.eventData || calData
        meetLink = resolved.meetLink
      }

      await supabase
        .from('bookings')
        .update({
          google_event_id: calData.id || googleEventId,
          google_meet_link: meetLink || null,
        })
        .eq('id', bookingId)
        .eq('practitioner_id', practitionerId)
      return {
        status: 'synced',
        google_event_id: calData.id || googleEventId,
        google_meet_link: meetLink || null,
        reason: createConference && !meetLink ? 'meet_link_pending_or_unavailable' : null,
      }
    }

    // 409 : event ID déjà utilisé → récupérer l'événement existant
    if (calRes.status === 409) {
      const existing = await fetchGoogleEvent({ accessToken, calendarId, googleEventId })
      if (existing) {
        const meetLink = extractGoogleMeetLink(existing)
        await supabase
          .from('bookings')
          .update({
            google_event_id: existing.id,
            google_meet_link: meetLink || null,
          })
          .eq('id', bookingId)
          .eq('practitioner_id', practitionerId)
        return {
          status: 'synced',
          google_event_id: existing.id,
          google_meet_link: meetLink || null,
          reason: createConference && !meetLink ? 'meet_link_missing_on_existing_event' : null,
        }
      }
    }

    // Lire uniquement reason + status — jamais le corps complet ni les tokens
    const errBody = await calRes.json().catch(() => null)
    const reason = errBody?.error?.errors?.[0]?.reason || errBody?.error?.status || 'unknown'
    console.error(`[googleCalendarEvents] Google HTTP ${calRes.status} reason=${reason}`)
    return { status: 'failed', google_event_id: null, google_meet_link: null, reason }
  } catch (err) {
    console.error(`[googleCalendarEvents] Exception réseau pour booking ${bookingId}:`, err?.message)
    return { status: 'failed', google_event_id: null, google_meet_link: null, reason: 'network_error' }
  }
}

/**
 * Supprime l'événement Google lié à un booking avant de libérer le créneau
 * MediumIA. Les réponses 404/410 sont idempotentes : l'événement est déjà absent.
 */
export async function deleteBookingFromGoogleCalendar({
  supabase,
  practitionerId,
  googleEventId,
}) {
  if (!googleEventId) return { status: 'not_synced' }

  const calendar = await getActiveCalendarAccess(supabase, practitionerId)
  if (calendar.status !== 'ready') {
    return { status: calendar.status, reason: calendar.reason || null }
  }

  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${calendar.accessToken}` },
      },
    )

    if (calRes.ok || calRes.status === 404 || calRes.status === 410) {
      return { status: calRes.ok ? 'deleted' : 'already_deleted' }
    }

    const errBody = await calRes.json().catch(() => null)
    const reason = errBody?.error?.errors?.[0]?.reason || errBody?.error?.status || 'unknown'
    console.error(`[googleCalendarEvents] Suppression Google HTTP ${calRes.status} reason=${reason}`)
    return { status: 'failed', reason }
  } catch (err) {
    console.error(`[googleCalendarEvents] Exception suppression Google:`, err?.message)
    return { status: 'failed', reason: 'network_error' }
  }
}
