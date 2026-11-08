import { createClient } from '@supabase/supabase-js'
import { createAuthStorage } from './authStorage.js'
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
  ? createClient(supabaseUrl, supabasePublishableKey, typeof window === 'undefined' ? undefined : {
    // « Rester connecté » décoché = session d'onglet.
    auth: { storage: createAuthStorage(window.localStorage, window.sessionStorage) },
  })
  : null

export function isSupabaseConfigured() {
  return Boolean(supabase)
}
