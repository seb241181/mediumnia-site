/* global process */
import { createHash } from 'node:crypto'

// Clé du limiteur anti-abus des réservations. En Production, elle est obligatoire
// (absente : le service refuse, comme avant). Hors Production (TEST), une clé propre à
// l'environnement est dérivée si elle manque, pour que les essais restent possibles.
export function rdvRateLimitSecret(env = process.env) {
  const configured = String(env.RDV_RATE_LIMIT_SECRET || '').trim()
  if (/^[0-9a-fA-F]{64}$/.test(configured)) return configured
  if (env.VERCEL_ENV === 'production') return null
  return createHash('sha256').update(`mediumia-test-rate-limit:${env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'local'}`).digest('hex')
}
