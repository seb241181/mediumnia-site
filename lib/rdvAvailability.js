/**
 * MediumIA Rendez-vous — moteur de disponibilité partagé (lecture seule).
 *
 * Utilisé par la page publique (api/rdv-availability.js : grille et règle de
 * conflit) et par Lumia (lib/lumiaAvailabilityContext.js). Une seule logique :
 *
 *   - Grille : dans chaque plage (règle hebdomadaire ou exception « modified »),
 *     un créneau commence au début de la plage puis tous les « durée » minutes,
 *     tant qu'il tient entièrement dans la plage (comme la page publique).
 *   - Conflit avec buffers (identique au RPC create_booking / create_rdv_deposit_hold) :
 *       réservation, réservation temporaire ou offre [bS, bE] :
 *         (bS - before) < (E + after)  ET  (bE + after) > (S - before)
 *       événement Google [GS, GE] :  GS < E + after  ET  GE > S - before
 *   - Exception « closed » : jour fermé ; « modified » : plages remplacées.
 *   - min_advance_hours, booking_horizon_days, max_per_day : comme rdv-book et
 *     le paiement des arrhes (max_per_day compte aussi les réservations
 *     temporaires actives, comme create_rdv_deposit_hold).
 *   - Mode urgence (même convention que lib/rdvSlotOffers.js) : un événement
 *     Google dont le titre commence par « Urgence » ne bloque pas et ouvre une
 *     plage réservée aux urgences ; le délai minimum est celui des liens
 *     personnels (plus de 30 minutes).
 *
 * Plus strict que la page publique, jamais moins : les réservations
 * temporaires actives (paiement en cours) et les liens personnels ouverts
 * bloquent aussi le créneau.
 *
 * Google : lecture seule de l'agenda connecté (events.list). Seuls l'état, la
 * transparence, les bornes et un booléen « urgence » sont conservés ; le titre
 * est lu pour la convention « Urgence » puis jeté immédiatement. Aucune
 * description, aucun participant, aucun lieu n'est demandé à Google.
 */
import { parisUTCOffsetMs } from './googleOAuth.js'
import { googleAccessToken } from './rdvSlotOffers.js'

export const URGENCE_TITLE_RE = /^\s*urgence\b/i
export const URGENT_MIN_LEAD_MS = 30 * 60_000
const ACTIVE_HOLD_STATUSES = ['payment_pending', 'payment_capturing', 'payment_captured']
const GOOGLE_PAGE_SIZE = 250
const GOOGLE_MAX_PAGES = 8

// ── Dates (heure de Paris, même conversion que la page publique) ────────────

export function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [h, m] = timeStr.split(':').map(Number)
  const parisMidnightUTC = new Date(dateStr + 'T00:00:00Z').getTime() + offsetMs
  return new Date(parisMidnightUTC + h * 3600_000 + m * 60_000)
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// 0 = lundi … 6 = dimanche (convention booking_availability_rules).
export function dbDayOfWeek(dateStr) {
  return (new Date(dateStr + 'T12:00:00Z').getDay() + 6) % 7
}

export function parisDayBounds(dateStr) {
  const start = new Date(dateStr + 'T00:00:00Z').getTime() + parisUTCOffsetMs(dateStr)
  return { start, end: start + 86_400_000 }
}

// Plages effectives d'un jour : null = fermé (exception) ou aucune règle.
export function effectiveRules(dateStr, exception, allRules) {
  if (exception?.exception_type === 'closed') return null
  if (exception?.exception_type === 'modified' && exception.slots?.length) return exception.slots
  const dayRules = (allRules || []).filter((r) => r.day_of_week === dbDayOfWeek(dateStr))
  return dayRules.length ? dayRules : null
}

// ── Grille et conflits ──────────────────────────────────────────────────────

export function ruleWindows(dateStr, rules, offsetMs) {
  return (rules || []).map((rule) => ({
    start: parisTimeToUTC(dateStr, rule.start_time, offsetMs).getTime(),
    end: parisTimeToUTC(dateStr, rule.end_time, offsetMs).getTime(),
  }))
}

export function slotGrid(windows, durationMs) {
  const starts = new Set()
  const slots = []
  for (const w of windows) {
    for (let cursor = w.start; cursor + durationMs <= w.end; cursor += durationMs) {
      if (starts.has(cursor)) continue
      starts.add(cursor)
      slots.push({ start: cursor, end: cursor + durationMs })
    }
  }
  return slots.sort((a, b) => a.start - b.start)
}

const toMs = (v) => (typeof v === 'number' ? v : new Date(v).getTime())

// Événement Google brut contre la zone tampon du créneau.
export function googleConflict(googleBusy, start, end, bufBeforeMs, bufAfterMs) {
  const checkStart = start - bufBeforeMs
  const checkEnd = end + bufAfterMs
  return (googleBusy || []).some((g) => toMs(g.start) < checkEnd && toMs(g.end) > checkStart)
}

// Intervalles MediumIA déjà étendus [bS - before, bE + after].
export function extendedConflict(extendedBusy, start, end, bufBeforeMs, bufAfterMs) {
  const checkStart = start - bufBeforeMs
  const checkEnd = end + bufAfterMs
  return (extendedBusy || []).some((b) => b.start < checkEnd && b.end > checkStart)
}

export function extendIntervals(rows, bufBeforeMs, bufAfterMs) {
  return (rows || []).map((r) => ({
    start: new Date(r.starts_at).getTime() - bufBeforeMs,
    end: new Date(r.ends_at).getTime() + bufAfterMs,
  }))
}

/**
 * Grille publique d'un jour (api/rdv-availability.js).
 * googleBusy : événements Google bruts [{ start, end }] ;
 * existingBusy : réservations déjà étendues par les buffers.
 */
export function generateSlots(dateStr, rules, googleBusy, existingBusy, offsetMs, durationMin, bufBeforeMs, bufAfterMs) {
  return slotGrid(ruleWindows(dateStr, rules, offsetMs), durationMin * 60_000).map(({ start, end }) => {
    const busy = googleConflict(googleBusy, start, end, bufBeforeMs, bufAfterMs)
      || extendedConflict(existingBusy, start, end, bufBeforeMs, bufAfterMs)
    const parisDate = new Date(start - offsetMs)
    const hh = String(parisDate.getUTCHours()).padStart(2, '0')
    const mm = String(parisDate.getUTCMinutes()).padStart(2, '0')
    return { time: `${hh}:${mm}`, available: !busy }
  })
}

// ── Calcul complet (Lumia) ──────────────────────────────────────────────────

export function activeHolds(holds, now) {
  const t = now.getTime()
  return (holds || []).filter((h) => h.status === 'payment_capturing' || h.status === 'payment_captured'
    || (h.status === 'payment_pending' && h.expires_at && new Date(h.expires_at).getTime() > t))
}

export function openOffers(offers, now) {
  const t = now.getTime()
  return (offers || []).filter((o) => o.status === 'open'
    && new Date(o.expires_at).getTime() > t && new Date(o.starts_at).getTime() > t)
}

// Même calcul que rdv-book / validateServerAvailability.
export function horizonLimit(practitioner, now) {
  if (!practitioner.booking_horizon_days) return null
  const latest = new Date(now)
  latest.setDate(latest.getDate() + practitioner.booking_horizon_days)
  return latest.getTime()
}

function prepare({ practitioner, bookings, holds, offers, googleBusy, now, urgent }) {
  const bufBeforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
  const bufAfterMs = (practitioner.buffer_after_min ?? 0) * 60_000
  const confirmed = (bookings || []).filter((b) => b.status === undefined || b.status === 'confirmed')
  const holdsActive = activeHolds(holds, now)
  return {
    bufBeforeMs,
    bufAfterMs,
    confirmed,
    holdsActive,
    bookingBusy: extendIntervals(confirmed, bufBeforeMs, bufAfterMs),
    holdBusy: extendIntervals(holdsActive, bufBeforeMs, bufAfterMs),
    offerBusy: extendIntervals(openOffers(offers, now), bufBeforeMs, bufAfterMs),
    googleBlocking: (googleBusy || []).filter((g) => !(urgent && g.urgence)),
    urgenceWindows: urgent ? (googleBusy || []).filter((g) => g.urgence) : [],
    earliest: urgent
      ? now.getTime() + URGENT_MIN_LEAD_MS + 1
      : now.getTime() + (practitioner.min_advance_hours ?? 0) * 3600_000,
    horizon: urgent ? null : horizonLimit(practitioner, now),
  }
}

function dayCount(rows, dateStr) {
  const { start, end } = parisDayBounds(dateStr)
  return rows.filter((r) => {
    const s = new Date(r.starts_at).getTime()
    return s >= start && s < end
  }).length
}

function blockReason(ctx, start, end) {
  if (start < ctx.earliest) return 'min_advance'
  if (ctx.horizon != null && start > ctx.horizon) return 'outside_horizon'
  if (googleConflict(ctx.googleBlocking, start, end, ctx.bufBeforeMs, ctx.bufAfterMs)) return 'google_busy'
  if (extendedConflict(ctx.bookingBusy, start, end, ctx.bufBeforeMs, ctx.bufAfterMs)) return 'booking_busy'
  if (extendedConflict(ctx.holdBusy, start, end, ctx.bufBeforeMs, ctx.bufAfterMs)) return 'hold_busy'
  if (extendedConflict(ctx.offerBusy, start, end, ctx.bufBeforeMs, ctx.bufAfterMs)) return 'offer_busy'
  return null
}

function dayWindows(ctx, dateStr, exception, rules) {
  const offsetMs = parisUTCOffsetMs(dateStr)
  const dayRules = effectiveRules(dateStr, exception, rules)
  const windows = dayRules ? ruleWindows(dateStr, dayRules, offsetMs) : []
  const { start, end } = parisDayBounds(dateStr)
  const urgence = ctx.urgenceWindows
    .map((g) => ({ start: Math.max(toMs(g.start), start), end: Math.min(toMs(g.end), end) }))
    .filter((w) => w.end > w.start)
  return { windows, urgence, dayRules }
}

function maxPerDayReached(ctx, practitioner, dateStr) {
  if (practitioner.max_per_day == null) return false
  return dayCount(ctx.confirmed, dateStr) + dayCount(ctx.holdsActive, dateStr) >= practitioner.max_per_day
}

/**
 * Créneaux d'une période. Retourne pour chaque jour son état et ses créneaux
 * (libres ou non, avec un motif générique — jamais un détail Google).
 */
export function computeAvailability({
  dates, practitioner, durationMin, rules = [], exceptions = [], bookings = [], holds = [], offers = [],
  googleBusy = [], now = new Date(), urgent = false,
}) {
  const ctx = prepare({ practitioner, bookings, holds, offers, googleBusy, now, urgent })
  const exceptionByDate = new Map((exceptions || []).map((e) => [e.exception_date, e]))
  const durationMs = durationMin * 60_000
  return dates.map((date) => {
    const exception = exceptionByDate.get(date)
    const { windows, urgence } = dayWindows(ctx, date, exception, rules)
    const all = [...windows, ...urgence]
    if (!all.length) {
      return { date, status: exception?.exception_type === 'closed' ? 'exception_closed' : 'outside_availability', slots: [] }
    }
    if (maxPerDayReached(ctx, practitioner, date)) return { date, status: 'max_per_day', slots: [] }
    const slots = slotGrid(all, durationMs).map(({ start, end }) => {
      const reason = blockReason(ctx, start, end)
      return { start, end, available: !reason, reason }
    })
    return { date, status: slots.some((s) => s.available) ? 'free_slots' : 'no_free_slot', slots }
  })
}

/**
 * Vérifie un créneau précis [date heure, + durée].
 * Mode normal : le créneau doit tenir entièrement dans une plage (comme rdv-book).
 * Mode urgence : le lien personnel accepte toute heure ; within_availability
 * l'indique seulement.
 */
export function checkSlotAvailability({
  date, time, practitioner, durationMin, rules = [], exceptions = [], bookings = [], holds = [], offers = [],
  googleBusy = [], now = new Date(), urgent = false,
}) {
  const ctx = prepare({ practitioner, bookings, holds, offers, googleBusy, now, urgent })
  const exception = (exceptions || []).find((e) => e.exception_date === date)
  const { windows, urgence } = dayWindows(ctx, date, exception, rules)
  const start = parisTimeToUTC(date, time, parisUTCOffsetMs(date)).getTime()
  const end = start + durationMin * 60_000
  const fits = (list) => list.some((w) => start >= w.start && end <= w.end)
  const withinAvailability = fits(windows) || fits(urgence)
  let reason
  if (!urgent && exception?.exception_type === 'closed') reason = 'exception_closed'
  else if (!urgent && !withinAvailability) reason = 'outside_availability'
  else if (maxPerDayReached(ctx, practitioner, date)) reason = 'max_per_day'
  else reason = blockReason(ctx, start, end)
  return { start, end, free: !reason, reason, within_availability: withinAvailability }
}

// ── Lecture des données (owner vérifié par l'appelant) ──────────────────────

export class AvailabilityError extends Error {
  constructor(step, code = null) {
    super('availability_unavailable')
    this.name = 'AvailabilityError'
    this.step = step
    this.code = code
  }
}

// Seuls les champs utiles au calcul : aucune donnée client.
export async function loadAvailabilityData({ db, practitionerId, fromDate, toDate, now = new Date() }) {
  const rangeStart = parisDayBounds(fromDate).start
  const rangeEnd = parisDayBounds(toDate).end
  const margin = 86_400_000
  const [rules, exceptions, bookings, holds, offers] = await Promise.all([
    db.from('booking_availability_rules')
      .select('day_of_week, start_time, end_time')
      .eq('practitioner_id', practitionerId)
      .order('start_time'),
    db.from('booking_exceptions')
      .select('exception_date, exception_type, slots')
      .eq('practitioner_id', practitionerId)
      .gte('exception_date', fromDate)
      .lte('exception_date', toDate),
    db.from('bookings')
      .select('starts_at, ends_at, status')
      .eq('practitioner_id', practitionerId)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date(rangeStart - margin).toISOString())
      .lt('starts_at', new Date(rangeEnd + margin).toISOString()),
    db.from('rdv_booking_holds')
      .select('starts_at, ends_at, status, expires_at')
      .eq('practitioner_id', practitionerId)
      .in('status', ACTIVE_HOLD_STATUSES)
      .gte('starts_at', new Date(rangeStart - margin).toISOString())
      .lt('starts_at', new Date(rangeEnd + margin).toISOString()),
    db.from('booking_slot_offers')
      .select('starts_at, ends_at, status, expires_at')
      .eq('practitioner_id', practitionerId)
      .eq('status', 'open')
      .gt('expires_at', now.toISOString())
      .gte('starts_at', new Date(rangeStart - margin).toISOString())
      .lt('starts_at', new Date(rangeEnd + margin).toISOString()),
  ])
  const steps = [['rules', rules], ['exceptions', exceptions], ['bookings', bookings], ['holds', holds], ['offers', offers]]
  for (const [step, result] of steps) {
    if (result.error) throw new AvailabilityError(step, result.error.code || null)
  }
  return {
    rules: rules.data || [],
    exceptions: exceptions.data || [],
    bookings: bookings.data || [],
    holds: holds.data || [],
    offers: offers.data || [],
  }
}

function eventBound(bound) {
  if (bound?.dateTime) return new Date(bound.dateTime).getTime()
  // Événement « journée entière » : minuit de Paris.
  if (bound?.date) return parisDayBounds(bound.date).start
  return NaN
}

// Événement → intervalle occupé, sans aucun texte. null = ne bloque pas.
export function googleBusyInterval(event) {
  if (!event || event.status === 'cancelled' || event.transparency === 'transparent') return null
  const start = eventBound(event.start)
  const end = eventBound(event.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end, urgence: URGENCE_TITLE_RE.test(String(event.summary || '')) }
}

/**
 * Lecture seule de l'agenda Google connecté du praticien.
 * Retourne { ok: true, busy } ou { ok: false, error } — jamais d'exception,
 * jamais de jeton ni de texte d'événement.
 */
export async function loadGoogleBusy({ db, practitionerId, timeMin, timeMax, fetchImpl = fetch }) {
  let access
  try {
    access = await googleAccessToken(db, practitionerId)
  } catch {
    return { ok: false, error: 'calendar_not_connected_or_token' }
  }
  const busy = []
  let pageToken = null
  try {
    for (let page = 0; page < GOOGLE_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(GOOGLE_PAGE_SIZE),
        fields: 'items(status,transparency,summary,start,end),nextPageToken',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const response = await fetchImpl(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(access.calendarId)}/events?${params}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${access.accessToken}` },
      })
      if (!response.ok) return { ok: false, error: 'calendar_read_failed' }
      const body = await response.json()
      for (const event of body?.items || []) {
        const interval = googleBusyInterval(event)
        if (interval) busy.push(interval)
      }
      pageToken = body?.nextPageToken || null
      if (!pageToken) return { ok: true, busy }
    }
  } catch {
    return { ok: false, error: 'calendar_read_failed' }
  }
  // Trop d'événements pour être sûr de tout voir : on ne déclare rien libre.
  return { ok: false, error: 'calendar_too_many_events' }
}
