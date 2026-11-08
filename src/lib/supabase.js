import { createClient } from '@supabase/supabase-js'
import { browserDatabaseAllowed } from './browserDatabaseGuard.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Séparation TEST / PRODUCTION (navigateur) : VITE_MEDIUMIA_DEPLOY_TIER est
// fixé au build (vite.config.js).
const deployTier = import.meta.env.VITE_MEDIUMIA_DEPLOY_TIER || 'local'

const allowed = browserDatabaseAllowed(supabaseUrl, deployTier)
if (supabaseUrl && !allowed && typeof console !== 'undefined') {
  console.warn('[environment-guard] Supabase désactivé : base incompatible avec cet environnement')
}

export const supabase = supabaseUrl && supabasePublishableKey && allowed
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null

export function isSupabaseConfigured() {
  return Boolean(supabase)
}
