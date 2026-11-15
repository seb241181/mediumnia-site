/**
 * TEST-only availability projection executor.
 *
 * It reads only availability inputs and the configured source calendar, then
 * writes private, transparent informational events to the dedicated target.
 * It never writes to the source calendar or to a booking.
 */
import { addDays, computeAvailability, loadAvailabilityData, loadGoogleBusy, parisDayBounds } from './rdvAvailability.js'
import { googleAccessToken } from './rdvSlotOffers.js'
import { AVAILABILITY_SOURCE, availabilityProjection, syncAvailabilityCalendar } from './availabilityCalendarSync.js'

const MAX_GOOGLE_PAGES = 8

function parisDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function projectionDates({ now = new Date(), days = 14 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error('invalid_projection_horizon')
  const from = parisDate(now)
  return Array.from({ length: days }, (_, index) => addDays(from, index))
}

async function listOwnedTargetEvents({ targetCalendarId, accessToken, fetchImpl = fetch }) {
  const events = []
  let pageToken = null
  for (let page = 0; page < MAX_GOOGLE_PAGES; page += 1) {
    const params = new URLSearchParams({
      // Tombstones must be read internally so a reappearing slot does not try
      // to reuse a Google id that was deleted in an earlier reconciliation.
      singleEvents: 'true', showDeleted: 'true', maxResults: '250',
      privateExtendedProperty: `mediumia_source=${AVAILABILITY_SOURCE}`,
      fields: 'items(id,status,summary,colorId,transparency,visibility,extendedProperties),nextPageToken',
    })
    if (pageToken) params.set('pageToken', pageToken)
    let response
    try {
      response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      throw new Error('target_calendar_read_failed')
    }
    if (!response.ok) throw new Error('target_calendar_read_failed')
    const body = await response.json()
    if (!Array.isArray(body?.items)) throw new Error('target_calendar_response_incomplete')
    events.push(...body.items)
    pageToken = body.nextPageToken || null
    if (!pageToken) return events
  }
  throw new Error('target_calendar_too_many_events')
}

export async function executeAvailabilityCalendarSync({ db, config, now = new Date(), days = 14, fetchImpl = fetch }) {
  if (!config?.practitioner_id || !config.target_calendar_id || !config.source_calendar_id
    || config.target_calendar_id === config.source_calendar_id || config.environment !== 'test') {
    throw new Error('unsafe_calendar_target')
  }

  const { data: practitioner, error: practitionerError } = await db
    .from('booking_practitioners')
    .select('id, is_active, booking_enabled, min_advance_hours, buffer_before_min, buffer_after_min, max_per_day')
    .eq('id', config.practitioner_id)
    .single()
  if (practitionerError || !practitioner?.is_active || !practitioner?.booking_enabled) throw new Error('practitioner_unavailable')

  const { data: service, error: serviceError } = await db
    .from('booking_services')
    .select('duration_min')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .order('duration_min', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (serviceError || !Number.isFinite(service?.duration_min) || service.duration_min <= 0) throw new Error('service_duration_unavailable')

  let sourceAccess
  try {
    sourceAccess = await googleAccessToken(db, practitioner.id)
  } catch {
    throw new Error('source_calendar_unavailable')
  }
  if (sourceAccess.calendarId !== config.source_calendar_id) throw new Error('source_calendar_mismatch')

  const dates = projectionDates({ now, days })
  const fromDate = dates[0]
  const toDate = dates[dates.length - 1]
  const input = await loadAvailabilityData({ db, practitionerId: practitioner.id, fromDate, toDate, now })
  const bounds = { start: parisDayBounds(fromDate).start, end: parisDayBounds(addDays(toDate, 1)).start }
  const google = await loadGoogleBusy({ db, practitionerId: practitioner.id, timeMin: bounds.start, timeMax: bounds.end, fetchImpl })
  if (!google.ok) throw new Error(google.error || 'source_calendar_read_failed')

  const desired = availabilityProjection({
    days: computeAvailability({
      dates, practitioner, durationMin: service.duration_min, rules: input.rules,
      exceptions: input.exceptions, bookings: input.bookings, holds: input.holds,
      offers: input.offers, googleBusy: google.busy, now,
    }),
  })
  const existing = await listOwnedTargetEvents({ targetCalendarId: config.target_calendar_id, accessToken: sourceAccess.accessToken, fetchImpl })
  const result = await syncAvailabilityCalendar({
    targetCalendarId: config.target_calendar_id, sourceCalendarId: config.source_calendar_id,
    desired, existing, accessToken: sourceAccess.accessToken, fetchImpl,
  })
  if (result.errors.length) throw new Error(`target_calendar_write_${result.errors[0].status || 'failed'}`)
  return { ...result, projected: desired.length, horizon_days: days }
}
