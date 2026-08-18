/**
 * GET /api/rdv-availability?practitioner=<slug>&date=YYYY-MM-DD&duration_min=<int>
 *
 * Retourne les créneaux disponibles pour une date donnée.
 *
 * Modes de réponse :
 *   'demo'                 → Supabase absent, praticien inconnu, ou pas de connexion Google
 *   'live'                 → créneaux calculés via Google Calendar freeBusy + booking_availability_rules
 *   'configuration_required' → Google connecté mais rules absentes OU duration_min manquant
 *   'error'                → règles présentes, freeBusy échoué
 *
 * ── Timezone (Europe/Paris) ─────────────────────────────────────────────────
 *
 * parisUTCOffsetMs(date) retourne un offsetMs NÉGATIF pour UTC+ :
 *   Été  UTC+2 → offsetMs = -7200000   (utcNoon - parisNoonAsUTC = 12:00Z - 14:00Z)
 *   Hiver UTC+1 → offsetMs = -3600000  (utcNoon - parisNoonAsUTC = 12:00Z - 13:00Z)
 *
 * Conversion Paris → UTC  :  UTC = minuit_UTC + offsetMs + heures
 *   Été  09:00 Paris = 00:00 UTC + (-7200000) + 9h = -2h + 9h = 07:00 UTC ✓
 *   Hiver 09:00 Paris = 00:00 UTC + (-3600000) + 9h = -1h + 9h = 08:00 UTC ✓
 *
 * Conversion UTC → Paris display : slotUTC - offsetMs
 *   Été  07:00 UTC → 07:00Z - (-7200000) = 07:00Z + 2h = 09:00 ✓
 *   Hiver 08:00 UTC → 08:00Z - (-3600000) = 08:00Z + 1h = 09:00 ✓
 *
 * Sécurité : aucun titre, description ou participant d'événement Google n'est retourné.
 */
import { encrypt, decrypt, refreshGoogleToken, parisUTCOffsetMs } from '../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../lib/supabaseAdmin.js'
import { generateDemoSlots } from '../src/data/rdvData.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Convertit une heure Paris (HH:MM) en Date UTC pour une date donnée.
 *
 * Correction v2 : utilise minuit Paris (= minuit UTC + offsetMs) comme base,
 * puis ajoute les heures. La version précédente utilisait minuit UTC comme base,
 * ce qui donnait des résultats erronés de ±2h selon la saison.
 *
 * Vecteurs de test :
 *   Été  (offsetMs=-7200000) : 09:00 Paris → 07:00 UTC
 *   Hiver (offsetMs=-3600000) : 09:00 Paris → 08:00 UTC
 */
function parisTimeToUTC(dateStr, timeStr, offsetMs) {
  const [h, m] = timeStr.split(':').map(Number)
  // minuit UTC + offsetMs = minuit Paris exprimé en UTC (offsetMs négatif pour UTC+)
  const parisMidnightUTC = new Date(dateStr + 'T00:00:00Z').getTime() + offsetMs
  return new Date(parisMidnightUTC + h * 3600_000 + m * 60_000)
}

/**
 * Génère les créneaux libres à partir des règles de disponibilité et des plages freeBusy.
 * Chaque règle couvre une plage horaire (ex. 09:00-12:00 ou 14:00-18:00).
 *
 * @param {string}   dateStr      YYYY-MM-DD (date Paris)
 * @param {Array}    rules        Lignes de booking_availability_rules
 * @param {Array}    busyPeriods  Plages occupées Google { start, end } (ISO 8601)
 * @param {number}   offsetMs     Offset Paris (négatif pour UTC+, ex. -7200000)
 * @param {number}   durationMin  Durée de la prestation en minutes
 */
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

      // Conversion UTC → heure Paris pour l'affichage
      // slotStart (UTC) - offsetMs = slotStart + |offsetMs| = Paris time
      const parisDate = new Date(slotStart - offsetMs)
      const hh = String(parisDate.getUTCHours()).padStart(2, '0')
      const mm = String(parisDate.getUTCMinutes()).padStart(2, '0')
      slots.push({ time: `${hh}:${mm}`, available: !isBusy })

      cursor = slotEnd
    }
  }

  // Tri chronologique (plusieurs règles peuvent s'intercaler)
  slots.sort((a, b) => a.time.localeCompare(b.time))
  return slots
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { practitioner: slug, date, duration_min: durationParam } = req.query

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
      slots: generateDemoSlots(new Date(date + 'T12:00:00Z')),
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
      slots: generateDemoSlots(new Date(date + 'T12:00:00Z')),
      notice: 'Praticien introuvable — créneaux de démonstration.',
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
      slots: generateDemoSlots(new Date(date + 'T12:00:00Z')),
      notice: 'Google Agenda non connecté — créneaux de démonstration.',
    })
  }

  // ── Règles de disponibilité ───────────────────────────────────────────────────
  // Jour de semaine Paris : date string YYYY-MM-DD → JS getDay() → schéma 0=Lun
  const jsDay = new Date(date + 'T12:00:00Z').getDay()   // UTC noon = même jour Paris
  const dbDay = (jsDay + 6) % 7                           // 0=Dim JS → 6=schéma, 1=Lun JS → 0=schéma

  const { data: rules, error: rulesErr } = await supabase
    .from('booking_availability_rules')
    .select('start_time, end_time')
    .eq('practitioner_id', practitioner.id)
    .eq('day_of_week', dbDay)
    .order('start_time')

  if (rulesErr || !rules || rules.length === 0) {
    return res.status(200).json({
      mode: 'configuration_required',
      slots: [],
      notice: 'Les horaires de disponibilité ne sont pas encore configurés pour ce praticien.',
    })
  }

  // ── Validation de la durée de prestation ─────────────────────────────────────
  const durationMin = parseInt(durationParam, 10)
  if (!durationMin || durationMin <= 0 || durationMin > 480) {
    return res.status(200).json({
      mode: 'configuration_required',
      slots: [],
      notice: 'Durée de prestation manquante ou invalide — paramètre duration_min requis.',
    })
  }

  // ── Rafraîchissement du token si nécessaire ──────────────────────────────────
  let accessToken
  const expiry = new Date(conn.token_expiry).getTime()
  if (Date.now() > expiry - 60_000) {
    try {
      const refreshed = await refreshGoogleToken(conn.refresh_token_enc)
      accessToken = refreshed.access_token
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

  // ── Offset Paris pour la date ─────────────────────────────────────────────────
  const offsetMs = parisUTCOffsetMs(date)

  // freeBusy couvre la plage complète (du début de la première règle à la fin de la dernière)
  const timeMinUTC = parisTimeToUTC(date, rules[0].start_time, offsetMs).toISOString()
  const timeMaxUTC = parisTimeToUTC(date, rules[rules.length - 1].end_time, offsetMs).toISOString()

  // ── Appel Google freeBusy ────────────────────────────────────────────────────
  // Retourne uniquement des plages occupées — jamais les titres ni les détails.
  let busyPeriods = []
  try {
    const freeBusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMinUTC,
        timeMax: timeMaxUTC,
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

  // ── Calcul des créneaux libres selon les règles ───────────────────────────────
  const slots = generateLiveSlotsFromRules(date, rules, busyPeriods, offsetMs, durationMin)

  return res.status(200).json({
    mode: 'live',
    slots,
    notice: null,
  })
}
