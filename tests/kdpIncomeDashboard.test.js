import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('KDP monthly income schema separates generated royalties from payouts', () => {
  const migration = read('supabase/migrations/20260918212000_kdp_income_reports.sql')
  assert.match(migration, /create table if not exists public\.kdp_income_reports/i)
  assert.match(migration, /paperback_units/)
  assert.match(migration, /ebook_units/)
  assert.match(migration, /royalty_cents/)
  assert.match(migration, /payout_status/)
  assert.match(migration, /estimated/)
  assert.match(migration, /paid/)
  assert.match(migration, /service_role/)
})

test('finance summary reads KDP without mixing pending royalties into RDV TTC', () => {
  const script = read('scripts/apply-rdv-accounting-dashboard.mjs')
  assert.match(script, /\.from\('kdp_income_reports'\)/)
  assert.match(script, /pending_royalty_cents/)
  assert.match(script, /activity_generated_cents/)
  assert.match(script, /Number\(totals\.gross_cents \|\| 0\) \+ Number\(kdp\.royalty_cents \|\| 0\)/)
})

test('accounting UI exposes KDP units, royalties and activity generated separately', () => {
  const component = read('src/components/rdv/AccountingSection.jsx')
  assert.match(component, /KDP généré/)
  assert.match(component, /Activité générée/)
  assert.match(component, /Livres · Amazon KDP/)
  assert.match(component, /Redevances générées/)
  assert.match(component, /Cotisations Urssaf AA/)
  assert.match(component, /Net après cotisations/)
  assert.match(component, /12,30 %/)
  assert.match(component, /ARTIST_AUTHOR_MICRO_BNC_ABATEMENT = 0\.34/)
  assert.match(component, /ARTIST_AUTHOR_SOCIAL_BASE_MULTIPLIER = 1\.15/)
  assert.match(component, /ARTIST_AUTHOR_URSSAF_RATE = 0\.162/)
  assert.match(component, /IRCEC-RAAP/)
  assert.match(component, /À recevoir Amazon/)
  assert.match(component, /ne sont pas ajoutées au « TTC encaissé »/)
})


test('KDP dashboard can show reported sales before format and royalties are fully reconciled', () => {
  const migration = read('supabase/migrations/20260924113000_kdp_unclassified_units.sql')
  const script = read('scripts/apply-rdv-accounting-dashboard.mjs')
  const component = read('src/components/rdv/AccountingSection.jsx')
  assert.match(migration, /unclassified_units/)
  assert.match(script, /unclassified_units/)
  assert.match(script, /kdp\.paperback_units \+ kdp\.ebook_units \+ kdp\.hardcover_units \+ kdp\.unclassified_units/)
  assert.match(component, /à ventiler/)
  assert.match(component, /redevances correspondantes restent à compléter/)
})
