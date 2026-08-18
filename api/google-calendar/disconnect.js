/**
 * POST /api/google-calendar/disconnect
 * Body JSON : { practitioner: "<slug>" }
 *
 * Révoque le token Google (best-effort) et supprime la connexion en DB.
 * La révocation Google peut échouer (token déjà expiré, réseau) — on supprime quand même en DB.
 *
 * Variables requises : CALENDAR_TOKEN_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { decrypt } from '../../lib/googleOAuth.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Supabase non configuré' })
  }

  if (!process.env.CALENDAR_TOKEN_ENCRYPTION_KEY) {
    return res.status(503).json({ error: 'CALENDAR_TOKEN_ENCRYPTION_KEY manquante' })
  }

  const slug = req.body?.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  const supabase = getSupabaseAdmin()

  // Récupérer l'ID praticien
  const { data: practitioner, error: practErr } = await supabase
    .from('booking_practitioners')
    .select('id')
    .eq('slug', slug)
    .single()

  if (practErr || !practitioner) {
    return res.status(404).json({ error: 'Praticien introuvable' })
  }

  // Récupérer les tokens pour révocation
  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc')
    .eq('practitioner_id', practitioner.id)
    .single()

  // Révocation Google — best-effort, ne bloque pas la déconnexion
  if (conn) {
    const tokenToRevoke = conn.refresh_token_enc || conn.access_token_enc
    if (tokenToRevoke) {
      try {
        const plainToken = decrypt(tokenToRevoke)
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(plainToken)}`, {
          method: 'POST',
        })
        // On ignore délibérément le statut de la révocation
      } catch {
        // Échec de révocation toléré — on supprime quand même en DB
      }
    }
  }

  // Suppression de la connexion en DB
  const { error: delErr } = await supabase
    .from('booking_calendar_connections')
    .delete()
    .eq('practitioner_id', practitioner.id)

  if (delErr) {
    return res.status(500).json({ error: 'Erreur lors de la suppression de la connexion' })
  }

  return res.status(200).json({ disconnected: true })
}
