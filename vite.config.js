/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { checkDatabaseAccess, deploymentTier } from './lib/environmentGuard.js'

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
if (deploymentTier(process.env) === 'preview') {
  for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    const url = process.env[key]
    if (url && !checkDatabaseAccess(process.env, url).ok) throw new Error('preview_supabase_target_mismatch')
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MEDIUMIA_DEPLOY_TIER': JSON.stringify(deploymentTier(process.env)),
  },
})
