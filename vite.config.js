/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Preview fail-closed: a missing client configuration must never inherit
// MediumIA Production Supabase. Build continues with the client disabled.
if (process.env.VERCEL_ENV === 'preview') {
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((key) => !process.env[key])
  if (missing.length) console.warn(`[vite] preview Supabase désactivé : ${missing.join(', ')} manquant(s)`)
}
if (process.env.MEDIUMIA_ISOLATED_TEST === 'true') {
  const expectedUrl = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'
  if (process.env.SUPABASE_URL !== expectedUrl || process.env.VITE_SUPABASE_URL !== expectedUrl) {
    throw new Error('isolated_test_supabase_url_mismatch')
  }
  if (!process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('isolated_test_publishable_key_missing')
  }
  if (process.env.PAYPAL_ENV === 'live') {
    throw new Error('isolated_test_paypal_live_forbidden')
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
