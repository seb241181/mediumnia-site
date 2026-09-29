// Rendez-vous d'urgence : le praticien propose un créneau précis à une
// personne par un lien personnel. La personne réserve ce créneau et règle
// l'acompte (ou la séance) comme sur la page publique.
//
// - Le lien porte un jeton aléatoire ; seule son empreinte SHA-256 est en base.
// - Le créneau proposé peut être hors des disponibilités, un jour de fermeture
//   ou plus tôt que le délai minimum : c'est le praticien qui l'a choisi.
// - Google Agenda reste vérifié : seuls les événements dont le titre contient
//   « urgence » (créneaux que le praticien réserve aux urgences) sont ignorés ;
//   tout autre événement bloque la réservation.
// - Le chevauchement avec un autre rendez-vous reste refusé par la base.

import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import { decrypt, encrypt, parisUTCOffsetMs, refreshGoogleToken } from './googleOAuth.js'

export const OFFER_VALIDITY_HOURS = [2, 6, 24, 48, 72]
const TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const URGENCE_RE = /urgence/i

export function hashOfferToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function newOfferToken() {
  return randomBytes(24).toString('base64url')
}

// Même conversion que le paiement des arrhes (offsetMs = UTC − heure de Paris).
function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const midnight = new Date(`${dateStr}T00:00:00Z`).getTime() + offsetMs
  return new Date(midnight + hours * 3_600_000 + minutes * 60_000)
}

function parisParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export function slotOfferUrl(practitionerSlug, token, env = process.env) {
  let base = env.BOOKING_PUBLIC_URL?.trim().replace(/\/$/, '')
  if (env.VERCEL_ENV === 'preview') {
    const previewHost = env.VERCEL_BRANCH_URL || env.VERCEL_URL
    if (previewHost) base = `https://${previewHost}`
  }
  if (!base) base = 'https://mediumia.fr'
  // Le fragment n'est envoyé ni au serveur ni dans le Referer.
  return `${base}/rdv/${encodeURIComponent(practitionerSlug)}#offre=${encodeURIComponent(token)}`
}

// ── Espace praticien ──────────────────────────────────────────────────────

async function ownsPractitioner(db, userId, practitionerId) {
  const { data } = await db
    .from('booking_practitioners')
    .select('id, slug')
    .eq('id', practitionerId)
    .eq('owner_id', userId)
    .maybeSingle()
  return data || null
}

export async function createSlotOffer({ db, userId, input, now = new Date(), env = process.env }) {
  const practitionerId = String(input?.practitioner_id || '')
  const serviceId = String(input?.service_id || '')
  const date = String(input?.date || '')
  const time = String(input?.time || '')
  const validityHours = Number(input?.validity_hours || 24)
  const firstName = typeof input?.customer_first_name === 'string' ? input.customer_first_name.trim().slice(0, 80) : ''
  if (!practitionerId || !serviceId || !DATE_RE.test(date) || !TIME_RE.test(time)) return { status: 400, body: { error: 'invalid_offer' } }
  if (!OFFER_VALIDITY_HOURS.includes(validityHours)) return { status: 400, body: { error: 'invalid_validity' } }

  const practitioner = await ownsPractitioner(db, userId, practitionerId)
  if (!practitioner) return { status: 403, body: { error: 'forbidden' } }

  const { data: service } = await db
    .from('booking_services')
    .select('id, title, duration_min, booking_mode, reservation_payment_kind, reservation_payment_cents, is_active')
    .eq('id', serviceId)
    .eq('practitioner_id', practitionerId)
    .maybeSingle()
  if (!service?.is_active || service.booking_mode !== 'instant') return { status: 400, body: { error: 'service_not_bookable' } }
  if (service.reservation_payment_kind !== 'arrhes' || !(Number(service.reservation_payment_cents) > 0)) {
    return { status: 400, body: { error: 'service_without_deposit' } }
  }

  const startsAt = parisTimeToUTC(date, time, parisUTCOffsetMs(date))
  if (startsAt.getTime() <= now.getTime() + 15 * 60_000) return { status: 400, body: { error: 'slot_in_past' } }
  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000)
  // Le lien expire à la fin de sa validité, et au plus tard au début du créneau.
  const expiresAt = new Date(Math.min(now.getTime() + validityHours * 3_600_000, startsAt.getTime()))

  const token = newOfferToken()
  const { data: offer, error } = await db
    .from('booking_slot_offers')
    .insert({
      practitioner_id: practitionerId,
      service_id: serviceId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      token_hash: hashOfferToken(token),
      customer_first_name: firstName || null,
      expires_at: expiresAt.toISOString(),
      created_by: userId,
    })
    .select('id, starts_at, ends_at, expires_at, customer_first_name, status')
    .single()
  if (error || !offer) return { status: 500, body: { error: 'offer_create_failed' } }

  return { status: 201, body: { offer: { ...offer, service_title: service.title }, url: slotOfferUrl(practitioner.slug, token, env) } }
}

export async function listSlotOffers({ db, userId, practitionerId, now = new Date() }) {
  if (!(await ownsPractitioner(db, userId, practitionerId))) return { status: 403, body: { error: 'forbidden' } }
  const { data, error } = await db
    .from('booking_slot_offers')
    .select('id, service_id, starts_at, ends_at, expires_at, status, customer_first_name, used_booking_id, created_at')
    .eq('practitioner_id', practitionerId)
    .gte('starts_at', new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .order('starts_at', { ascending: true })
    .limit(50)
  if (error) return { status: 500, body: { error: 'offers_unavailable' } }
  const offers = (data || []).map((o) => ({ ...o, status: o.status === 'open' && new Date(o.expires_at) <= now ? 'expired' : o.status }))
  return { status: 200, body: { offers } }
}

export async function cancelSlotOffer({ db, userId, input }) {
  const offerId = String(input?.id || '')
  const practitionerId = String(input?.practitioner_id || '')
  if (!offerId || !(await ownsPractitioner(db, userId, practitionerId))) return { status: 403, body: { error: 'forbidden' } }
  const { data, error } = await db
    .from('booking_slot_offers')
    .update({ status: 'cancelled' })
    .eq('id', offerId)
    .eq('practitioner_id', practitionerId)
    .eq('status', 'open')
    .select('id')
  if (error) return { status: 500, body: { error: 'offer_cancel_failed' } }
  if (!data?.length) return { status: 409, body: { error: 'offer_not_open' } }
  return { status: 200, body: { ok: true } }
}

// ── Page publique ─────────────────────────────────────────────────────────

export async function loadOpenOffer(db, token, now = new Date()) {
  if (!TOKEN_RE.test(String(token || ''))) return { error: 'offer_invalid' }
  const { data: offer } = await db
    .from('booking_slot_offers')
    .select('id, practitioner_id, service_id, starts_at, ends_at, expires_at, status, customer_first_name')
    .eq('token_hash', hashOfferToken(token))
    .maybeSingle()
  if (!offer) return { error: 'offer_invalid' }
  if (offer.status === 'used') return { error: 'offer_used' }
  if (offer.status !== 'open') return { error: 'offer_cancelled' }
  if (new Date(offer.expires_at) <= now || new Date(offer.starts_at) <= now) return { error: 'offer_expired' }
  return { offer }
}

export async function getPublicSlotOffer({ db, token, practitionerSlug, now = new Date() }) {
  const found = await loadOpenOffer(db, token, now)
  if (found.error) return { status: found.error === 'offer_invalid' ? 404 : 410, body: { error: found.error } }
  const { offer } = found
  const [{ data: practitioner }, { data: service }] = await Promise.all([
    db.from('booking_practitioners').select('id, slug').eq('id', offer.practitioner_id).maybeSingle(),
    db.from('booking_services').select('slug').eq('id', offer.service_id).maybeSingle(),
  ])
  if (!practitioner || practitioner.slug !== practitionerSlug || !service) return { status: 404, body: { error: 'offer_invalid' } }
  const local = parisParts(new Date(offer.starts_at))
  return {
    status: 200,
    body: {
      service_slug: service.slug,
      date: local.date,
      time: local.time,
      starts_at: offer.starts_at,
      expires_at: offer.expires_at,
      first_name: offer.customer_first_name || null,
    },
  }
}

// ── Validation au moment du paiement ─────────────────────────────────────

async function googleAccessToken(supabase, practitionerId) {
  const { data: connection } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitionerId)
    .eq('is_active', true)
    .single()
  if (!connection?.google_calendar_id || connection.google_calendar_id === 'primary') throw new Error('google_calendar_unavailable')
  try {
    if (Date.now() > new Date(connection.token_expiry).getTime() - 60_000) {
      const refreshed = await refreshGoogleToken(connection.refresh_token_enc)
      await supabase.from('booking_calendar_connections').update({
        access_token_enc: encrypt(refreshed.access_token),
        token_expiry: refreshed.expires_at,
        updated_at: new Date().toISOString(),
      }).eq('practitioner_id', practitionerId)
      return { accessToken: refreshed.access_token, calendarId: connection.google_calendar_id }
    }
    return { accessToken: decrypt(connection.access_token_enc), calendarId: connection.google_calendar_id }
  } catch {
    throw new Error('google_calendar_unavailable')
  }
}

// Un événement bloque le créneau sauf s'il est marqué « Urgence » (ou libre /
// annulé dans Google).
export function blockingEvents(events) {
  return (events || []).filter((event) => event?.status !== 'cancelled'
    && event?.transparency !== 'transparent'
    && !URGENCE_RE.test(String(event?.summary || '')))
}

export async function validateOfferSlot({ supabase, practitioner, service, date, time, token, fetchImpl = fetch }) {
  if (!practitioner.is_active) throw new Error('booking_unavailable')
  const found = await loadOpenOffer(supabase, token)
  if (found.error) throw new Error(found.error)
  const { offer } = found
  const offsetMs = parisUTCOffsetMs(date)
  const startsAt = parisTimeToUTC(date, time, offsetMs)
  const endsAt = new Date(startsAt.getTime() + service.duration_min * 60_000)
  if (offer.practitioner_id !== practitioner.id || offer.service_id !== service.id
    || new Date(offer.starts_at).getTime() !== startsAt.getTime()) throw new Error('offer_invalid')

  const { accessToken, calendarId } = await googleAccessToken(supabase, practitioner.id)
  const beforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
  const afterMs = (practitioner.buffer_after_min ?? 0) * 60_000
  let body
  try {
    const params = new URLSearchParams({
      timeMin: new Date(startsAt.getTime() - beforeMs).toISOString(),
      timeMax: new Date(endsAt.getTime() + afterMs).toISOString(),
      singleEvents: 'true',
      maxResults: '50',
      fields: 'items(status,transparency,summary)',
    })
    const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error('events_failed')
    body = await response.json()
  } catch {
    throw new Error('google_calendar_unavailable')
  }
  if (blockingEvents(body?.items).length > 0) throw new Error('slot_unavailable')
  return { startsAt, endsAt, offerId: offer.id }
}

// Après la conversion en rendez-vous : le lien ne sert plus.
export async function markOfferUsed(supabase, booking) {
  if (!booking?.id || !booking.practitioner_id || !booking.starts_at) return
  await supabase
    .from('booking_slot_offers')
    .update({ status: 'used', used_booking_id: booking.id })
    .eq('practitioner_id', booking.practitioner_id)
    .eq('service_id', booking.service_id)
    .eq('starts_at', new Date(booking.starts_at).toISOString())
    .eq('status', 'open')
}
