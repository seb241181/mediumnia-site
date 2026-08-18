/**
 * Client Supabase côté serveur avec service role key.
 * Ne jamais exposer côté frontend (pas de préfixe VITE_).
 */
import { createClient } from '@supabase/supabase-js'

let _client = null

export function getSupabaseAdmin() {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis')
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  })
  return _client
}

export function isSupabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}
