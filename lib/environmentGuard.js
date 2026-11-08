/* global process */
/**
 * Séparation TEST / PRODUCTION (garde serveur).
 *
 * Règle : chaque déploiement n'écrit que dans la base de son environnement,
 * et une opération financière n'a lieu que si le couple (base, PayPal) est cohérent.
 *
 *   Production (VERCEL_ENV=production)         → base PRODUCTION + PayPal Live, uniquement
 *   Préversion / staging (VERCEL_ENV=preview)  → base TEST + PayPal Sandbox, uniquement
 *   Projet de test isolé (MEDIUMIA_ISOLATED_TEST=true, quel que soit VERCEL_ENV)
 *                                              → base TEST + PayPal Sandbox, uniquement
 *   Poste local / tests (pas de VERCEL_ENV)    → tout sauf la base PRODUCTION
 *
 * La garde échoue fermée : en cas d'incohérence, aucune requête n'est envoyée à
 * Supabase et aucun paiement n'est créé ni capturé. Les identifiants de projet
 * Supabase ne sont pas secrets (ils figurent dans l'URL publique) ; aucune clé
 * n'est lue ni journalisée ici.
 */

export const SUPABASE_PROJECTS = Object.freeze({
  production: 'uotkpygeqqnekpolezts',
  test: 'wnbwhnqiulsdjcvkuwos',
})

export class EnvironmentMismatchError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = 'EnvironmentMismatchError'
    this.code = code
    this.status = 503
    this.details = details
  }
}

// Niveau d'exécution du déploiement courant.
export function deploymentTier(env = process.env) {
  if (String(env.MEDIUMIA_ISOLATED_TEST || '').trim() === 'true') return 'isolated_test'
  const vercelEnv = String(env.VERCEL_ENV || '').trim()
  if (vercelEnv === 'production') return 'production'
  if (vercelEnv === 'preview') return 'preview'
  if (vercelEnv === 'development') return 'development'
  return 'local'
}

// Base désignée par une URL Supabase : 'production' | 'test' | 'local' | 'other' | 'unconfigured'.
export function databaseTarget(url) {
  const raw = String(url || '').trim()
  if (!raw) return 'unconfigured'
  let host
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return 'other'
  }
  if (host === `${SUPABASE_PROJECTS.production}.supabase.co`) return 'production'
  if (host === `${SUPABASE_PROJECTS.test}.supabase.co`) return 'test'
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local'
  return 'other'
}

// Bases autorisées pour chaque niveau. Une préversion n'accepte que TEST : une
// base de Production derrière un domaine inconnu ne peut pas contourner la garde.
// En Production, une base inconnue (« other ») n'est pas bloquée ici pour ne pas
// risquer d'interruption, mais le diagnostic la signale (server_unknown_database)
// et la procédure de bascule exige un diagnostic propre avant toute promotion.
// Production + base TEST est toujours refusé.
const ALLOWED_DATABASES = {
  production: new Set(['production', 'other']),
  preview: new Set(['test']),
  isolated_test: new Set(['test']),
  development: new Set(['test', 'local']),
  local: new Set(['test', 'local', 'other']),
}

const EXPECTED_PAYPAL = {
  production: 'live',
  preview: 'sandbox',
  isolated_test: 'sandbox',
  development: 'sandbox',
  local: 'sandbox',
}

export function checkDatabaseAccess(env = process.env, url = env.SUPABASE_URL) {
  const tier = deploymentTier(env)
  const target = databaseTarget(url)
  if (target === 'unconfigured') return { ok: false, tier, target, code: 'database_not_configured' }
  if (ALLOWED_DATABASES[tier].has(target)) return { ok: true, tier, target }
  const code = tier === 'production'
    ? 'production_requires_production_database'
    : target === 'production'
      ? 'non_production_must_not_use_production_database'
      : 'database_not_allowed_for_environment'
  return { ok: false, tier, target, code }
}

let lastLogged = null
function logRefusal(result, scope) {
  const key = `${scope}:${result.code}`
  if (lastLogged === key) return
  lastLogged = key
  // Codes seulement : ni URL, ni clé, ni donnée personnelle.
  console.error(`[environment-guard] ${scope} refused: ${result.code} (tier=${result.tier}, database=${result.target})`)
}

export function assertDatabaseAccess(env = process.env, url = env.SUPABASE_URL, scope = 'database') {
  const result = checkDatabaseAccess(env, url)
  if (!result.ok) {
    logRefusal(result, scope)
    throw new EnvironmentMismatchError(result.code, { tier: result.tier, database: result.target })
  }
  return result
}

/**
 * Cohérence d'une opération financière ou d'une attribution de droits.
 * `paypalEnv` est l'environnement PayPal que le module s'apprête à utiliser.
 * Une base non configurée ne bloque pas ici (aucune écriture possible) : seule
 * la cohérence PayPal / niveau est alors exigée.
 */
export function checkPaymentEnvironment(paypalEnv, env = process.env, url = env.SUPABASE_URL) {
  const tier = deploymentTier(env)
  const expected = EXPECTED_PAYPAL[tier]
  if (paypalEnv !== expected) {
    return { ok: false, tier, paypal: paypalEnv || null, code: tier === 'production' ? 'production_requires_paypal_live' : 'non_production_requires_paypal_sandbox' }
  }
  const database = checkDatabaseAccess(env, url)
  if (database.target === 'unconfigured') return { ok: true, tier, paypal: paypalEnv, target: 'unconfigured' }
  if (!database.ok) return { ...database, paypal: paypalEnv }
  return { ok: true, tier, paypal: paypalEnv, target: database.target }
}

export function assertPaymentEnvironment(paypalEnv, env = process.env, url = env.SUPABASE_URL, scope = 'payment') {
  const result = checkPaymentEnvironment(paypalEnv, env, url)
  if (!result.ok) {
    logRefusal(result, scope)
    throw new EnvironmentMismatchError(result.code, { tier: result.tier, paypal: result.paypal ?? null, database: result.target ?? null })
  }
  return result
}

/**
 * Diagnostic public, sans secret : sert à vérifier un déploiement (y compris un
 * déploiement de Production non encore promu) avant de lui confier du trafic.
 */
export function environmentReport(env = process.env) {
  const tier = deploymentTier(env)
  const server = checkDatabaseAccess(env, env.SUPABASE_URL)
  const browserUrl = env.VITE_SUPABASE_URL || ''
  const browser = browserUrl ? checkDatabaseAccess(env, browserUrl) : { ok: true, target: 'unconfigured' }
  const paypal = EXPECTED_PAYPAL[tier]
  const configuredPaypal = String(env.PAYPAL_ENV || '').trim().toLowerCase() || null
  const configuredDepositPaypal = String(env.PAYPAL_RDV_DEPOSIT_ENV || '').trim().toLowerCase() || null
  const unknownProductionDatabase = tier === 'production' && server.target === 'other'
  const paypalConfigConsistent = tier !== 'production'
    ? configuredPaypal !== 'live' && configuredDepositPaypal !== 'live'
    : (configuredPaypal === null || configuredPaypal === 'live') && (configuredDepositPaypal === null || configuredDepositPaypal === 'live')
  return {
    tier,
    database: { server: server.target, browser: browser.target },
    paypal_expected: paypal,
    consistent: server.ok && browser.ok && paypalConfigConsistent && !unknownProductionDatabase,
    problems: [
      ...(server.ok ? [] : [`server_${server.code}`]),
      ...(unknownProductionDatabase ? ['server_unknown_database'] : []),
      ...(browser.ok ? [] : [`browser_${browser.code}`]),
      ...(paypalConfigConsistent ? [] : ['paypal_configuration_mismatch']),
    ],
  }
}

export function resetEnvironmentGuardLogForTests() {
  lastLogged = null
}
