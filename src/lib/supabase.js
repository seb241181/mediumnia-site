import { createClient } from '@supabase/supabase-js'
import { createAuthStorage } from './authStorage.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, typeof window === 'undefined' ? undefined : {
    // Même clé de session qu'avant ; « Rester connecté » décoché = session d'onglet.
    auth: { storage: createAuthStorage(window.localStorage, window.sessionStorage) },
  })
  : null

export function isSupabaseConfigured() {
  return Boolean(supabase)
}
