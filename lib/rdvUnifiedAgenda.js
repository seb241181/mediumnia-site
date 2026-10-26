import { listAgendaGoogleEvents } from './googleCalendarEvents.js'
import { getBookingBalances } from './rdvDayPayments.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (status, error) => ({ status, body: { error } })
const readonly = Object.freeze({ move: false, cancel: false, refund: false })
const knownModalities = new Set(['video', 'in-person', 'phone'])

// A service lists possible modes; only a saved request or converted hold
// proves which mode a client chose when more than one was offered.
export function resolveAgendaModality({ requests = [], holds = [], serviceModalities = [] } = {}) {
  const explicit = [...new Set([...requests, ...holds].filter(mode => knownModalities.has(mode)))]
  if (explicit.length > 1) return { modality: null, source: 'conflict' }
  if (explicit.length === 1) return { modality: explicit[0], source: 'selected' }
  const offered = [...new Set(serviceModalities.filter(mode => knownModalities.has(mode)))]
  return offered.length === 1
    ? { modality: offered[0], source: 'service' }
    : { modality: null, source: 'unknown' }
}

export function agendaRange(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
  if (!iso.test(String(from)) || !iso.test(String(to))) return null
  const start = Date.parse(from), end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== from.slice(0, 10) || new Date(end).toISOString().slice(0, 10) !== to.slice(0, 10) || end <= start || end - start > 62 * 86400000) return null
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

export function mergeAgendaEvents({ bookings, balances = {}, syncJobs = {}, chosenModalities = {}, googleEvents, linkedIds, calendarId }) {
  const mediumia = bookings.map(b => ({
    id: `booking:${b.id}`, booking_id: b.id, source: 'mediumia',
    title: [b.customer_first_name, b.customer_last_name].filter(Boolean).join(' ') || 'Rendez-vous MediumIA',
    start: b.starts_at, end: b.ends_at, allDay: false,
    status: b.status, updated_at: b.updated_at,
    modality: chosenModalities[b.id]?.modality || null,
    modality_source: chosenModalities[b.id]?.source || 'unknown',
    google_linked: Boolean(b.google_event_id),
    google_sync: syncJobs[b.id] || null,
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
    modality: null, modality_source: 'unknown', payment: null, permissions: readonly,
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
    .select('id, starts_at, ends_at, status, updated_at, customer_first_name, customer_last_name, google_event_id, service_id')
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
  const syncJobs = {}
  const bookingIds = bookings.map(b => b.id)
  for (let offset = 0; offset < bookingIds.length; offset += 100) {
    const batch = bookingIds.slice(offset, offset + 100)
    const jobs = await supabase.from('rdv_calendar_sync_jobs')
      .select('booking_id, status, last_error_code, attempt_count, updated_at')
      .in('booking_id', batch).in('status', ['pending', 'running', 'retry', 'review'])
      .order('created_at', { ascending: false })
    if (jobs.error) return fail(503, 'sync_jobs_unavailable')
    for (const job of jobs.data || []) {
      if (!syncJobs[job.booking_id]) syncJobs[job.booking_id] = { status: job.status, error: job.last_error_code, attempts: job.attempt_count, updated_at: job.updated_at }
    }
  }

  // Resolve modes from the client's saved choice where available.
  // Do not treat a multi-choice service or an unrelated Google event as proof.
  const requestsByBooking = new Map()
  const holdsByBooking = new Map()
  for (let offset = 0; offset < bookingIds.length; offset += 100) {
    const batch = bookingIds.slice(offset, offset + 100)
    const [requests, holds] = await Promise.all([
      supabase.from('booking_requests').select('confirmed_booking_id, requested_modality').in('confirmed_booking_id', batch),
      supabase.from('rdv_booking_holds').select('converted_booking_id, selected_modality').in('converted_booking_id', batch),
    ])
    if (requests.error || holds.error) return fail(503, 'agenda_modality_unavailable')
    for (const request of requests.data || []) {
      const values = requestsByBooking.get(request.confirmed_booking_id) || []
      values.push(request.requested_modality)
      requestsByBooking.set(request.confirmed_booking_id, values)
    }
    for (const hold of holds.data || []) {
      const values = holdsByBooking.get(hold.converted_booking_id) || []
      values.push(hold.selected_modality)
      holdsByBooking.set(hold.converted_booking_id, values)
    }
  }
  const serviceModalities = new Map()
  const serviceIds = [...new Set(bookings.map(booking => booking.service_id).filter(Boolean))]
  for (let offset = 0; offset < serviceIds.length; offset += 100) {
    const services = await supabase.from('booking_services')
      .select('id, modality').in('id', serviceIds.slice(offset, offset + 100))
    if (services.error) return fail(503, 'agenda_modality_unavailable')
    for (const service of services.data || []) serviceModalities.set(service.id, service.modality || [])
  }
  const chosenModalities = Object.fromEntries(bookings.map(booking => [
    booking.id,
    resolveAgendaModality({
      requests: requestsByBooking.get(booking.id) || [],
      holds: holdsByBooking.get(booking.id) || [],
      serviceModalities: serviceModalities.get(booking.service_id) || [],
    }),
  ]))

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
    events: mergeAgendaEvents({ bookings, balances: financeStatus === 'ready' ? balances : {}, syncJobs, chosenModalities, googleEvents: google.status === 'ready' ? google.events : [], linkedIds, calendarId: google.calendarId }),
  } }
}
