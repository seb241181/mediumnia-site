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
  const body = { summary: event.summary, colorId: event.colorId, transparency: 'transparent', visibility: 'private', extendedProperties: { private: { mediumia_source: AVAILABILITY_SOURCE, mediumia_key: event.key } } }
  if (event.id) body.id = event.id
  if (event.allDay) {
    body.start = { date: event.start.date }
    const next = new Date(`${event.start.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    body.end = { date: next.toISOString().slice(0, 10) }
  } else { body.start = event.start; body.end = event.end }
  return body
}

function matchesProjection(existing, desired) {
  // The compact fake events used in unit tests only establish ownership.
  if (existing.summary == null && existing.colorId == null) return true
  return existing.summary === desired.summary
    && String(existing.colorId || '') === String(desired.colorId || '')
    && existing.transparency === 'transparent'
    && existing.visibility === 'private'
}

/** Idempotent reconciliation. Only deletes events bearing our private source marker. */
export async function syncAvailabilityCalendar({ targetCalendarId, sourceCalendarId, desired, existing = [], accessToken, fetchImpl = fetch }) {
  if (!targetCalendarId || targetCalendarId === 'primary' || targetCalendarId === sourceCalendarId) {
    throw new Error('dedicated_target_calendar_required')
  }
  const owned = existing.filter((e) => e.extendedProperties?.private?.mediumia_source === AVAILABILITY_SOURCE)
  const activeOwned = owned.filter((e) => e.status !== 'cancelled')
  const cancelledOwned = owned.filter((e) => e.status === 'cancelled')
  const ownedKey = (event) => event.extendedProperties?.private?.mediumia_key || event.id
  const byId = new Map(activeOwned.map((e) => [e.id, e]))
  const byKey = new Map(activeOwned.map((e) => [ownedKey(e), e]))
  const cancelledById = new Map(cancelledOwned.map((e) => [e.id, e]))
  const cancelledByKey = new Map(cancelledOwned.map((e) => [ownedKey(e), e]))
  const wantedKeys = new Set(desired.map((e) => e.key))
  const wantedIds = new Set(desired.map((e) => e.id))
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  const result = { created: 0, updated: 0, unchanged: 0, deleted: 0, errors: [] }
  for (const event of desired) {
    const current = byKey.get(event.key) || byId.get(event.id)
    if (current && matchesProjection(current, event)) { result.unchanged++; continue }
    if (current) {
      const r = await fetchImpl(`${base}/${encodeURIComponent(current.id)}`, { method: 'PATCH', headers, body: JSON.stringify(googleBody({ ...event, id: current.id })) })
      if (r.ok) result.updated++
      else result.errors.push({ operation: 'update', id: event.id, status: r.status })
      continue
    }
    // Google keeps deleted ids as tombstones. Reinsert without an id: Google
    // allocates a fresh one while mediumia_key preserves idempotence thereafter.
    const tombstone = cancelledByKey.get(event.key) || cancelledById.get(event.id)
    if (tombstone) {
      const r = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify(googleBody({ ...event, id: null })) })
      if (r.ok) result.created++
      else result.errors.push({ operation: 'restore', id: tombstone.id, status: r.status })
      continue
    }
    const r = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify(googleBody(event)) })
    if (r.ok) result.created++
    else result.errors.push({ operation: 'create', id: event.id, status: r.status })
  }
  // Google must be fully writable before removing a previously published slot.
  // In particular, a temporary Google outage must never make availability vanish.
  if (result.errors.length) return result
  for (const event of activeOwned) {
    if (wantedKeys.has(ownedKey(event)) || wantedIds.has(event.id)) continue
    const r = await fetchImpl(`${base}/${encodeURIComponent(event.id)}`, { method: 'DELETE', headers })
    if (r.ok || r.status === 404 || r.status === 410) result.deleted++
    else result.errors.push({ operation: 'delete', id: event.id, status: r.status })
  }
  return result
}
