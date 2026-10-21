import { listAgendaGoogleEvents } from './googleCalendarEvents.js'
import { getBookingBalances } from './rdvDayPayments.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (status, error) => ({ status, body: { error } })
const readonly = Object.freeze({ move: false, cancel: false, refund: false })

export function agendaRange(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
  if (!iso.test(String(from)) || !iso.test(String(to))) return null
  const start = Date.parse(from), end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== from.slice(0, 10) || new Date(end).toISOString().slice(0, 10) !== to.slice(0, 10) || end <= start || end - start > 62 * 86400000) return null
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

export function mergeAgendaEvents({ bookings, balances = {}, googleEvents, linkedIds, calendarId }) {
  const mediumia = bookings.map(b => ({
    id: `booking:${b.id}`, booking_id: b.id, source: 'mediumia',
    title: [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' ') || 'Rendez-vous MediumIA',
    start: b.starts_at, end: b.ends_at, allDay: false,
    status: b.status, updated_at: b.updated_at, modality: b.modality || null,
    google_linked: Boolean(b.google_event_id),
    payment: balances[b.id] ? { ...balances[b.id], evidence: 'mediumia_ledger', provider_verified: false } : null,
    permissions: readonly,
  }))
  const seen = new Set()
  const external = googleEvents.filter(e => {
    if (!e.id || e.status === 'cancelled' || linkedIds.has(e.id) || seen.has(e.id)) return false
    seen.add(e.id)
    return Boolean(e.start?.dateTime || e.start?.date) && Boolean(e.end?.dateTime || e.end?.date)
  }).map(e => ({
    id: `google:${calendarId}:${e.id}`, source: 'google', title: e.summary || 'Événement Google',
    start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
    allDay: Boolean(e.start.date), status: e.status || 'confirmed',
    modality: null, payment: null, permissions: readonly,
  }))
  return [...mediumia, ...external].sort((a, b) => a.start.localeCompare(b.start))
}

export async function getUnifiedAgenda({ supabase, userId, query, loadGoogle = listAgendaGoogleEvents, loadBalances = getBookingBalances }) {
  const practitionerId = String(query.practitioner_id || '')
  const range = agendaRange(query.from, query.to)
  if (!uuid.test(practitionerId) || !range) return fail(400, 'invalid_agenda_range')
  const owner = await supabase.from('booking_practitioners').select('id').eq('id', practitionerId).eq('owner_id', userId).maybeSingle()
  if (owner.error) return fail(503, 'owner_lookup_unavailable')
  if (!owner.data) return fail(403, 'forbidden')

  const bookings = []
  for (let offset = 0; ; offset += 500) {
    const page = await supabase.from('bookings')
    .select('id, starts_at, ends_at, status, updated_at, customer_first_name, customer_last_name, google_event_id')
      .eq('practitioner_id', practitionerId).lt('starts_at', range.end).gt('ends_at', range.start)
      .order('id').range(offset, offset + 499)
    if (page.error) return fail(503, 'bookings_unavailable')
    bookings.push(...(page.data || []))
    if ((page.data || []).length < 500) break
    if (offset >= 4500) return fail(422, 'agenda_range_too_dense')
  }

  const balances = {}
  let financeStatus = 'ready'
  for (let offset = 0; offset < bookings.length; offset += 100) {
    const result = await loadBalances({ supabase, userId, practitionerId, ids: bookings.slice(offset, offset + 100).map(b => b.id).join(',') })
    if (result.status !== 200) { financeStatus = 'unavailable'; break }
    Object.assign(balances, result.body.balances)
  }
  const google = await loadGoogle({ supabase, practitionerId, ...range })
  const linkedIds = new Set(bookings.map(b => b.google_event_id).filter(Boolean))
  // Search links independently of date/status filters: a moved/cancelled booking
  // must not reappear as an unrelated Google-only event.
  if (google.status === 'ready') {
    const ids = [...new Set(google.events.map(e => e.id).filter(Boolean))]
    for (let offset = 0; offset < ids.length; offset += 100) {
      const links = await supabase.from('bookings').select('google_event_id').eq('practitioner_id', practitionerId).in('google_event_id', ids.slice(offset, offset + 100))
      if (links.error) return fail(503, 'calendar_links_unavailable')
      for (const link of links.data || []) linkedIds.add(link.google_event_id)
    }
  }
  return { status: 200, body: {
    ...range, timezone: 'Europe/Paris', sources: { mediumia: 'ready', finance: financeStatus, google: google.status },
    events: mergeAgendaEvents({ bookings, balances: financeStatus === 'ready' ? balances : {}, googleEvents: google.status === 'ready' ? google.events : [], linkedIds, calendarId: google.calendarId }),
  } }
}
