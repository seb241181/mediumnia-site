/**
 * GET /api/google-calendar/status?practitioner=<slug>
 *
 * Retourne l'état de la connexion Google Agenda pour un praticien.
 * Ne retourne JAMAIS de tokens (ni access_token, ni refresh_token).
 *
 * Réponse si connecté :
 *   { connected: true, email, calendarId, since }
 *
 * Réponse si non connecté ou erreur :
 *   { connected: false, reason }
 */
import { getSupabaseAdmin, isSupabaseConfigured } from '../../lib/supabaseAdmin.js'

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

  if (!isSupabaseConfigured()) {
    return res.status(200).json({ connected: false, reason: 'supabase_not_configured' })
  }

  const supabase = getSupabaseAdmin()

  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', slug)
    .single()

  if (practErr || !practitioner) {
    return res.status(200).json({ connected: false, reason: 'practitioner_not_found' })
  }

  const { data: conn, error: connErr } = await supabase
    .from('booking_calendar_connections')
    .select('google_email, google_calendar_id, created_at, is_active')
    .eq('practitioner_id', practitioner.id)
    .eq('is_active', true)
    .single()

  if (connErr || !conn) {
    return res.status(200).json({ connected: false, reason: 'no_connection' })
  }

  return res.status(200).json({
    connected: true,
    email: conn.google_email,
    calendarId: conn.google_calendar_id,
    since: conn.created_at,
  })
}
