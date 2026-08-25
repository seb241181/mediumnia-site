/**
 * GET /api/rdv-availability?practitioner=<slug>&date=YYYY-MM-DD&service_slug=<slug>
 *
 * Retourne les créneaux disponibles pour une date donnée.
 * En mode LIVE, service_slug est obligatoire : la durée est lue depuis
 * booking_services.duration_min côté serveur (jamais fournie par le client).
 *
 * Modes de réponse :
 *   'live'                 → créneaux calculés via Google Calendar freeBusy + règles
 *   'configuration_required' → Supabase absent, praticien inconnu, Google non connecté,
 *                              service/rules non configurés, ou FreeBusy inaccessible
 *   'error'                → (conservé pour les cas de token invalide explicitement détecté)
 *
 * Aucun créneau fictif n'est retourné. Si la configuration est incomplète,
 * slots: [] avec mode 'configuration_required'.
 *
 * Ordre de priorité pour les créneaux bloqués :
 *   1. Exception (congé/fermeture) → bloque toute la journée ou restreint les horaires
 *   2. Google FreeBusy → plages occupées dans Google Calendar
 *   3. Bookings MediumIA existants → réservations déjà confirmées dans Supabase
 */
import { encrypt, decrypt, refreshGoogleToken, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'

const SLUG_RE         = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const DATE_RE         = /^\d{4}-\d{2}-\d{2}$/
const SERVICE_SLUG_RE = /^[a-zA-Z0-9_\-]{1,100}$/

const CONFIG_REQUIRED = (notice) => ({
  mode: 'configuration_required',
  slots: [],
  notice: notice || 'Réservations temporairement indisponibles — configuration en cours.',
})

function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [h, m] = timeStr.split(':').map(Number)
  const parisMidnightUTC = new Date(dateStr + 'T00:00:00Z').getTime() + offsetMs
  return new Date(parisMidnightUTC + h * 3600_000 + m * 60_000)
}

function generateLiveSlotsFromRules(dateStr, rules, busyPeriods, offsetMs, durationMin) {
  const slots = []
  const durationMs = durationMin * 60_000

  for (const rule of rules) {
    const ruleStartUTC = parisTimeToUTC(dateStr, rule.start_time, offsetMs).getTime()
    const ruleEndUTC   = parisTimeToUTC(dateStr, rule.end_time,   offsetMs).getTime()
    let cursor = ruleStartUTC

    while (cursor + durationMs <= ruleEndUTC) {
      const slotStart = cursor
      const slotEnd   = cursor + durationMs
      const isBusy = busyPeriods.some(({ start, end }) => {
        const bStart = new Date(start).getTime()
        const bEnd   = new Date(end).getTime()
        return bStart < slotEnd && bEnd > slotStart
      })
      const parisDate = new Date(slotStart - offsetMs)
      const hh = String(parisDate.getUTCHours()).padStart(2, '0')
      const mm = String(parisDate.getUTCMinutes()).padStart(2, '0')
      slots.push({ time: `${hh}:${mm}`, available: !isBusy })
      cursor = slotEnd
    }
  }

  slots.sort((a, b) => a.time.localeCompare(b.time))
  return slots
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { practitioner: slug, date, service_slug: serviceSlugParam } = req.query

  if (!slug || !SLUG_RE.test(slug))
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
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
    .select('id, timezone, is_active, booking_enabled, buffer_before_min, buffer_after_min')
    .eq('slug', slug)
    .single()

  if (!practitioner || !practitioner.is_active || !practitioner.booking_enabled) {
    return res.status(200).json(CONFIG_REQUIRED())
  }

  // ── Connexion Google ──────────────────────────────────────────────────────

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
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
  // Si exception.type = 'modified' → utiliser exception.slots comme règles
  // Sinon → lire booking_availability_rules pour le jour de la semaine

  let rules
  if (exception?.exception_type === 'modified' && exception.slots?.length) {
    rules = exception.slots
  } else {
    const jsDay = new Date(date + 'T12:00:00Z').getDay()
    const dbDay = (jsDay + 6) % 7   // 0=Dim JS → 6=DB, 1=Lun JS → 0=DB

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

  const offsetMs   = parisUTCOffsetMs(date)
  const timeMinUTC = parisTimeToUTC(date, rules[0].start_time, offsetMs).toISOString()
  const timeMaxUTC = parisTimeToUTC(date, rules[rules.length - 1].end_time, offsetMs).toISOString()

  // ── Google FreeBusy ───────────────────────────────────────────────────────

  let busyPeriods = []
  try {
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: timeMinUTC,
        timeMax: timeMaxUTC,
        timeZone: 'Europe/Paris',
        items: [{ id: conn.google_calendar_id || 'primary' }],
      }),
    })
    if (!freeBusyRes.ok) {
      return res.status(200).json({ mode: 'error', slots: [], notice: 'Impossible de synchroniser avec Google Agenda.' })
    }
    const freeBusyData = await freeBusyRes.json()
    const calKey = conn.google_calendar_id || 'primary'
    busyPeriods = freeBusyData.calendars?.[calKey]?.busy ?? []
  } catch {
    return res.status(200).json({ mode: 'error', slots: [], notice: 'Erreur réseau lors de la synchronisation Google Agenda.' })
  }

  // ── Réservations MediumIA existantes (anti-double-booking visuel) ─────────

  const bufferBefore = practitioner.buffer_before_min ?? 0
  const bufferAfter  = practitioner.buffer_after_min  ?? 0

  const { data: existingBookings } = await supabase
    .from('bookings')
    .select('starts_at, ends_at')
    .eq('practitioner_id', practitioner.id)
    .eq('status', 'confirmed')
    .gte('starts_at', timeMinUTC)
    .lte('starts_at', timeMaxUTC)

  if (existingBookings) {
    for (const b of existingBookings) {
      busyPeriods.push({
        start: new Date(new Date(b.starts_at).getTime() - bufferBefore * 60_000).toISOString(),
        end:   new Date(new Date(b.ends_at).getTime()   + bufferAfter  * 60_000).toISOString(),
      })
    }
  }

  // ── Calcul des créneaux ───────────────────────────────────────────────────

  const slots = generateLiveSlotsFromRules(date, rules, busyPeriods, offsetMs, durationMin)

  return res.status(200).json({ mode: 'live', slots, notice: null })
}
