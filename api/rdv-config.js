/**
 * GET /api/rdv-config?practitioner=<slug>
 *
 * Configuration du calendrier public de prise de rendez-vous.
 *
 * Réponse :
 *   { mode: 'demo' | 'live' | 'configuration_required',
 *     availableWeekdays: number[] | null,   // JS getDay() (0=Dim..6=Sam)
 *     horizonDays: number | null,
 *     notice: string | null }
 *
 * mode 'demo'  → Supabase absent, praticien inconnu ou Google non connecté.
 *   availableWeekdays : null  → CalendarPicker applique les règles DEMO (Lun-Ven, 42 j)
 *   horizonDays       : 42
 *
 * mode 'configuration_required'  → Google connecté mais setup praticien incomplet.
 *   Déclencheurs possibles :
 *     - booking_practitioners.booking_horizon_days absent (migration SQL non appliquée)
 *     - booking_horizon_days NULL ou ≤ 0
 *     - Aucune règle dans booking_availability_rules pour ce praticien
 *   availableWeekdays : null   horizonDays : null
 *
 * mode 'live'  → tout configuré.
 *   availableWeekdays : jours JS distincts présents dans booking_availability_rules
 *   horizonDays       : valeur de booking_practitioners.booking_horizon_days
 *
 * Endpoint public (aucune auth) — ne retourne jamais de tokens ni données sensibles.
 */
import { isSupabaseConfigured, getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  const demo = { mode: 'demo', availableWeekdays: null, horizonDays: 42, notice: null }
  const configRequired = (notice) => ({
    mode: 'configuration_required',
    availableWeekdays: null,
    horizonDays: null,
    notice,
  })

  if (!isSupabaseConfigured()) {
    return res.status(200).json(demo)
  }

  const supabase = getSupabaseAdmin()

  // ── 1. Résolution praticien (colonnes de base) ────────────────────────────────
  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!practitioner) {
    return res.status(200).json(demo)
  }

  // ── 2. Connexion Google Agenda ────────────────────────────────────────────────
  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
    return res.status(200).json(demo)
  }

  // ── 3. Horizon de réservation ─────────────────────────────────────────────────
  // Nécessite la migration docs/rdv-schema.sql (ALTER TABLE booking_practitioners
  // ADD COLUMN booking_horizon_days INTEGER NOT NULL DEFAULT 60).
  // Si la colonne n'existe pas ou si la valeur est absente → configuration_required.
  const { data: horizonData, error: horizonErr } = await supabase
    .from('booking_practitioners')
    .select('booking_horizon_days')
    .eq('id', practitioner.id)
    .single()

  if (horizonErr || !horizonData?.booking_horizon_days) {
    return res.status(200).json(configRequired(
      'booking_horizon_days non configuré dans booking_practitioners — appliquez la migration docs/rdv-schema.sql.'
    ))
  }

  const horizonDays = horizonData.booking_horizon_days

  // ── 4. Règles de disponibilité ────────────────────────────────────────────────
  const { data: rules, error: rulesErr } = await supabase
    .from('booking_availability_rules')
    .select('day_of_week')
    .eq('practitioner_id', practitioner.id)

  if (rulesErr || !rules || rules.length === 0) {
    return res.status(200).json(configRequired(
      'Aucune règle de disponibilité configurée dans booking_availability_rules.'
    ))
  }

  // Conversion jour DB (0=Lun) → JS getDay() (0=Dim) : (dbDay + 1) % 7
  const availableWeekdays = [...new Set(rules.map(r => (r.day_of_week + 1) % 7))].sort()

  return res.status(200).json({
    mode: 'live',
    availableWeekdays,
    horizonDays,
    notice: null,
  })
}
