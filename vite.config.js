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

// Séparation TEST / PRODUCTION : niveau du déploiement figé au build, lu par
// src/lib/supabase.js pour refuser une base incompatible côté navigateur.
function deployTier(env) {
  if (env.MEDIUMIA_ISOLATED_TEST === 'true') return 'isolated_test'
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview') return 'preview'
  if (env.VERCEL_ENV === 'development') return 'development'
  return 'local'
}
const PRODUCTION_SUPABASE_HOST = 'uotkpygeqqnekpolezts.supabase.co'
if (deployTier(process.env) !== 'production' && String(process.env.VITE_SUPABASE_URL || '').includes(PRODUCTION_SUPABASE_HOST)) {
  console.warn('[vite] base de Production désignée hors Production : client Supabase désactivé dans ce build')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MEDIUMIA_DEPLOY_TIER': JSON.stringify(deployTier(process.env)),
  },
})
