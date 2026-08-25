/**
 * GET /api/rdv-config?practitioner=<slug>
 *
 * Configuration publique pour la page de réservation.
 * Retourne les données dont RdvPublic.jsx a besoin sans auth.
 *
 * Réponse :
 *   {
 *     mode: 'live' | 'configuration_required',
 *     availableWeekdays: number[] | null,   // JS getDay() (0=Dim..6=Sam)
 *     horizonDays: number | null,
 *     notice: string | null,
 *     practitioner: { name, role, photo_url, tagline } | null,
 *     services: Service[] | []              // actifs uniquement, triés par sort_order
 *   }
 *
 * mode 'configuration_required' → Supabase absent, praticien inconnu, Google non connecté,
 *                                  booking_horizon_days absent, ou aucune règle.
 *                                  Aucun créneau fictif n'est jamais retourné.
 * mode 'live'  → tout configuré, créneaux calculables côté serveur.
 *
 * Endpoint public — aucune donnée sensible (tokens, emails pro, etc.) n'est exposée.
 */
import { isSupabaseConfigured, getSupabaseAdmin } from '../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

const CONFIG_REQUIRED = (notice, practitioner = null, services = []) => ({
  mode: 'configuration_required',
  availableWeekdays: null,
  horizonDays: null,
  notice: notice || 'Réservations temporairement indisponibles — configuration en cours.',
  practitioner,
  services,
})

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(200).json(CONFIG_REQUIRED('Réservations temporairement indisponibles — configuration en cours.'))
  }

  const supabase = getSupabaseAdmin()

  // ── Praticien ─────────────────────────────────────────────────────────────

  const { data: practitioner } = await supabase
    .from('booking_practitioners')
    .select('id, name, role, photo_url, tagline, booking_horizon_days, is_active, booking_enabled')
    .eq('slug', slug)
    .single()

  if (!practitioner || !practitioner.is_active) {
    return res.status(200).json(CONFIG_REQUIRED('Réservations temporairement indisponibles — configuration en cours.'))
  }

  // Données publiques du praticien (jamais de données sensibles ici)
  const practitionerPublic = {
    name:      practitioner.name,
    role:      practitioner.role,
    photo_url: practitioner.photo_url,
    tagline:   practitioner.tagline,
  }

  // ── Services actifs ───────────────────────────────────────────────────────

  const { data: services } = await supabase
    .from('booking_services')
    .select('id, slug, title, description, duration_min, price_cents, currency, modality, is_active, sort_order')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .order('sort_order')

  const activeServices = services || []

  // ── booking_enabled ───────────────────────────────────────────────────────

  if (!practitioner.booking_enabled) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Les réservations sont actuellement fermées.',
      practitionerPublic,
      activeServices,
    ))
  }

  // ── Connexion Google ──────────────────────────────────────────────────────

  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('id')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (!conn) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  // ── Horizon de réservation ────────────────────────────────────────────────

  if (!practitioner.booking_horizon_days) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  // ── Règles de disponibilité ───────────────────────────────────────────────

  const { data: rules, error: rulesErr } = await supabase
    .from('booking_availability_rules')
    .select('day_of_week')
    .eq('practitioner_id', practitioner.id)

  if (rulesErr || !rules?.length) {
    return res.status(200).json(CONFIG_REQUIRED(
      'Réservations temporairement indisponibles — configuration en cours.',
      practitionerPublic,
      activeServices,
    ))
  }

  // Conversion DB 0=Lun → JS getDay() 0=Dim : (dbDay + 1) % 7
  const availableWeekdays = [...new Set(rules.map(r => (r.day_of_week + 1) % 7))].sort()

  return res.status(200).json({
    mode: 'live',
    availableWeekdays,
    horizonDays: practitioner.booking_horizon_days,
    notice: null,
    practitioner: practitionerPublic,
    services: activeServices,
  })
}
