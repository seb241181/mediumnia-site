/**
 * GET /api/google-calendar/connect?practitioner=<slug>
 * En-tête requis : Authorization: Bearer <supabase_access_token>
 *
 * Vérifie que l'utilisateur connecté est propriétaire du praticien, génère
 * un state HMAC signé, le persiste dans oauth_states (consommation unique),
 * et retourne { url } JSON pour que le frontend redirige vers Google.
 *
 * Ne redirige pas directement : le frontend reçoit l'URL et fait
 * window.location.href = url, ce qui permet d'envoyer le JWT en header.
 *
 * Variables requises :
 *   GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, CALENDAR_TOKEN_ENCRYPTION_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { generateState } from '../../lib/googleOAuth.js'
import { requirePractitionerOwner, isSupabaseConfigured, getSupabaseAdmin } from '../../lib/supabaseAdmin.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/
const STATE_TTL_MS = 5 * 60 * 1000

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validation du slug praticien
  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  // Vérification des variables d'environnement OAuth
  const missing = []
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI')
  const encKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY
  if (!encKey) {
    missing.push('CALENDAR_TOKEN_ENCRYPTION_KEY')
  } else if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    // getKey() lance une erreur si la clé n'est pas exactement 64 hex chars
    missing.push('CALENDAR_TOKEN_ENCRYPTION_KEY (doit être 64 caractères hexadécimaux)')
  }
  if (missing.length) {
    return res.status(503).json({
      error: 'Google OAuth non configuré',
      missing_env_vars: missing,
    })
  }

  // Vérification d'identité : l'utilisateur doit être propriétaire du praticien
  const auth = await requirePractitionerOwner(req, slug)
  if (auth.error) {
    return res.status(auth.status).json({ error: auth.error })
  }

  // Génération du state signé HMAC (TTL 5 min, nonce aléatoire)
  let state
  try {
    state = generateState(slug)
  } catch {
    return res.status(500).json({ error: 'Erreur interne — génération du state OAuth' })
  }

  // Persistance en DB pour garantir la consommation unique
  // (le HMAC seul ne peut pas prévenir le rejeu sans état serveur)
  const supabase = getSupabaseAdmin()
  const { error: insertErr } = await supabase
    .from('oauth_states')
    .insert({
      state,
      practitioner_slug: slug,
      practitioner_id: auth.practitionerId,
      user_id: auth.userId,
      expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    })

  if (insertErr) {
    return res.status(500).json({
      error: 'Erreur interne — stockage du state OAuth',
      supabase_code: insertErr.code || null,
    })
  }

  // Construction de l'URL OAuth Google
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',              // Force refresh_token + consentement explicite
    include_granted_scopes: 'true', // Google retourne tokenData.scope dans la réponse
    state,
  })

  return res.status(200).json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  })
}
