/**
 * GET /api/rdv-availability?practitioner=<slug>&date=YYYY-MM-DD&service_slug=<slug>
 *
 * Retourne les créneaux disponibles pour une date donnée.
 * service_slug est obligatoire : la durée est lue depuis booking_services côté serveur.
 *
 * Modes de réponse :
 *   'live'                   → créneaux calculés (certains peuvent être indisponibles)
 *   'configuration_required' → Supabase absent, praticien non configuré, Google non connecté,
 *                              service/rules absents, ou booking_enabled false.
 *   'error'                  → token Google invalide (refresh échoué explicitement)
 *
 * Aucun créneau fictif retourné. Si la configuration est incomplète → slots: [].
 *
 * Sémantique identique au RPC create_booking pour les vérifications :
 *
 *   Buffer : un créneau [S, E] est bloqué par une réservation existante b si leurs
 *     zones tampon se chevauchent :
 *       (b.starts_at - buf_before) < (E + buf_after)
 *       AND (b.ends_at + buf_after) > (S - buf_before)
 *     Les événements Google sont vérifiés contre la zone tampon du créneau :
 *       GS < E + buf_after  AND  GE > S - buf_before
 *
 *   max_per_day : si le maximum de RDV confirmés du jour est atteint,
 *     aucun créneau n'est disponible (message explicite).
 *
 *   FreeBusy window étendue : la requête Google est faite sur
 *     [timeMin - buf_before, timeMax + buf_after] pour attraper les événements
 *     qui débordent dans la zone tampon des créneaux de bord.
 */
import { encrypt, decrypt, refreshGoogleToken, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { activeHolds, addDays, effectiveRules, generateSlots, loadAvailabilityData, openOffers, parisTimeToUTC } from '../lib/rdvAvailability.js'

const SLUG_RE         = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const DATE_RE         = /^\d{4}-\d{2}-\d{2}$/
const SERVICE_SLUG_RE = /^[a-zA-Z0-9_\-]{1,100}$/

const CONFIG_REQUIRED = (notice) => ({
  mode: 'configuration_required',
  slots: [],
  notice: notice || 'Réservations temporairement indisponibles — configuration en cours.',
})

// Grille, conversion Paris → UTC et règle de conflit : lib/rdvAvailability.js
// (moteur partagé avec Lumia).

/**
 * GET /api/rdv-availability?practitioner=<slug>&service_slug=<slug>&from=YYYY-MM-DD&days=N
 *
 * Vue calendrier : indique pour chaque jour s'il reste au moins un créneau libre,
 * en une seule requête (un seul appel Google FreeBusy pour toute la période)
 * au lieu d'un appel par jour. Mêmes règles que la vue jour (exceptions, règles
 * hebdomadaires, max_per_day, buffers, délai minimum) ; la vue jour reste la
 * source des créneaux affichés et rdv-book revérifie tout à la réservation.
 *
 * Réponse : { mode: 'live', days: { 'YYYY-MM-DD': true|false } }
 */
async function handleRange(req, res, slug) {
  const { from, service_slug: serviceSlug } = req.query
  const days = Number(req.query.days)

  if (!DATE_RE.test(from) || !Number.isInteger(days) || days < 1 || days > 31)
    return res.status(400).json({ error: 'Paramètres from/days invalides (31 jours maximum)' })
  if (!serviceSlug || !SERVICE_SLUG_RE.test(serviceSlug))
    return res.status(400).json({ error: 'Paramètre service_slug manquant ou invalide' })

  if (!isSupabaseConfigured()) return res.status(200).json(CONFIG_REQUIRED())
  const supabase = getSupabaseAdmin()

  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id, timezone, is_active, booking_enabled, min_advance_hours, buffer_before_min, buffer_after_min, max_per_day')
    .eq('slug', slug)
    .single()
  if (!practitioner || !practitioner.is_active || !practitioner.booking_enabled) {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()
  if (!conn || !conn.google_calendar_id || conn.google_calendar_id === 'primary') {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  const { data: svc } = await supabase
    .from('booking_services')
    .select('duration_min')
    .eq('slug', serviceSlug)
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()
  if (!svc) return res.status(200).json(CONFIG_REQUIRED('Service introuvable ou inactif.'))

  const bufBeforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
  const bufAfterMs  = (practitioner.buffer_after_min  ?? 0) * 60_000
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i))
  const to = dates[dates.length - 1]
  const rangeStartUTC = new Date(from + 'T00:00:00Z').getTime() + parisUTCOffsetMs(from)
  const rangeEndUTC   = new Date(to + 'T00:00:00Z').getTime() + parisUTCOffsetMs(to) + 86_400_000

  // Même source des disponibilités que Lumia : réservation confirmée,
  // hold PayPal en cours, ou lien personnel non expiré.
  let availability
  try {
    availability = await loadAvailabilityData({
      db: supabase, practitionerId: practitioner.id, fromDate: from, toDate: to,
    })
  } catch {
    return res.status(503).json({ mode: 'error', slots: [], notice: 'Impossible de vérifier les disponibilités pour le moment.' })
  }
  const { exceptions, rules: allRules, bookings, holds, offers } = availability
  const snapshotNow = new Date()
  const heldSlots = activeHolds(holds, snapshotNow)
  const offeredSlots = openOffers(offers, snapshotNow)

  const exceptionByDate = new Map((exceptions || []).map(e => [e.exception_date, e]))

  // Règles effectives de chaque jour (null = fermé / non configuré).
  const rulesByDate = new Map()
  for (const date of dates) {
    rulesByDate.set(date, effectiveRules(date, exceptionByDate.get(date), allRules))
  }

  const result = Object.fromEntries(dates.map(date => [date, false]))
  if (![...rulesByDate.values()].some(Boolean)) {
    return res.status(200).json({ mode: 'live', days: result })
  }

  let accessToken
  try {
    const expiry = new Date(conn.token_expiry).getTime()
    if (Date.now() > expiry - 60_000) {
      const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
      accessToken = refreshed.access_token
      await supabase.from('booking_calendar_connections').update({
        access_token_enc: encrypt(accessToken),
        token_expiry: refreshed.expires_at,
        updated_at: new Date().toISOString(),
      }).eq('practitioner_id', practitioner.id)
    } else {
      accessToken = decrypt(conn.access_token_enc)
    }
  } catch {
    return res.status(200).json({ mode: 'error', slots: [], notice: 'Impossible de rafraîchir le token Google — reconnectez votre agenda.' })
  }

  let googleBusy = []
  try {
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date(rangeStartUTC - bufBeforeMs).toISOString(),
        timeMax: new Date(rangeEndUTC + bufAfterMs).toISOString(),
        timeZone: 'Europe/Paris',
        items: [{ id: conn.google_calendar_id }],
      }),
    })
    if (!freeBusyRes.ok) {
      return res.status(200).json({ mode: 'error', slots: [], notice: 'Impossible de synchroniser avec Google Agenda.' })
    }
    const freeBusyData = await freeBusyRes.json()
    googleBusy = freeBusyData.calendars?.[conn.google_calendar_id]?.busy ?? []
  } catch {
    return res.status(200).json({ mode: 'error', slots: [], notice: 'Erreur réseau lors de la synchronisation Google Agenda.' })
  }

  const earliestBookableAt = Date.now() + (practitioner.min_advance_hours ?? 0) * 3600_000

  for (const date of dates) {
    const rules = rulesByDate.get(date)
    if (!rules) continue
    const offsetMs = parisUTCOffsetMs(date)
    const dayStart = new Date(date + 'T00:00:00Z').getTime() + offsetMs
    const dayEnd = dayStart + 86_400_000
    const startsThisDay = b => {
      const start = new Date(b.starts_at).getTime()
      return start >= dayStart && start < dayEnd
    }
    const dayBookings = bookings.filter(startsThisDay)
    const dayHolds = heldSlots.filter(startsThisDay)
    const dayOffers = offeredSlots.filter(startsThisDay)
    // Les offres personnelles bloquent un créneau sans consommer le quota de RDV.
    if (practitioner.max_per_day != null && dayBookings.length + dayHolds.length >= practitioner.max_per_day) continue
    const existingBusy = [...dayBookings, ...dayHolds, ...dayOffers].map(b => ({
      start: new Date(b.starts_at).getTime() - bufBeforeMs,
      end: new Date(b.ends_at).getTime() + bufAfterMs,
    }))

    result[date] = generateSlots(date, rules, googleBusy, existingBusy, offsetMs, svc.duration_min, bufBeforeMs, bufAfterMs)
      .some(slot => slot.available && parisTimeToUTC(date, slot.time, offsetMs).getTime() >= earliestBookableAt)
  }

  return res.status(200).json({ mode: 'live', days: result })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { practitioner: slug, date, service_slug: serviceSlugParam } = req.query

  if (!slug || !SLUG_RE.test(slug))
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  if (req.query.from) return handleRange(req, res, slug)
  if (!date || !DATE_RE.test(date))
    return res.status(400).json({ error: 'Paramètre date manquant ou invalide (YYYY-MM-DD attendu)' })
  if (serviceSlugParam && !SERVICE_SLUG_RE.test(serviceSlugParam))
    return res.status(400).json({ error: 'Paramètre service_slug invalide' })

  if (!isSupabaseConfigured()) {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  const supabase = getSupabaseAdmin()

  // ── Praticien ─────────────────────────────────────────────────────────────

  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id, timezone, is_active, booking_enabled, min_advance_hours, buffer_before_min, buffer_after_min, max_per_day')
    .eq('slug', slug)
    .single()

  if (!practitioner || !practitioner.is_active || !practitioner.booking_enabled) {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  const bufBeforeMs = (practitioner.buffer_before_min ?? 0) * 60_000
  const bufAfterMs  = (practitioner.buffer_after_min  ?? 0) * 60_000

  // ── Connexion Google (obligatoire — cohérence avec rdv-book) ──────────────

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn || !conn.google_calendar_id || conn.google_calendar_id === 'primary') {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  // ── Service ───────────────────────────────────────────────────────────────

  if (!serviceSlugParam) {
    return res.status(200).json(CONFIG_REQUIRED('service_slug requis.'))
  }

  const { data: svc } = await supabase
    .from('booking_services')
    .select('duration_min')
    .eq('slug', serviceSlugParam)
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!svc) {
    return res.status(200).json(CONFIG_REQUIRED('Service introuvable ou inactif.'))
  }

  const durationMin = svc.duration_min
  const offsetMs    = parisUTCOffsetMs(date)

  // ── Exception du jour ─────────────────────────────────────────────────────

  const { data: exception } = await supabase
    .from('booking_exceptions')
    .select('exception_type, slots')
    .eq('practitioner_id', practitioner.id)
    .eq('exception_date', date)
    .maybeSingle()

  if (exception?.exception_type === 'closed') {
    return res.status(200).json({ mode: 'live', slots: [], notice: 'Fermé ce jour (fermeture exceptionnelle).', closed: true })
  }

  // ── Règles de disponibilité ───────────────────────────────────────────────

  let rules
  if (exception?.exception_type === 'modified' && exception.slots?.length) {
    rules = exception.slots
  } else {
    const jsDay = new Date(date + 'T12:00:00Z').getDay()
    const dbDay = (jsDay + 6) % 7  // 0=Dim JS → 6=DB, 1=Lun JS → 0=DB

    const { data: dbRules, error: rulesErr } = await supabase
      .from('booking_availability_rules')
      .select('start_time, end_time')
      .eq('practitioner_id', practitioner.id)
      .eq('day_of_week', dbDay)
      .order('start_time')

    if (rulesErr || !dbRules?.length) {
      return res.status(200).json(CONFIG_REQUIRED('Aucune disponibilité configurée pour ce jour.'))
    }
    rules = dbRules
  }

  // ── Réservations et paiements en cours : même source que Lumia ────────────
  const parisMidnightUTC    = new Date(date + 'T00:00:00Z').getTime() + offsetMs
  const parisMidnightEndUTC = parisMidnightUTC + 86_400_000
  let availability
  try {
    availability = await loadAvailabilityData({
      db: supabase, practitionerId: practitioner.id, fromDate: date, toDate: date,
    })
  } catch {
    return res.status(503).json({ mode: 'error', slots: [], notice: 'Impossible de vérifier les disponibilités pour le moment.' })
  }

  const startsThisDay = b => {
    const start = new Date(b.starts_at).getTime()
    return start >= parisMidnightUTC && start < parisMidnightEndUTC
  }
  const dayBookings = availability.bookings.filter(startsThisDay)
  const dayHolds = activeHolds(availability.holds, new Date()).filter(startsThisDay)
  const dayOffers = openOffers(availability.offers, new Date()).filter(startsThisDay)

  // Le quota est consommé par les RDV et holds actifs, comme dans le RPC.
  if (practitioner.max_per_day != null && dayBookings.length + dayHolds.length >= practitioner.max_per_day) {
    return res.status(200).json({
      mode: 'live', slots: [],
      notice: `Nombre maximum de rendez-vous atteint pour ce jour (${practitioner.max_per_day}).`,
      full: true,
    })
  }

  // ── Rafraîchissement du token ─────────────────────────────────────────────

  let accessToken
  try {
    const expiry = new Date(conn.token_expiry).getTime()
    if (Date.now() > expiry - 60_000) {
      const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
      accessToken = refreshed.access_token
      await supabase.from('booking_calendar_connections').update({
        access_token_enc: encrypt(accessToken),
        token_expiry: refreshed.expires_at,
        updated_at: new Date().toISOString(),
      }).eq('practitioner_id', practitioner.id)
    } else {
      accessToken = decrypt(conn.access_token_enc)
    }
  } catch {
    return res.status(200).json({ mode: 'error', slots: [], notice: 'Impossible de rafraîchir le token Google — reconnectez votre agenda.' })
  }

  // Fenêtre de la journée (bornes des règles) + extension par les buffers
  // pour attraper les événements Google qui débordent dans les zones tampon des créneaux de bord.
  const timeMinUTC     = parisTimeToUTC(date, rules[0].start_time,              offsetMs).toISOString()
  const timeMaxUTC     = parisTimeToUTC(date, rules[rules.length - 1].end_time, offsetMs).toISOString()
  const timeMinFB      = new Date(new Date(timeMinUTC).getTime() - bufBeforeMs).toISOString()
  const timeMaxFB      = new Date(new Date(timeMaxUTC).getTime() + bufAfterMs).toISOString()

  // ── Google FreeBusy ───────────────────────────────────────────────────────

  let googleBusy = []
  try {
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: timeMinFB,
        timeMax: timeMaxFB,
        timeZone: 'Europe/Paris',
        items: [{ id: conn.google_calendar_id }],
      }),
    })
    if (!freeBusyRes.ok) {
      return res.status(200).json({ mode: 'error', slots: [], notice: 'Impossible de synchroniser avec Google Agenda.' })
    }
    const freeBusyData = await freeBusyRes.json()
    const calKey = conn.google_calendar_id
    googleBusy = freeBusyData.calendars?.[calKey]?.busy ?? []
  } catch {
    return res.status(200).json({ mode: 'error', slots: [], notice: 'Erreur réseau lors de la synchronisation Google Agenda.' })
  }

  // Le RPC de paiement bloque aussi les holds payment_capturing/payment_captured,
  // même après expiration : un paiement PayPal peut avoir abouti sans retour serveur.
  // Les holds payment_pending expirés, eux, ne bloquent plus.
  const existingBusy = [...dayBookings, ...dayHolds, ...dayOffers].map(b => ({
    start: new Date(b.starts_at).getTime() - bufBeforeMs,
    end: new Date(b.ends_at).getTime() + bufAfterMs,
  }))

  // ── Calcul des créneaux ───────────────────────────────────────────────────

  const minAdvanceMs = (practitioner.min_advance_hours ?? 0) * 3600_000
  const earliestBookableAt = Date.now() + minAdvanceMs

  const slots = generateSlots(date, rules, googleBusy, existingBusy, offsetMs, durationMin, bufBeforeMs, bufAfterMs)
    .map(slot => {
      const slotStart = parisTimeToUTC(date, slot.time, offsetMs).getTime()
      return { ...slot, available: slot.available && slotStart >= earliestBookableAt }
    })

  return res.status(200).json({ mode: 'live', slots, notice: null })
}
