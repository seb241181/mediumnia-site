/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Préversions Vercel uniquement : si les variables publiques du client Supabase
// n'ont pas été définies pour la préversion, on reprend les valeurs publiques du
// site de production (URL du projet et clé « publishable », déjà servies à tous les
// navigateurs dans le bundle de mediumia.fr). Aucune clé secrète ici. En production
// et en local, rien ne change : seules les variables d'environnement comptent.
if (process.env.VERCEL_ENV === 'preview') {
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((key) => !process.env[key])
  process.env.VITE_SUPABASE_URL ||= 'https://uotkpygeqqnekpolezts.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'sb_publishable_M5rGL8jtq95cwKp1frZ-Cg_K14AGgy4'
  console.log(`[vite] préversion : client Supabase configuré (${missing.length ? `valeurs publiques de production reprises pour ${missing.join(', ')}` : 'variables de la préversion'})`)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
