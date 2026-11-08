/* global process */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const guard = await import('../lib/environmentGuard.js')
const { browserDatabaseAllowed } = await import('../src/lib/browserDatabaseGuard.js')
const { runtimeRdvDepositPayPalConfig, runtimeRdvRefundPayPalConfig } = await import('../lib/rdvDepositPayPal.js')
const { runtimeRdvBalancePayPalConfig } = await import('../lib/rdvBalancePayPal.js')
const { __paypalFormationTest } = await import('../lib/paypalSandbox.js')
const { emailQuestionEnv } = await import('../lib/emailQuestions.js')
const { pathEnv } = await import('../lib/formationPath.js')
const { __conferencePassPayPalTest } = await import('../lib/conferencePassPayPal.js')
const { __giftCardsPaypalEnvForTest } = await import('../lib/giftCards.js')

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const PROD_URL = 'https://uotkpygeqqnekpolezts.supabase.co'
const TEST_URL = 'https://wnbwhnqiulsdjcvkuwos.supabase.co'

// Variables de la vraie Production (valeurs factices pour les clés).
const PRODUCTION = {
  VERCEL_ENV: 'production', SUPABASE_URL: PROD_URL, VITE_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: 'x',
  PAYPAL_ENV: 'live', PAYPAL_RDV_DEPOSIT_ENV: 'live', PAYPAL_RDV_DEPOSIT_ENABLED: 'true', PAYPAL_RDV_REFUNDS_ENABLED: 'true',
  PAYPAL_FORMATION_ENABLED: 'true', PAYPAL_CONFERENCE_PASS_ENABLED: 'true', PAYPAL_GIFT_CARDS_ENABLED: 'true',
}
// Préversion actuelle : reliée à la base de Production (le défaut à corriger).
const PREVIEW_ON_PRODUCTION = { VERCEL_ENV: 'preview', SUPABASE_URL: PROD_URL, VITE_SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: 'x' }
// Préversion après bascule : reliée à TEST.
const PREVIEW_ON_TEST = { VERCEL_ENV: 'preview', SUPABASE_URL: TEST_URL, VITE_SUPABASE_URL: TEST_URL, SUPABASE_SERVICE_ROLE_KEY: 'x' }
// Production mal configurée : reliée à TEST.
const PRODUCTION_ON_TEST = { ...PRODUCTION, SUPABASE_URL: TEST_URL, VITE_SUPABASE_URL: TEST_URL }

const KEYS = ['VERCEL_ENV', 'MEDIUMIA_ISOLATED_TEST', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_ENV', 'PAYPAL_RDV_DEPOSIT_ENV',
  'PAYPAL_RDV_DEPOSIT_ENABLED', 'PAYPAL_RDV_REFUNDS_ENABLED', 'PAYPAL_FORMATION_ENABLED', 'PAYPAL_CONFERENCE_PASS_ENABLED', 'PAYPAL_GIFT_CARDS_ENABLED']

function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, values)
  guard.resetEnvironmentGuardLogForTests()
  const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
  try { return fn() } finally { restore() }
}

// Toutes les portes d'entrée financières hors ChronoSphère (chantier Codex).
const PAYMENT_ENTRY_POINTS = {
  'arrhes RDV': () => runtimeRdvDepositPayPalConfig().env,
  'solde RDV': () => runtimeRdvBalancePayPalConfig().env,
  'remboursement RDV': () => runtimeRdvRefundPayPalConfig(process.env).env,
  'Formation complète': () => __paypalFormationTest.runtimeConfig(null, 'full').env,
  'Formation Découverte': () => __paypalFormationTest.runtimeConfig(null, 'discovery').env,
  'Guidance e-mail': () => emailQuestionEnv(),
  'Parcours mensuel': () => pathEnv(),
  'Pass conférence': () => __conferencePassPayPalTest.runtimeConfig(49900).env,
  'Cartes cadeaux': () => __giftCardsPaypalEnvForTest(),
}

test('Production réelle : tous les paiements PayPal Live restent possibles', () => {
  withEnv(PRODUCTION, () => {
    for (const [name, entry] of Object.entries(PAYMENT_ENTRY_POINTS)) {
      assert.equal(entry(), 'live', `${name} doit rester en Live`)
    }
    assert.deepEqual(guard.checkDatabaseAccess(process.env), { ok: true, tier: 'production', target: 'production' })
  })
})

test('préversion reliée à la Production : aucun paiement, aucun droit, aucune base', () => {
  withEnv(PREVIEW_ON_PRODUCTION, () => {
    for (const [name, entry] of Object.entries(PAYMENT_ENTRY_POINTS)) {
      let result
      try { result = entry() } catch (error) {
        assert.equal(error.code || error.message, 'non_production_must_not_use_production_database', name)
        continue
      }
      assert.equal(result, null, `${name} doit être fermé (pas d'environnement PayPal)`)
    }
    assert.equal(guard.checkDatabaseAccess(process.env).code, 'non_production_must_not_use_production_database')
  })
})

test('préversion reliée à TEST : paiements Sandbox autorisés', () => {
  withEnv(PREVIEW_ON_TEST, () => {
    for (const [name, entry] of Object.entries(PAYMENT_ENTRY_POINTS)) {
      assert.equal(entry(), 'sandbox', `${name} doit fonctionner en Sandbox sur TEST`)
    }
  })
})

test('Production reliée à TEST : tout est refusé (jamais d’argent réel vers une base de test)', () => {
  withEnv(PRODUCTION_ON_TEST, () => {
    for (const [name, entry] of Object.entries(PAYMENT_ENTRY_POINTS)) {
      let result
      try { result = entry() } catch (error) {
        assert.equal(error.code || error.message, 'production_requires_production_database', name)
        continue
      }
      assert.equal(result, null, name)
    }
  })
})

test('matrice niveau × base : seules les combinaisons cohérentes passent', () => {
  const cases = [
    [{ VERCEL_ENV: 'production' }, PROD_URL, true],
    [{ VERCEL_ENV: 'production' }, TEST_URL, false],
    [{ VERCEL_ENV: 'production' }, 'https://autre.supabase.co', false],
    [{ VERCEL_ENV: 'production' }, 'https://api.mediumia.fr', false],
    [{ VERCEL_ENV: 'preview' }, TEST_URL, true],
    [{ VERCEL_ENV: 'preview' }, PROD_URL, false],
    [{ VERCEL_ENV: 'preview' }, 'https://api.mediumia.fr', false],
    [{ VERCEL_ENV: 'development' }, PROD_URL, false],
    [{ VERCEL_ENV: 'development' }, 'http://127.0.0.1:54321', true],
    [{ MEDIUMIA_ISOLATED_TEST: 'true', VERCEL_ENV: 'production' }, TEST_URL, true],
    [{ MEDIUMIA_ISOLATED_TEST: 'true', VERCEL_ENV: 'production' }, PROD_URL, false],
    [{}, PROD_URL, false],
    [{}, 'https://fake.supabase.test', true],
  ]
  for (const [env, url, expected] of cases) {
    assert.equal(guard.checkDatabaseAccess(env, url).ok, expected, `${JSON.stringify(env)} → ${url}`)
  }
})

test('projet de test isolé déployé en « production » : paiements refusés (Live interdit sur TEST)', () => {
  withEnv({ ...PRODUCTION_ON_TEST, MEDIUMIA_ISOLATED_TEST: 'true' }, () => {
    assert.throws(() => runtimeRdvDepositPayPalConfig(), { code: 'non_production_requires_paypal_sandbox' })
    assert.equal(guard.checkPaymentEnvironment('sandbox').ok, true)
  })
})

test('client Supabase serveur : jamais créé vers la mauvaise base', async () => {
  const supabaseAdmin = await import('../lib/supabaseAdmin.js?preview-on-production')
  withEnv(PREVIEW_ON_PRODUCTION, () => {
    assert.equal(supabaseAdmin.isSupabaseConfigured(), false, 'les routes répondent « configuration requise »')
    assert.throws(() => supabaseAdmin.getSupabaseAdmin(), { name: 'EnvironmentMismatchError', code: 'non_production_must_not_use_production_database' })
  })
  const productionAdmin = await import('../lib/supabaseAdmin.js?production')
  withEnv(PRODUCTION, () => {
    assert.equal(productionAdmin.isSupabaseConfigured(), true)
    assert.ok(productionAdmin.getSupabaseAdmin(), 'la Production obtient son client')
  })
})

test('navigateur : une préversion ne se connecte jamais à la base de Production', () => {
  assert.equal(browserDatabaseAllowed(PROD_URL, 'production'), true)
  assert.equal(browserDatabaseAllowed(PROD_URL, 'preview'), false)
  assert.equal(browserDatabaseAllowed(PROD_URL, 'local'), false)
  assert.equal(browserDatabaseAllowed(TEST_URL, 'preview'), true)
  assert.equal(browserDatabaseAllowed(TEST_URL, 'production'), false)
  const vite = read('vite.config.js')
  assert.match(vite, /'import\.meta\.env\.VITE_MEDIUMIA_DEPLOY_TIER'/)
  assert.match(read('src/lib/supabase.js'), /browserDatabaseAllowed\(supabaseUrl, deployTier\)/)
})

test('diagnostic d’environnement : utile et sans secret', () => {
  const secret = 'sk-ne-doit-jamais-apparaitre'
  const report = guard.environmentReport({ ...PRODUCTION, SUPABASE_SERVICE_ROLE_KEY: secret, PAYPAL_CLIENT_SECRET: secret })
  assert.deepEqual(report, { tier: 'production', database: { server: 'production', browser: 'production' }, paypal_expected: 'live', consistent: true, problems: [] })
  assert.ok(!JSON.stringify(report).includes(secret))
  assert.ok(!JSON.stringify(report).includes('uotkpygeqqnekpolezts'), 'pas même l’identifiant du projet')
  const preview = guard.environmentReport({ ...PREVIEW_ON_PRODUCTION, PAYPAL_ENV: 'live' })
  assert.equal(preview.consistent, false)
  assert.deepEqual(preview.problems, ['server_non_production_must_not_use_production_database', 'browser_non_production_must_not_use_production_database', 'paypal_configuration_mismatch'])
  assert.match(read('api/rdv-config.js'), /req\.query\?\.environmentCheck/)
})

test('inventaire : tout accès Supabase du serveur passe par la garde', () => {
  const files = [...fs.readdirSync(new URL('../api', import.meta.url)).map(f => `api/${f}`), ...fs.readdirSync(new URL('../lib', import.meta.url)).map(f => `lib/${f}`)]
    .filter(f => f.endsWith('.js'))
  const creators = files.filter(f => /createClient\(/.test(read(f)))
  assert.deepEqual(creators.sort(), ['api/agent-chat.js', 'lib/supabaseAdmin.js'])
  assert.match(read('lib/supabaseAdmin.js'), /assertDatabaseAccess\(process\.env, url, 'supabase-admin'\)/)
  assert.match(read('api/agent-chat.js'), /checkDatabaseAccess\(process\.env, supabaseUrl\)\.ok/)
  const directRest = files.filter(f => /\/rest\/v1|\/auth\/v1\/admin/.test(read(f)))
  assert.deepEqual(directRest, [], 'aucun appel REST Supabase direct')
})

test('inventaire : chaque module de paiement (hors ChronoSphère) applique la garde', () => {
  for (const file of ['lib/rdvDepositPayPal.js', 'lib/rdvBalancePayPal.js', 'lib/paypalSandbox.js', 'lib/emailQuestions.js', 'lib/formationPath.js', 'lib/conferencePassPayPal.js', 'lib/giftCards.js']) {
    assert.match(read(file), /from '\.\/environmentGuard\.js'/, file)
  }
  assert.doesNotMatch(read('lib/chronospherePayPal.js'), /environmentGuard/, 'fichier ChronoSphère non modifié (chantier Codex)')
})

test('migration SQL : additive, ChronoSphère exclue, retour arrière confirmé explicitement', () => {
  const sql = read('supabase/migrations/20261108130000_environment_separation_guard.sql')
  const rollback = read('supabase/runbooks/20261108-environment-separation/retour-arriere.sql')
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|TRUNCATE|UPDATE public\./i, 'aucune donnée modifiée')
  assert.doesNotMatch(sql, /INSERT INTO public\.mediumia_runtime_environment/, 'activation séparée de la migration')
  assert.doesNotMatch(sql.split('payment_tables TEXT[]')[1].split('];')[0], /chronosphere|oracle_timeline/)
  assert.match(rollback, /mediumia\.confirm_guard_removal/)
  assert.match(read('supabase/runbooks/20261108-environment-separation/activer-production.sql'), /pas_la_base_de_production/)
  assert.match(read('supabase/runbooks/20261108-environment-separation/activer-test.sql'), /base_de_production_detectee/)
})
