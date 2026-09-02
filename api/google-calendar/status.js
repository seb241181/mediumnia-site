/**
 * GET /api/google-calendar/status?practitioner=<slug>
 * En-tête : Authorization: Bearer <supabase_access_token>
 *
 * Vérification d'identité "douce" : si non authentifié ou non propriétaire,
 * retourne { connected: false, reason } plutôt qu'un HTTP 401/403,
 * pour que le dashboard puisse toujours s'afficher (avec bouton "Connecter").
 *
 * Ne retourne JAMAIS de tokens (ni access_token, ni refresh_token).
 *
 * Réponse connecté :   { connected: true, email, calendarId, since }
 * Réponse déconnecté : { connected: false, reason }
 */
import { requirePractitionerOwner, isSupabaseConfigured, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

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

  // Vérification douce : échec d'auth → connected: false (le dashboard peut se rendre)
  const auth = await requirePractitionerOwner(req, slug)
  if (auth.error) {
    return res.status(200).json({ connected: false, reason: auth.error })
  }

  const supabase = getSupabaseAdmin()

  const { data: conn, error: connErr } = await supabase
    .from('booking_calendar_connections')
    .select('google_email, google_calendar_id, created_at, is_active')
    .eq('practitioner_id', auth.practitionerId)
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
