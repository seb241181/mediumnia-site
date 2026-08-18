/**
 * GET /api/rdv-availability?practitioner=<slug>&date=YYYY-MM-DD
 *
 * Retourne les créneaux disponibles pour une date donnée.
 *
 * mode: 'demo'    → Supabase absent, praticien inconnu, ou pas de connexion Google
 * mode: 'live'    → créneaux calculés via Google Calendar freeBusy
 * mode: 'error'   → connexion Google présente mais requête freeBusy échouée
 *
 * Réponse :
 *   { mode, slots: [{ time, available }], notice }
 *
 * Sécurité : aucun titre, description ou participant d'événement Google n'est retourné.
 */
import { encrypt, decrypt, refreshGoogleToken, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { generateDemoSlots } from '../src/data/rdvData.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Horaire de référence Paris (à terme configurable via booking_availability_rules)
const WORK_START_PARIS = '09:00'
const WORK_END_PARIS   = '18:00'
const SLOT_DURATION_MIN = 60

function demoResponse(notice) {
  return { mode: 'demo', slots: [], notice }
}

function parisDateToUTC(dateStr, timeStr, offsetMs) {
  // offsetMs est négatif pour UTC+ (ex. -7200000 pour UTC+2)
  const [h, m] = timeStr.split(':').map(Number)
  const parisMs = new Date(dateStr + 'T00:00:00Z').getTime() + h * 3600_000 + m * 60_000
  return new Date(parisMs - offsetMs)
}

function generateLiveSlots(dateStr, busyPeriods, offsetMs) {
  const slots = []
  const [startH, startM] = WORK_START_PARIS.split(':').map(Number)
  const [endH, endM]     = WORK_END_PARIS.split(':').map(Number)
  const baseMs = new Date(dateStr + 'T00:00:00Z').getTime() - offsetMs
  const dayStartMs = baseMs + startH * 3600_000 + startM * 60_000
  const dayEndMs   = baseMs + endH   * 3600_000 + endM   * 60_000

  let cursor = dayStartMs
  while (cursor + SLOT_DURATION_MIN * 60_000 <= dayEndMs) {
    const slotStart = cursor
    const slotEnd   = cursor + SLOT_DURATION_MIN * 60_000
    const isBusy = busyPeriods.some(({ start, end }) => {
      const bStart = new Date(start).getTime()
      const bEnd   = new Date(end).getTime()
      return bStart < slotEnd && bEnd > slotStart
    })
    const h = String(new Date(slotStart + offsetMs).getUTCHours()).padStart(2, '0')
    const m = String(new Date(slotStart + offsetMs).getUTCMinutes()).padStart(2, '0')
    slots.push({ time: `${h}:${m}`, available: !isBusy })
    cursor = slotEnd
  }
  return slots
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { practitioner: slug, date } = req.query

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Paramètre date manquant ou invalide (YYYY-MM-DD attendu)' })
  }

  // ── Mode démo si Supabase absent ─────────────────────────────────────────────
  if (!isSupabaseConfigured()) {
    return res.status(200).json({
      mode: 'demo',
      slots: generateDemoSlots(new Date(date)),
      notice: 'Créneaux de démonstration — Supabase non configuré.',
    })
  }

  const supabase = getSupabaseAdmin()

  // ── Résolution praticien ──────────────────────────────────────────────────────
  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id, timezone')
    .eq('slug', slug)
    .single()

  if (practErr || !practitioner) {
    return res.status(200).json({
      mode: 'demo',
      slots: generateDemoSlots(new Date(date)),
      notice: 'Praticien introuvable en base — créneaux de démonstration.',
    })
  }

  // ── Connexion Google ──────────────────────────────────────────────────────────
  const { data: conn, error: connErr } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry, google_calendar_id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (connErr || !conn) {
    return res.status(200).json({
      mode: 'demo',
      slots: generateDemoSlots(new Date(date)),
      notice: 'Google Agenda non connecté — créneaux de démonstration.',
    })
  }

  // ── Rafraîchissement du token si nécessaire ──────────────────────────────────
  let accessToken
  const expiry = new Date(conn.token_expiry).getTime()
  if (Date.now() > expiry - 60_000) {
    try {
      const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
      accessToken = refreshed.access_token
      // Mise à jour de l'access token chiffré en DB
      await supabase
        .from('booking_calendar_connections')
        .update({
          access_token_enc: encrypt(accessToken),
          token_expiry: refreshed.expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq('practitioner_id', practitioner.id)
    } catch {
      return res.status(200).json({
        mode: 'error',
        slots: [],
        notice: 'Impossible de rafraîchir le token Google — reconnectez votre agenda.',
      })
    }
  } else {
    try {
      accessToken = decrypt(conn.access_token_enc)
    } catch {
      return res.status(200).json({
        mode: 'error',
        slots: [],
        notice: 'Erreur de déchiffrement du token Google — reconnectez votre agenda.',
      })
    }
  }

  // ── Calcul de l'offset Paris pour la date ────────────────────────────────────
  const offsetMs = parisUTCOffsetMs(date)
  const dayStartUTC = parisDateToUTC(date, WORK_START_PARIS, offsetMs).toISOString()
  const dayEndUTC   = parisDateToUTC(date, WORK_END_PARIS,   offsetMs).toISOString()

  // ── Appel Google freeBusy ────────────────────────────────────────────────────
  // freeBusy ne retourne que des plages occupées, jamais les titres ou détails.
  let busyPeriods = []
  try {
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: dayStartUTC,
        timeMax: dayEndUTC,
        timeZone: 'Europe/Paris',
        items: [{ id: conn.google_calendar_id || 'primary' }],
      }),
    })
    if (!freeBusyRes.ok) {
      return res.status(200).json({
        mode: 'error',
        slots: [],
        notice: 'Impossible de synchroniser avec Google Agenda. Réessayez dans un instant.',
      })
    }
    const freeBusyData = await freeBusyRes.json()
    const calKey = conn.google_calendar_id || 'primary'
    busyPeriods = freeBusyData.calendars?.[calKey]?.busy ?? []
  } catch {
    return res.status(200).json({
      mode: 'error',
      slots: [],
      notice: 'Erreur réseau lors de la synchronisation Google Agenda.',
    })
  }

  // ── Calcul des créneaux libres ───────────────────────────────────────────────
  const slots = generateLiveSlots(date, busyPeriods, offsetMs)

  return res.status(200).json({
    mode: 'live',
    slots,
    notice: null,
  })
}
