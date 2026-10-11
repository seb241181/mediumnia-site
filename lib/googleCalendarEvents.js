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
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!getRes.ok) return null
  return getRes.json()
}

/**
 * Visio de Sébastien = WhatsApp ou FaceTime : aucun Google Meet n'est jamais
 * demandé (pas de conferenceData, pas de conferenceDataVersion) et la colonne
 * historique bookings.google_meet_link n'est plus écrite.
 *
 * @param {object}      opts
 * @param {object}      opts.supabase              Client Supabase admin
 * @param {string}      opts.practitionerId         UUID du praticien
 * @param {string}      opts.bookingId              UUID du booking
 * @param {string|null} opts.currentGoogleEventId   bookings.google_event_id actuel
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
 * }>}
 */
export async function syncBookingToGoogleCalendar({
  supabase,
  practitionerId,
  bookingId,
  currentGoogleEventId,
  event,
}) {
  // 1. Idempotence : déjà synchronisé
  if (currentGoogleEventId) {
    return { status: 'already_synced', google_event_id: currentGoogleEventId }
  }

  // 2. Connexion Google active, avec calendrier explicitement configuré.
  const calendar = await getActiveCalendarAccess(supabase, practitionerId)
  if (calendar.status === 'not_connected') {
    return { status: 'not_connected', google_event_id: null }
  }
  if (calendar.status !== 'ready') {
    return { status: 'failed', google_event_id: null, reason: calendar.reason }
  }

  const googleEventId = toGoogleEventId(bookingId)
  const { accessToken, calendarId } = calendar
  const tz = event.timezone || 'Europe/Paris'

  // 3. Événement agenda simple : jamais de visioconférence Google.
  const eventBody = {
    id:          googleEventId,
    summary:     event.title,
    start:       { dateTime: event.startsAt, timeZone: tz },
    end:         { dateTime: event.endsAt,   timeZone: tz },
    description: event.description,
  }
  if (event.location) eventBody.location = event.location

  // 4. Création via Google Calendar API.
  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
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
      const calData = await calRes.json()
      await supabase
        .from('bookings')
        .update({ google_event_id: calData.id || googleEventId })
        .eq('id', bookingId)
        .eq('practitioner_id', practitionerId)
      return { status: 'synced', google_event_id: calData.id || googleEventId }
    }

    // 409 : event ID déjà utilisé → récupérer l'événement existant
    if (calRes.status === 409) {
      const existing = await fetchGoogleEvent({ accessToken, calendarId, googleEventId })
      if (existing) {
        await supabase
          .from('bookings')
          .update({ google_event_id: existing.id })
          .eq('id', bookingId)
          .eq('practitioner_id', practitionerId)
        return { status: 'synced', google_event_id: existing.id }
      }
    }

    // Lire uniquement reason + status — jamais le corps complet ni les tokens
    const errBody = await calRes.json().catch(() => null)
    const reason = errBody?.error?.errors?.[0]?.reason || errBody?.error?.status || 'unknown'
    console.error(`[googleCalendarEvents] Google HTTP ${calRes.status} reason=${reason}`)
    return { status: 'failed', google_event_id: null, reason }
  } catch (err) {
    console.error(`[googleCalendarEvents] Exception réseau pour booking ${bookingId}:`, err?.message)
    return { status: 'failed', google_event_id: null, reason: 'network_error' }
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
  timeoutMs = 8000,
}) {
  if (!googleEventId) return { status: 'not_synced' }

  const calendar = await getActiveCalendarAccess(supabase, practitionerId)
  if (calendar.status !== 'ready') {
    return { status: calendar.status, reason: calendar.reason || null }
  }

  // Délai borné : un Google lent ne doit pas épuiser le temps du cron.
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${calendar.accessToken}` },
        ...(controller ? { signal: controller.signal } : {}),
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
    console.error(`[googleCalendarEvents] Exception suppression Google:`, err?.name || err?.message)
    return { status: 'failed', reason: err?.name === 'AbortError' ? 'timeout' : 'network_error' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Remet dans Google Agenda l'événement d'un rendez-vous rétabli (issue #147),
 * ou après une annulation interrompue. Idempotent et sans doublon :
 *   1. l'ancien événement (supprimé = « cancelled » chez Google) est réactivé
 *      par PATCH, avec les horaires et le texte à jour ;
 *   2. s'il n'existe plus (404/410), il est recréé avec un identifiant FIXE
 *      (recreateEventId) : un nouvel essai après une réponse perdue reçoit 409
 *      et réactive ce même événement au lieu d'en créer un second ;
 *   3. aucune visioconférence Google n'est jamais ajoutée.
 * Statuts : restored | created | not_connected | failed (refus net de Google :
 * rien n'a été appliqué) | uncertain (délai dépassé, coupure, erreur 5xx : la
 * modification a pu être appliquée ; à rejouer, jamais à compenser à l'aveugle).
 * Ne lance jamais d'exception.
 */
export async function restoreBookingInGoogleCalendar({
  supabase,
  practitionerId,
  googleEventId,
  recreateEventId = null,
  event,
  fetchImpl = fetch,
  timeoutMs = 8000,
  deadlineAt = null,
}) {
  const calendar = await getActiveCalendarAccess(supabase, practitionerId)
  if (calendar.status === 'not_connected') return { status: 'not_connected', google_event_id: googleEventId || null }
  if (calendar.status !== 'ready') return { status: 'failed', reason: calendar.reason || 'calendar_unavailable' }

  const tz = event.timezone || 'Europe/Paris'
  const body = {
    summary: event.title,
    start: { dateTime: event.startsAt, timeZone: tz },
    end: { dateTime: event.endsAt, timeZone: tz },
    description: event.description,
  }
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events`
  const headers = { Authorization: `Bearer ${calendar.accessToken}`, 'Content-Type': 'application/json' }
  // Délai par appel, jamais au-delà de l'échéance globale (cron) : aucun appel
  // n'est lancé une fois l'échéance passée.
  const call = async (url, init) => {
    const left = deadlineAt ? deadlineAt - Date.now() : Infinity
    if (left <= 0) throw Object.assign(new Error('budget_exhausted'), { name: 'AbortError', budget: true })
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), Math.min(timeoutMs, left)) : null
    try {
      return await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const verdict = (res, step) => (res.status >= 500 || res.status === 429)
    ? { status: 'uncertain', reason: `${step}_${res.status}` }
    : { status: 'failed', reason: `${step}_${res.status}` }
  const reactivate = async (id) => {
    const res = await call(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ ...body, status: 'confirmed' }) })
    if (res.ok) return { status: 'restored', google_event_id: id }
    if (res.status === 404 || res.status === 410) return { status: 'missing' }
    return verdict(res, 'patch')
  }

  try {
    if (googleEventId) {
      const first = await reactivate(googleEventId)
      if (first.status !== 'missing') return first
    }
    if (!recreateEventId) return { status: 'failed', reason: 'recreate_id_missing' }
    const createRes = await call(base, { method: 'POST', headers, body: JSON.stringify({ id: recreateEventId, ...body }) })
    if (createRes.ok) return { status: 'created', google_event_id: recreateEventId }
    if (createRes.status === 409) {
      // Déjà créé lors d'un essai précédent (réponse perdue) : on le réactive.
      const again = await reactivate(recreateEventId)
      return again.status === 'missing' ? { status: 'failed', reason: 'recreate_conflict' } : (again.status === 'restored' ? { status: 'created', google_event_id: recreateEventId } : again)
    }
    return verdict(createRes, 'create')
  } catch (err) {
    console.error('[googleCalendarEvents] Rétablissement Google incertain:', err?.name || err?.message)
    return { status: 'uncertain', reason: err?.budget ? 'budget_exhausted' : (err?.name === 'AbortError' ? 'timeout' : 'network_error') }
  }
}
