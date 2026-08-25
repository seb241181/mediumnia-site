/**
 * POST /api/rdv-book
 *
 * Crée une réservation après validation complète côté serveur.
 * Ne retourne "confirmé" QUE si l'INSERT dans bookings a réussi.
 *
 * Body JSON :
 *   practitioner_slug  string     slug du praticien
 *   service_slug       string     slug du service
 *   date               "YYYY-MM-DD"  date locale (Paris)
 *   time               "HH:MM"    heure locale (Paris)
 *   customer           { firstName, lastName, email, phone?, message? }
 *
 * Flux serveur :
 *   1. Validation des champs
 *   2. Lecture praticien + service depuis Supabase
 *   3. Vérification booking_enabled
 *   4. Vérification min_advance_hours
 *   5. Vérification exception (congé/fermeture)
 *   6. Re-vérification Google FreeBusy (si connecté)
 *   7. INSERT atomique via RPC create_booking (advisory lock → pas de double-booking)
 *   8. Retour { booking_id, starts_at, ends_at, practitioner, service }
 *
 * Anti-double-booking : RPC PostgreSQL avec pg_advisory_xact_lock par praticien.
 * Deux appels simultanés pour le même créneau : un seul INSERT aboutit.
 */
import { decrypt, refreshGoogleToken, encrypt, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE  = /^\d{2}:\d{2}$/

function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [h, m] = timeStr.split(':').map(Number)
  const parisMidnightUTC = new Date(dateStr + 'T00:00:00Z').getTime() + offsetMs
  return new Date(parisMidnightUTC + h * 3600_000 + m * 60_000)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'supabase_not_configured' })
  }

  // ── 1. Validation des champs ──────────────────────────────────────────────

  const { practitioner_slug, service_slug, date, time, customer } = req.body || {}

  if (!practitioner_slug || !service_slug || !date || !time || !customer) {
    return res.status(400).json({ error: 'Champs requis : practitioner_slug, service_slug, date, time, customer' })
  }
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date invalide (YYYY-MM-DD)' })
  if (!TIME_RE.test(time)) return res.status(400).json({ error: 'time invalide (HH:MM)' })
  if (!customer.firstName?.trim()) return res.status(400).json({ error: 'customer.firstName requis' })
  if (!customer.lastName?.trim())  return res.status(400).json({ error: 'customer.lastName requis' })
  if (!EMAIL_RE.test(customer.email?.trim())) return res.status(400).json({ error: 'customer.email invalide' })

  const supabase = getSupabaseAdmin()

  // ── 2. Praticien ──────────────────────────────────────────────────────────

  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id, name, timezone, booking_enabled, min_advance_hours, buffer_before_min, buffer_after_min, is_active')
    .eq('slug', practitioner_slug)
    .single()

  if (practErr || !practitioner) {
    return res.status(404).json({ error: 'Praticien introuvable' })
  }

  // ── 3. booking_enabled ────────────────────────────────────────────────────

  if (!practitioner.booking_enabled) {
    return res.status(409).json({ error: 'Les réservations sont actuellement fermées pour ce praticien.' })
  }

  // ── 4. Service ────────────────────────────────────────────────────────────

  const { data: service, error: svcErr } = await supabase
    .from('booking_services')
    .select('id, title, duration_min')
    .eq('slug', service_slug)
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (svcErr || !service) {
    return res.status(404).json({ error: 'Service introuvable ou inactif' })
  }

  // ── 5. min_advance_hours ──────────────────────────────────────────────────

  const offsetMs = parisUTCOffsetMs(date)
  const startsAtUTC = parisTimeToUTC(date, time, offsetMs)
  const endsAtUTC   = new Date(startsAtUTC.getTime() + service.duration_min * 60_000)
  const bufferBefore = (practitioner.buffer_before_min ?? 0) * 60_000
  const bufferAfter  = (practitioner.buffer_after_min  ?? 0) * 60_000
  const minAdvanceMs = (practitioner.min_advance_hours ?? 0) * 3600_000

  if (startsAtUTC.getTime() < Date.now() + minAdvanceMs) {
    const hoursNeeded = practitioner.min_advance_hours ?? 0
    return res.status(409).json({
      error: `Ce créneau est trop proche. Réservation minimum ${hoursNeeded}h à l'avance.`,
    })
  }

  // ── 6. Exception (congé/fermeture) ────────────────────────────────────────

  const { data: exception } = await supabase
    .from('booking_exceptions')
    .select('exception_type')
    .eq('practitioner_id', practitioner.id)
    .eq('exception_date', date)
    .maybeSingle()

  if (exception?.exception_type === 'closed') {
    return res.status(409).json({ error: 'Le praticien n\'est pas disponible ce jour (fermeture exceptionnelle).' })
  }

  // ── 7. Re-vérification FreeBusy Google (si connecté) ─────────────────────

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (conn) {
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

      // Fenêtre de vérification = créneau + buffers
      const checkStart = new Date(startsAtUTC.getTime() - bufferBefore).toISOString()
      const checkEnd   = new Date(endsAtUTC.getTime()   + bufferAfter).toISOString()

      const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: checkStart,
          timeMax: checkEnd,
          timeZone: 'Europe/Paris',
          items: [{ id: conn.google_calendar_id || 'primary' }],
        }),
      })

      if (freeBusyRes.ok) {
        const freeBusyData = await freeBusyRes.json()
        const calKey = conn.google_calendar_id || 'primary'
        const busy   = freeBusyData.calendars?.[calKey]?.busy ?? []
        if (busy.length > 0) {
          return res.status(409).json({ error: 'Ce créneau est déjà occupé dans votre Google Agenda.' })
        }
      }
    } catch {
      // Si freeBusy échoue → ne pas bloquer la réservation (token peut être révoqué)
      // Le create_booking RPC vérifiera les bookings MediumIA existants
    }
  }

  // ── 8. INSERT atomique via RPC (anti-double-booking) ─────────────────────
  // La fonction create_booking utilise pg_advisory_xact_lock(hashtext(practitioner_id))
  // pour garantir qu'une seule réservation peut être créée pour un créneau donné,
  // même en cas d'appels simultanés.

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('create_booking', {
    p_practitioner_id:      practitioner.id,
    p_service_id:           service.id,
    p_starts_at:            startsAtUTC.toISOString(),
    p_ends_at:              endsAtUTC.toISOString(),
    p_customer_first_name:  customer.firstName.trim(),
    p_customer_last_name:   customer.lastName.trim(),
    p_customer_email:       customer.email.trim().toLowerCase(),
    p_customer_phone:       customer.phone?.trim() || null,
    p_customer_message:     customer.message?.trim() || null,
    p_timezone:             practitioner.timezone || 'Europe/Paris',
  })

  if (rpcErr) {
    if (rpcErr.code === 'PGRST202') {
      return res.status(503).json({
        error: 'La fonction create_booking n\'existe pas encore en base — appliquez la migration docs/rdv-migration-v2.sql.',
      })
    }
    return res.status(500).json({ error: 'Erreur lors de la création de la réservation.', code: rpcErr.code })
  }

  if (!rpcResult || rpcResult.conflict) {
    return res.status(409).json({ error: rpcResult?.error || 'Ce créneau vient d\'être réservé. Choisissez un autre horaire.' })
  }

  return res.status(201).json({
    booking_id:  rpcResult.booking_id,
    starts_at:   startsAtUTC.toISOString(),
    ends_at:     endsAtUTC.toISOString(),
    practitioner: practitioner.name,
    service:      service.title,
  })
}
