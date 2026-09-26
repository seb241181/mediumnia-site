/* global process */
// Répétition complète de la migration 20260926100000 sur un vrai PostgreSQL local
// (jamais la production). Chaque scénario crée sa propre base « p597_* ».
//
//   PGURL=postgresql://postgres@127.0.0.1:5432/postgres \
//   APP_MIGRATION=../mediumnia-app/supabase/migrations/20260925150000_parcours_personal_pdfs_and_founder.sql \
//   node supabase/runbooks/20260926-parcours-597/repetition/repetition.mjs
//
// Prérequis : un PostgreSQL local jetable, et le paquet « pg » (npm i --no-save pg).
import { readFileSync, existsSync } from 'node:fs'
import pg from 'pg'

const HERE = new URL('./', import.meta.url)
const SUPA = new URL('../../../', HERE)
const read = (rel) => readFileSync(new URL(rel, SUPA), 'utf8')
const MIG = read('migrations/20260926100000_formation_parcours_597.sql')
const OLD = read('archive/20260925120000_formation_parcours_mensuel.sql')
const CREDIT = read('migrations/20260926090000_decouverte_credit_568.sql')
const INTENTS = read('migrations/20260909133000_mediumia_paypal_order_intents.sql')
const RB = 'runbooks/20260926-parcours-597/'
const H00 = read(RB + '00-historique-migrations.sql')
const BEFORE = read(RB + '01-avant-migration.sql')
const AFTER = read(RB + '02-controle-apres-migration.sql')
const ROLLBACK = read(RB + '03-rollback.sql')
const BASE = readFileSync(new URL('base-type-production.sql', HERE), 'utf8')
const APP = process.env.APP_MIGRATION && existsSync(process.env.APP_MIGRATION) ? readFileSync(process.env.APP_MIGRATION, 'utf8') : null
const ADMIN = process.env.PGURL || 'postgresql://postgres@127.0.0.1:5432/postgres'
const U = { claire: '11111111-1111-4111-8111-111111111111', paul: '22222222-2222-4222-8222-222222222222' }

const opened = []
async function database(name, { credit = true } = {}) {
  const admin = new pg.Client({ connectionString: ADMIN })
  await admin.connect()
  await admin.query(`drop database if exists ${name}`)
  await admin.query(`create database ${name}`)
  await admin.end()
  const url = new URL(ADMIN); url.pathname = `/${name}`
  const c = new pg.Client({ connectionString: url.toString() })
  await c.connect()
  c.on('notice', () => {})
  opened.push(c)
  const db = {
    exec: async (sql) => { const r = await c.query(sql); return (Array.isArray(r) ? r : [r]).map((x) => ({ fields: x.fields || [], rows: x.rows || [] })) },
    query: (sql, params) => c.query(sql, params),
  }
  await db.exec(BASE)
  await db.exec(INTENTS)
  // Production aujourd'hui : le crédit 568 € est en place (appliqué à la main, sans historique).
  if (credit) await db.exec(CREDIT)
  return db
}

// Blocs d'un runbook, lancés un par un comme dans le SQL Editor : [label, lignes | erreur].
const blocks = (sql) => sql.split(/\n(?=-- [A-Z0-9]+\. )/).filter((b) => /\bselect\b/i.test(b.replace(/^--.*$/gm, '')))
async function runBlocks(db, sql) {
  const out = []
  for (const b of blocks(sql)) {
    const label = b.match(/^-- ([A-Z0-9]+)\./)?.[1] || '?'
    try { const res = await db.exec(b); out.push([label, res.filter((r) => r.fields.length).at(-1)?.rows]) } catch (e) { await db.exec('rollback').catch(() => null); out.push([label, `erreur: ${e.message.slice(0, 60)}`]) }
  }
  return Object.fromEntries(out)
}
const allTrue = (row) => Object.values(row || {}).every((v) => v === true)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let ok = true
const check = (cond, label) => { console.log(`  ${cond ? '✓' : '✗ ÉCHEC'} ${label}`); ok = ok && cond; return cond }
const tryIt = async (db, label, sql, want) => {
  let got
  try { await db.exec(sql); got = 'accepté' } catch { await db.exec('rollback').catch(() => null); got = 'refusé' }
  return check(got === want, `${label} : ${got}`)
}

// Catalogue de tout ce que crée une migration du parcours (pour comparer deux bases).
async function catalogue(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => Object.values(r).join(' '))
  const T = "('mediumia_formation_payments','mediumia_formation_subscriptions','mediumia_formation_unlock_orders','mediumia_paypal_plans')"
  return {
    tables: await q(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ${T} order by 1`),
    colonnes: await q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '-') from information_schema.columns where table_schema = 'public' and table_name in ${T} order by table_name, ordinal_position`),
    index: await q(`select indexdef from pg_indexes where schemaname = 'public' and tablename in ${T} order by 1`),
    regles_hors_montants: await q(`select conrelid::regclass::text, contype::text, pg_get_constraintdef(oid) from pg_constraint where conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and (relname in ${T} or relname = 'mediumia_entitlements')) and not (contype = 'c' and pg_get_constraintdef(oid) ~ '(step_cents|final_cents|regular_count|amount_cents >= 1)') order by 1, 3`),
    policies: await q(`select tablename, policyname from pg_policies where tablename in ${T} order by 1, 2`),
    droits: await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in ${T} and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role') order by 1, 2, 3`),
    fonction: await q(`select pg_get_functiondef(oid) from pg_proc where proname = 'mediumia_set_path_entitlement'`),
    fonction_droits: await q(`select r, has_function_privilege(r, 'public.mediumia_set_path_entitlement(uuid,text,integer,timestamptz)', 'execute') from unnest(array['anon','authenticated','service_role']) r`),
    registre_recopie: await q(`select user_id, paypal_env, kind, amount_cents, value_cents, paypal_ref from public.mediumia_formation_payments order by paypal_ref`),
  }
}
const montants = async (db) => (await db.query(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where contype = 'c' and conrelid in ('public.mediumia_formation_subscriptions'::regclass, 'public.mediumia_formation_unlock_orders'::regclass) and pg_get_constraintdef(oid) ~ '(step_cents|final_cents|regular_count|amount_cents >= 1)' order by 1, 2`)).rows.map((r) => `${r.t} ${r.d}`)

console.log('=== 0. ÉQUIVALENCE : 20260926100000 recrée tout ce que 20260925120000 aurait créé ===')
const dbOld = await database('p597_ancienne')
await dbOld.exec(OLD)
const dbNew = await database('p597_nouvelle')
await dbNew.exec(MIG)
const cOld = await catalogue(dbOld)
const cNew = await catalogue(dbNew)
for (const k of Object.keys(cOld)) check(same(cOld[k], cNew[k]), `${k} identiques (${cOld[k].length} élément(s))`)
console.log('  seules différences voulues, les règles de montant :')
for (const r of await montants(dbOld)) console.log('    ancienne :', r)
for (const r of await montants(dbNew)) console.log('    597      :', r)

console.log('\n=== 1. BASE COMME LA PRODUCTION (crédit 568 appliqué à la main, parcours absent) ===')
const db = await database('p597_production')
const h = await runBlocks(db, H00)
console.log('  00-A historique :', JSON.stringify(h.A), '| 00-B :', typeof h.B === 'string' ? h.B : JSON.stringify(h.B))
check(allTrue(h.D?.[0]), `00-D crédit en place : ${JSON.stringify(h.D?.[0])}`)
check(Object.values(h.E?.[0] || {}).every((v) => v === null || v === false), `00-E ancien parcours absent : ${JSON.stringify(h.E?.[0])}`)
check(Object.values(h.G?.[0] || {}).every((v) => v === false), `00-G migration espace élève pas encore appliquée : ${JSON.stringify(h.G?.[0])}`)
check(allTrue(h.F?.[0]), `00-F dépendances de 20260925150000 présentes : ${JSON.stringify(h.F?.[0])}`)
const pre = await runBlocks(db, BEFORE)
console.log('  01-A :', JSON.stringify(pre.A[0]), '| 01-D :', JSON.stringify(pre.D[0]))
await db.exec(MIG); console.log('  migration 20260926100000 : OK')
const post = await runBlocks(db, AFTER)
check(allTrue(post['1'][0]), `02-1 synthèse : ${allTrue(post['1'][0]) ? 'tout true' : JSON.stringify(post['1'][0])}`)
check(post['4'].length === 0, '02-4 aucun élève au-delà de 597 € (paiements réels)')
check(same(pre.G, post['5']), '02-5 empreintes achats / commandes / droits identiques')
await db.exec(MIG)
check(allTrue((await runBlocks(db, AFTER))['1'][0]), 'relance de la migration : sans effet, synthèse vraie')
await db.exec(OLD)
const afterOld = await runBlocks(db, AFTER)
check(allTrue(afterOld['1'][0]) && same(pre.G, afterOld['5']), 'ancienne migration 34 € lancée PAR ERREUR ensuite : aucun effet')

console.log('\n=== 2. RÈGLES DE MONTANT ===')
const sub = (id, env, n, step, fin) => `insert into public.mediumia_formation_subscriptions (paypal_subscription_id, user_id, paypal_env, paypal_plan_id, regular_count, step_cents, final_cents, status, terms_version, terms_accepted_at) values ('${id}', '${U.claire}', '${env}', 'P-1', ${n}, ${step}, ${fin}, 'cancelled', 'v2', now())`
await tryIt(db, 'abonnement live 11 × 48 € + 40 € (568 €)', sub('I-A1', 'live', 11, 4800, 4000), 'accepté')
await tryIt(db, 'abonnement live 3 × 48 € + 40 € (reprise)', sub('I-A2', 'live', 3, 4800, 4000), 'accepté')
await tryIt(db, 'abonnement live 12 × 48 €', sub('I-B1', 'live', 12, 4800, 2100), 'refusé')
await tryIt(db, 'abonnement live 11 × 48 € + 48 € (576 €)', sub('I-B2', 'live', 11, 4800, 4800), 'refusé')
await tryIt(db, 'abonnement live à 34 € (ancien modèle)', sub('I-B3', 'live', 10, 3400, 2800), 'refusé')
await tryIt(db, 'abonnement live à 49 €', sub('I-B4', 'live', 10, 4900, 4000), 'refusé')
await tryIt(db, 'abonnement Sandbox ancien modèle 34 € (essais conservés)', sub('I-S1', 'sandbox', 10, 3400, 2800), 'accepté')
await tryIt(db, 'dernière mensualité à 0 €', sub('I-B5', 'live', 11, 4800, 0), 'refusé')
const unl = (id, cents) => `insert into public.mediumia_formation_unlock_orders (paypal_order_id, user_id, paypal_env, amount_cents, terms_version, terms_accepted_at) values ('${id}', '${U.claire}', 'live', ${cents}, 'v2', now())`
await tryIt(db, 'tout débloquer 568 €', unl('U1', 56800), 'accepté')
await tryIt(db, 'tout débloquer 40 €', unl('U2', 4000), 'accepté')
await tryIt(db, 'tout débloquer 569 €', unl('U3', 56900), 'refusé')
await tryIt(db, 'tout débloquer 597 € (Découverte déjà payée)', unl('U4', 59700), 'refusé')
const pay = (ref, kind, cents) => `insert into public.mediumia_formation_payments (user_id, paypal_env, kind, amount_cents, value_cents, paypal_ref, paid_at) values ('${U.claire}', 'live', '${kind}', ${cents}, ${cents}, '${ref}', now())`
await tryIt(db, 'paiement mensuel 48 €', pay('T-1', 'monthly', 4800), 'accepté')
await tryIt(db, 'même paiement PayPal enregistré deux fois', pay('T-1', 'monthly', 4800), 'refusé')
await tryIt(db, 'deux abonnements vivants pour le même élève', `${sub('I-L1', 'live', 11, 4800, 4000).replace("'cancelled'", "'active'")}; ${sub('I-L2', 'live', 11, 4800, 4000).replace("'cancelled'", "'approval_pending'")}`, 'refusé')
const fn = (max) => `select public.mediumia_set_path_entitlement('${U.claire}', 'live', ${max}, now() + interval '12 months')`
await db.exec(fn(3)); await db.exec(fn(5))
const row = (await db.query(`select access_level, max_module, count(*) over () n from public.mediumia_entitlements where origin_ref = 'parcours:live:${U.claire}'`)).rows[0]
check(row.max_module === 5 && Number(row.n) === 1, `droit « parcours » : une seule ligne, ${row.access_level}, module ${row.max_module}`)
const priv = (await db.query(`select has_function_privilege('anon', 'public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz)', 'execute') a, has_function_privilege('authenticated', 'public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz)', 'execute') b`)).rows[0]
check(!priv.a && !priv.b, 'fonction interdite aux visiteurs et aux élèves (serveur seulement)')
try { await db.exec(ROLLBACK); check(false, 'garde-fou du rollback') } catch (e) { await db.exec('rollback'); check(/rollback_refuse/.test(e.message), `rollback refusé après usage : ${e.message.slice(0, 50)}`) }

console.log('\n=== 3. ANCIENNE MIGRATION 34 € DÉJÀ PASSÉE (cas imprévu) ===')
const dbo = await database('p597_ancienne_passee')
await dbo.exec(OLD)
await dbo.exec(`insert into public.mediumia_formation_subscriptions (paypal_subscription_id, user_id, paypal_env, paypal_plan_id, regular_count, step_cents, final_cents, status, terms_version, terms_accepted_at) values ('I-OLD', '${U.paul}', 'sandbox', 'P-0', 10, 3400, 2800, 'cancelled', 'v1', now())`)
const preo = await runBlocks(dbo, BEFORE)
console.log('  01-B :', JSON.stringify(preo.B[0]))
await dbo.exec(MIG)
const posto = await runBlocks(dbo, AFTER)
check(allTrue(posto['1'][0]) && same(preo.G, posto['5']), 'migration 597 par-dessus : synthèse vraie, empreintes identiques')
check(same(await montants(dbo), await montants(dbNew)), 'règles de montant = celles d’une base neuve')
await tryIt(dbo, 'abonnement live 11 × 48 € + 40 €', sub('I-N1', 'live', 11, 4800, 4000), 'accepté')
await tryIt(dbo, 'abonnement live à 34 €', sub('I-N2', 'live', 10, 3400, 2800), 'refusé')

console.log('\n=== 4. ROLLBACK (base neuve, avant tout usage) ===')
const db2 = await database('p597_rollback')
const pre2 = await runBlocks(db2, BEFORE)
const scope = async (d) => (await d.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'mediumia_entitlements_level_scope_check'`)).rows[0].d
const scopeBefore = await scope(db2)
await db2.exec(MIG); await db2.exec(ROLLBACK)
const back = await runBlocks(db2, BEFORE)
check(same(back.A, pre2.A) && same(back.G, pre2.G) && (await scope(db2)) === scopeBefore, 'tables retirées, règle des droits d’origine, empreintes identiques')
await db2.exec(MIG)
check(allTrue((await runBlocks(db2, AFTER))['1'][0]), 'migration relancée après rollback, synthèse vraie')

console.log('\n=== 5. ATOMICITÉ ===')
const db3 = await database('p597_atomicite')
await db3.exec(`alter table public.mediumia_entitlements drop constraint mediumia_entitlements_level_scope_check;
  insert into public.mediumia_entitlements (user_id, type, origin_ref, access_started_at, access_expires_at, access_level, max_module) values ('${U.paul}', 'trial', 'weird', now(), now(), 'discovery', 3)`)
try { await db3.exec(MIG); check(false, 'migration refusée') } catch (e) { await db3.exec('rollback'); console.log('  migration refusée en fin de parcours :', e.message.slice(0, 70)) }
const left = (await db3.query(`select to_regclass('public.mediumia_formation_payments') t, (select count(*)::int from pg_proc where proname = 'mediumia_set_path_entitlement') f`)).rows[0]
check(left.t === null && left.f === 0, 'rien de créé (tables, fonction)')

console.log('\n=== 6. MIGRATION ESPACE ÉLÈVE 20260925150000 ===')
if (!APP) console.log('  (APP_MIGRATION non fourni : scénario ignoré)')
else {
  const refs = [...new Set(APP.match(/mediumia_formation_\w+|mediumia_set_path_entitlement|mediumia_paypal_\w+/g) || [])]
  check(refs.length === 0, `aucune dépendance aux objets du parcours ni aux paiements (${refs.join(', ') || 'aucune'})`)
  for (const [label, order] of [['avant la 597', [APP, MIG]], ['après la 597', [MIG, APP]]]) {
    const d = await database(`p597_app_${label.startsWith('avant') ? 'avant' : 'apres'}`)
    for (const sql of order) await d.exec(sql)
    await d.exec(APP)
    const fns = (await d.query(`select string_agg(proname, ', ' order by proname) f from pg_proc where proname in ('mediumia_grant_founder', 'mediumia_parcours_opening_transition', 'mediumia_set_path_entitlement')`)).rows[0].f
    check(fns === 'mediumia_grant_founder, mediumia_parcours_opening_transition, mediumia_set_path_entitlement', `lancée ${label} puis relancée : OK (${fns})`)
    const g = (await d.query(`select public.mediumia_grant_founder('owner@example.test') r`)).rows[0].r.status
    const t = (await d.query(`select public.mediumia_parcours_opening_transition(now()) r`)).rows[0].r.status
    check(g === 'founder_granted' && t === 'dry_run', `Fondatrice : ${g} ; transition à blanc : ${t}`)
  }
}

for (const c of opened) await c.end()
console.log('\nRÉSULTAT GLOBAL :', ok ? 'TOUT CONFORME' : 'ÉCHEC')
process.exitCode = ok ? 0 : 1
