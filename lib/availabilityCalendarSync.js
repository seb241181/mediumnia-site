/**
 * Projection read-only of MediumIA availability into a dedicated Google calendar.
 * It never receives the `seb` calendar id: callers must pass the dedicated target.
 */
import { createHash } from 'node:crypto'

export const AVAILABILITY_SOURCE = 'mediumia-availability-v1'

const eventId = (key) => `mav${createHash('sha256').update(key).digest('hex').slice(0, 40)}`
const iso = (ms) => new Date(ms).toISOString()

export function availabilityProjection({ days, timezone = 'Europe/Paris' }) {
  const events = []
  for (const day of days) {
    if (day.status === 'exception_closed') {
      const key = `closed:${day.date}`
      events.push({ id: eventId(key), key, summary: 'Jour fermé — MediumIA', start: { date: day.date }, end: { date: day.date }, allDay: true, colorId: '8' })
      continue
    }
    const exceptional = day.status === 'free_slots' && day.exceptionType === 'modified'
    for (const slot of day.slots || []) {
      if (!slot.available) continue
      const key = `slot:${iso(slot.start)}:${iso(slot.end)}`
      events.push({ id: eventId(key), key, summary: exceptional ? 'Disponibilité exceptionnelle' : 'Disponible', start: { dateTime: iso(slot.start), timeZone: timezone }, end: { dateTime: iso(slot.end), timeZone: timezone }, colorId: exceptional ? '6' : '10' })
    }
  }
  return events
}

function googleBody(event) {
  const body = { id: event.id, summary: event.summary, transparency: 'transparent', visibility: 'private', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE, mediumia_key: event.key } } }
  if (event.allDay) {
    body.start = { date: event.start.date }
    const next = new Date(`${event.start.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    body.end = { date: next.toISOString().slice(0, 10) }
  } else { body.start = event.start; body.end = event.end }
  return body
}

/** Idempotent reconciliation. Only deletes events bearing our private source marker. */
export async function syncAvailabilityCalendar({ targetCalendarId, sourceCalendarId, desired, existing = [], accessToken, fetchImpl = fetch }) {
  if (!targetCalendarId || targetCalendarId === sourceCalendarId) throw new Error('dedicated_target_calendar_required')
  const owned = existing.filter((e) => e.extendedProperties?.private?.mediumia_source === AVAILABILITY_SOURCE)
  const byId = new Map(owned.map((e) => [e.id, e]))
  const wanted = new Map(desired.map((e) => [e.id, e]))
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const result = { created: 0, unchanged: 0, deleted: 0, errors: [] }
  for (const event of desired) {
    if (byId.has(event.id)) { result.unchanged++; continue }
    const r = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify(googleBody(event)) })
    if (r.ok || r.status === 409) result.created++
    else result.errors.push({ operation: 'create', id: event.id, status: r.status })
  }
  for (const event of owned) {
    if (wanted.has(event.id)) continue
    const r = await fetchImpl(`${base}/${encodeURIComponent(event.id)}`, { method: 'DELETE', headers })
    if (r.ok || r.status === 404 || r.status === 410) result.deleted++
    else result.errors.push({ operation: 'delete', id: event.id, status: r.status })
  }
  return result
}
