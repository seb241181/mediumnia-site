import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = new URL('..', import.meta.url).pathname
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function filesIn(dir, keep) {
  const out = []
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesIn(rel, keep))
    else if (keep(rel)) out.push(rel)
  }
  return out
}

test('no public or functional reference to the former 597 € price remains', () => {
  const code = /\.(jsx?|mjs|ts|html)$/
  const files = [
    ...filesIn('src', (f) => code.test(f)),
    ...filesIn('lib', (f) => code.test(f)),
    ...filesIn('api', (f) => code.test(f)),
    ...filesIn('scripts', (f) => code.test(f)),
    ...filesIn('supabase/functions', (f) => code.test(f)),
    ...filesIn('public', (f) => f.endsWith('.html')),
  ]
  assert.ok(files.length > 100)
  const offenders = files.filter((f) => /597\s*€|597&nbsp;€|59700|597\.00|FORMATION_597/.test(read(f)))
  assert.deepEqual(offenders, [])
})

test('formation 397 €, conference offer 297 €, raffle prize 397 € everywhere they are shown', () => {
  assert.match(read('src/components/FormationPage.jsx'), /397 € · Rejoindre/)
  assert.match(read('public/cgv-formation.html'), /Formation complète est de <strong>397 € TTC/)
  assert.match(read('public/cgv-formation.html'), /solde est donc de <strong>368 € TTC/)
  assert.match(read('public/reglement-tirage-conference-mediumia-22-10-2026.html'), /valeur publique de 397 € TTC/)
  assert.match(read('src/components/ConferencesPage.jsx'), /: '397 €'/)
  assert.match(read('src/components/ConferencePassPage.jsx'), /normalAmountCents \|\| 39700/)
  assert.match(read('lib/conferencePassPayPal.js'), /NORMAL_AMOUNT_CENTS = 39700/)
  assert.match(read('supabase/functions/conference-public/index.ts'), /valeur 397 € TTC/)
})

test('the pricing migration is additive: event, raffle, pass fallback and site checkout', () => {
  const sql = read('supabase/migrations/20260925170000_tarif_formation_397_conference_297.sql')
  const executed = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.match(executed, /set pass_normal_amount_cents = 39700/)
  assert.match(executed, /alter column pass_normal_amount_cents set default 39700/)
  assert.match(executed, /check \(pass_normal_amount_cents = 39700\)/)
  assert.match(executed, /set pass_offer_amount_cents = 29700[\s\S]*where slug = 'premiere-conference-mediumia'/)
  assert.match(executed, /set prize_value_cents = 39700[\s\S]*r\.status <> 'drawn'/)
  assert.match(executed, /coalesce\(v_event\.pass_normal_amount_cents, 39700\)/)
  assert.match(executed, /product_code = 'full' and amount_cents in \(39700, 59700\)/)
  assert.doesNotMatch(executed, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i)
  // Outside the re-created pass function, only prices are touched: no access, no registration, no pass.
  const fnStart = executed.indexOf('create or replace function public.validate_conference_pass')
  const outside = executed.slice(0, fnStart) + executed.slice(executed.indexOf('$$;', fnStart))
  assert.doesNotMatch(outside, /mediumia_entitlements|conference_registrations|conference_passes/)
  assert.deepEqual([...outside.matchAll(/^update public\.(\w+)/gm)].map((m) => m[1]), ['conference_events', 'conference_events', 'conference_events', 'conference_raffles'])
})
