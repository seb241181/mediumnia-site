/* global process */
// Lance la suite de tests sans aucune variable d'environnement de déploiement
// ni secret de service externe. Sur Vercel, le build exécute les tests avec les
// variables du déploiement (y compris celles de Production) : un test qui
// oublierait une simulation ne doit jamais pouvoir joindre la vraie base, PayPal,
// Resend, Google ou un modèle d'IA. Les tests fixent eux-mêmes les valeurs
// factices dont ils ont besoin.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const STRIPPED = /^(VERCEL_ENV|VERCEL_TARGET_ENV|MEDIUMIA_ISOLATED_TEST|SUPABASE_|VITE_SUPABASE_|NEXT_PUBLIC_SUPABASE_|PAYPAL_|VITE_PAYPAL_|RESEND_|GOOGLE_|ANTHROPIC_|OPENAI_|CLAUDE_|CLE_API_|CRON_SECRET|CALENDAR_TOKEN_ENCRYPTION_KEY|LUMIA_|RDV_RATE_LIMIT_SECRET|ORACLE_RATE_LIMIT_SECRET|TRIAL_RATE_LIMIT_SECRET|GUARDIAN_RATE_LIMIT_SECRET|PUBLIC_ASSISTANT_RATE_LIMIT_SECRET|BOOKING_BANK_)/

export function isolatedTestEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !STRIPPED.test(key)))
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const files = readdirSync('tests').filter((name) => name.endsWith('.test.js')).sort().map((name) => `tests/${name}`)
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', env: isolatedTestEnv(process.env) })
  process.exit(result.status ?? 1)
}
