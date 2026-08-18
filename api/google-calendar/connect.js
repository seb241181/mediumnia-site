/**
 * GET /api/google-calendar/connect?practitioner=<slug>
 *
 * Génère l'URL OAuth Google et redirige le praticien vers la page de consentement.
 * Le state signé HMAC encode le slug du praticien et expire dans 5 minutes.
 *
 * Variables requises : GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, CALENDAR_TOKEN_ENCRYPTION_KEY
 */
import { generateState } from '../../lib/googleOAuth.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validation des variables d'environnement
  const missing = []
  if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
  if (!process.env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI')
  if (!process.env.CALENDAR_TOKEN_ENCRYPTION_KEY) missing.push('CALENDAR_TOKEN_ENCRYPTION_KEY')
  if (missing.length) {
    return res.status(503).json({
      error: 'Google OAuth non configuré',
      missing_env_vars: missing,
      message: 'Configurez ces variables dans Vercel Settings → Environment Variables.',
    })
  }

  // Validation du slug praticien
  const slug = req.query.practitioner
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Paramètre practitioner manquant ou invalide' })
  }

  // Génération du state signé HMAC (TTL 5 min, nonce aléatoire)
  let state
  try {
    state = generateState(slug)
  } catch (err) {
    // Ne pas exposer les détails d'erreur interne
    return res.status(500).json({ error: 'Erreur de génération du state OAuth' })
  }

  // Construction de l'URL OAuth Google
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',   // Force l'envoi du refresh_token à chaque connexion
    state,
  })

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  return res.redirect(302, authUrl)
}
