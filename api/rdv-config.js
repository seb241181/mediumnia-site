/**
 * GET /api/rdv-config?practitioner=<slug>
 *
 * Configuration du calendrier public de prise de rendez-vous.
 *
 * Réponse :
 *   { mode: 'demo' | 'live',
 *     availableWeekdays: number[] | null,
 *     horizonDays: number,
 *     notice: string | null }
 *
 * mode 'live'  → Google Agenda connecté.
 *   availableWeekdays : jours JS (0=Dim..6=Sam) ayant au moins une règle de dispo.
 *   horizonDays       : depuis booking_practitioners.booking_horizon_days (défaut 90)
 *                       → nécessite la migration SQL qui ajoute cette colonne.
 *
 * mode 'demo'  → Supabase absent, praticien inconnu ou Google non connecté.
 *   availableWeekdays : null  → le frontend applique les règles DEMO (Lun-Ven, 42 j)
 *   horizonDays       : 42
 *
 * Endpoint public (aucune auth) — ne retourne que des informations de configuration,
 * jamais de tokens ou de données sensibles.
 */
import { isSupabaseConfigured, getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

// Horizon par défaut en mode LIVE jusqu'à ce que la colonne booking_horizon_days
// soit ajoutée à booking_practitioners via la migration docs/rdv-schema.sql.
const LIVE_DEFAULT_HORIZON_DAYS = 90
const DEMO_HORIZON_DAYS = 42

// Conversion jour DB (0=Lun) → JS getDay() (0=Dim) : (schemaDay + 1) % 7
function schemaToJsDay(schemaDay) {
  return (schemaDay + 1) % 7
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  const demoResponse = {
    mode: 'demo',
    availableWeekdays: null,
    horizonDays: DEMO_HORIZON_DAYS,
    notice: null,
  }

  if (!isSupabaseConfigured()) {
    return res.status(200).json(demoResponse)
  }

  const supabase = getSupabaseAdmin()

  // ── Résolution praticien ──────────────────────────────────────────────────────
  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!practitioner) {
    return res.status(200).json(demoResponse)
  }

  // ── Connexion Google Agenda ───────────────────────────────────────────────────
  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
    return res.status(200).json(demoResponse)
  }

  // ── Mode LIVE : jours disponibles depuis booking_availability_rules ───────────
  const { data: rules } = await supabase
    .from('booking_availability_rules')
    .select('day_of_week')
    .eq('practitioner_id', practitioner.id)

  // Dédoublonner et convertir en jours JS
  const availableWeekdays = rules && rules.length > 0
    ? [...new Set(rules.map(r => schemaToJsDay(r.day_of_week)))].sort()
    : []

  // ── Horizon de réservation ────────────────────────────────────────────────────
  // TODO : lire booking_practitioners.booking_horizon_days une fois la migration
  // docs/rdv-schema.sql appliquée (ALTER TABLE booking_practitioners ADD COLUMN
  // booking_horizon_days INTEGER NOT NULL DEFAULT 60).
  const horizonDays = LIVE_DEFAULT_HORIZON_DAYS

  return res.status(200).json({
    mode: 'live',
    availableWeekdays,
    horizonDays,
    notice: availableWeekdays.length === 0
      ? 'Horaires de disponibilité non configurés.'
      : null,
  })
}
