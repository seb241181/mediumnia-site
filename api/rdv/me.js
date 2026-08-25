/**
 * GET /api/rdv/me
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * Retourne tous les praticiens appartenant à l'utilisateur connecté,
 * avec leurs services, règles de disponibilité, connexion Google (sans tokens)
 * et les 20 prochains rendez-vous confirmés.
 *
 * Aucune donnée sensible (tokens Google) n'est exposée.
 */
import { requireAuth, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const supabase = getSupabaseAdmin()

  const { data: practitioners, error: practErr } = await supabase
    .from('booking_practitioners')
    .select(`
      id, slug, name, role, photo_url, tagline, timezone, is_active,
      booking_horizon_days, buffer_before_min, buffer_after_min,
      min_advance_hours, max_per_day, booking_enabled
    `)
    .eq('owner_id', auth.userId)
    .order('slug')

  if (practErr) return res.status(500).json({ error: 'db_error', code: practErr.code })
  if (!practitioners || practitioners.length === 0) {
    return res.status(200).json({ practitioners: [] })
  }

  const ids = practitioners.map(p => p.id)
  const now = new Date().toISOString()

  const [
    { data: services },
    { data: rules },
    { data: connections },
    { data: bookings },
  ] = await Promise.all([
    supabase
      .from('booking_services')
      .select('id, slug, title, description, duration_min, price_cents, currency, modality, is_active, sort_order, practitioner_id')
      .in('practitioner_id', ids)
      .order('sort_order'),
    supabase
      .from('booking_availability_rules')
      .select('id, practitioner_id, day_of_week, start_time, end_time')
      .in('practitioner_id', ids)
      .order('day_of_week'),
    supabase
      .from('booking_calendar_connections')
      .select('practitioner_id, google_email, google_calendar_id, token_expiry, is_active')
      .in('practitioner_id', ids),
    supabase
      .from('bookings')
      .select('id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, starts_at, ends_at, status, google_meet_link')
      .in('practitioner_id', ids)
      .eq('status', 'confirmed')
      .gte('starts_at', now)
      .order('starts_at')
      .limit(20),
  ])

  const result = practitioners.map(p => ({
    ...p,
    services: (services || []).filter(s => s.practitioner_id === p.id),
    availability_rules: (rules || []).filter(r => r.practitioner_id === p.id),
    calendar: (connections || []).find(c => c.practitioner_id === p.id) || null,
    upcoming_bookings: (bookings || []).filter(b => b.practitioner_id === p.id),
  }))

  return res.status(200).json({ practitioners: result })
}
