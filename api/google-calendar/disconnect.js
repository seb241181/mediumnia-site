/**
 * POST /api/google-calendar/disconnect
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 * Body JSON : { practitioner: "<slug>" }
 *
 * Vérification stricte : 401 si non authentifié, 403 si non propriétaire.
 * Révoque le token Google (best-effort) et supprime la connexion en DB.
 */
import { decrypt } from '../../lib/googleOAuth.js'
import { requirePractitionerOwner, isSupabaseConfigured, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

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

  // Vérification stricte : doit être le propriétaire du praticien
  const auth = await requirePractitionerOwner(req, slug)
  if (auth.error) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const supabase = getSupabaseAdmin()

  // Récupérer les tokens pour révocation (on utilise practitionerId déjà vérifié)
  const { data: conn } = await supabase
    .from('booking_calendar_connections')
    .select('access_token_enc, refresh_token_enc')
    .eq('practitioner_id', auth.practitionerId)
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
        // Statut de révocation intentionnellement ignoré
      } catch {
        // Échec de révocation toléré
      }
    }
  }

  // Suppression de la connexion en DB
  const { error: delErr } = await supabase
    .from('booking_calendar_connections')
    .delete()
    .eq('practitioner_id', auth.practitionerId)

  if (delErr) {
    return res.status(500).json({ error: 'Erreur lors de la suppression de la connexion' })
  }

  return res.status(200).json({ disconnected: true })
}
