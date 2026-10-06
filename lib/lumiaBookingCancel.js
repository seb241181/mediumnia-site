import { createHash, randomUUID } from 'node:crypto'

export const LUMIA_BOOKING_CANCEL_ACTION = 'mediumia.booking.cancel'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return UUID_RE.test(String(value || ''))
}

// A preview is derived only from a server-resolved booking.  The browser and
// the model never get to choose its owner, practitioner or snapshot fields.
export function buildBookingCancelPreview(booking) {
  if (!booking?.id || !booking?.updated_at || booking.status !== 'confirmed' || booking.booking_source !== 'mediumia') return null
  return {
    action_type: LUMIA_BOOKING_CANCEL_ACTION,
    source: 'MediumIA',
    booking_id: booking.id,
    client: [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ').slice(0, 160),
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
    prestation: booking.service?.title || null,
    modalite: Array.isArray(booking.service?.modality) ? booking.service.modality : null,
    effects: {
      booking: 'cancelled',
      google_projection: booking.google_event_id ? 'cancel_projection_pending' : 'not_applicable',
      external_calls: false,
      emails: false,
      messages: false,
      refunds: false,
      transfers: false,
    },
  }
}

export function buildBookingCancelPayload(booking) {
  if (!booking?.id || !booking?.practitioner_id || !booking?.updated_at) return null
  return {
    action_type: LUMIA_BOOKING_CANCEL_ACTION,
    target: { source: 'mediumia_booking', id: booking.id },
    practitioner_id: booking.practitioner_id,
    expected_target_updated_at: booking.updated_at,
    google_projection_exists: Boolean(booking.google_event_id),
  }
}

export function bookingCancelPayloadHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function newBookingCancelIdempotencyKey() {
  return `lumia.booking.cancel:${randomUUID()}`
}

export function resolveBookingCancelCandidates(bookings, { bookingId = null } = {}) {
  const confirmed = (bookings || []).filter((booking) => booking?.status === 'confirmed')
  if (bookingId) {
    const booking = confirmed.find((item) => item.id === bookingId)
    return booking ? { status: 'resolved', booking } : { status: 'not_found', booking: null }
  }
  if (confirmed.length === 1) return { status: 'resolved', booking: confirmed[0] }
  return { status: confirmed.length ? 'ambiguous' : 'not_found', booking: null, candidates: confirmed }
}
