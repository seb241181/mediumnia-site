import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registrationSource } from '../src/lib/conferenceApi.js'

test('registration records which network the visitor came from', () => {
  assert.equal(registrationSource(''), 'conference_page')
  assert.equal(registrationSource('?utm_source=facebook&utm_medium=social'), 'conference_page:facebook')
  assert.equal(registrationSource('?utm_source=Instagram'), 'conference_page:instagram')
  assert.equal(registrationSource('?utm_source=<script>'), 'conference_page:script')
  assert.ok(registrationSource(`?utm_source=${'a'.repeat(200)}`).length <= 'conference_page:'.length + 40)
})

test('the registration form only calls state setters that exist', () => {
  const page = fs.readFileSync(new URL('../src/components/ConferencesPage.jsx', import.meta.url), 'utf8')
  const declared = new Set([...page.matchAll(/const \[\w+, (set\w+)\] = useState/g)].map((m) => m[1]))
  const called = new Set([...page.matchAll(/\b(set[A-Z]\w+)\(/g)].map((m) => m[1]))
  const missing = [...called].filter((name) => !declared.has(name))
  assert.deepEqual(missing, [], `undefined setters: ${missing.join(', ')}`)
  assert.match(page, /source: registrationSource\(window\.location\.search\)/)
})

test('the conference page shares its own visual and event title', async () => {
  const { buildPages } = await import('../scripts/prerender-route-meta.mjs')
  const shell = '<html><head><title>x</title></head><body></body></html>'
  const pages = buildPages(shell, { home: { title: 'H', description: 'h' }, conferences: { title: 'Conférence offerte le 22 octobre', description: 'd' } }, [])
  const conf = pages.find((p) => p.file === 'conferences/index.html').html
  assert.match(conf, /og:image" content="https:\/\/mediumia\.fr\/images\/conference\/conference-22-octobre-partage-397\.jpg"/)
  assert.match(conf, /og:image:width" content="1200"/)
  assert.match(conf, /og:image:height" content="630"/)
  assert.match(conf, /og:image:alt" content="Conférence offerte MediumIA/)
  assert.ok(fs.existsSync(new URL('../public/images/conference/conference-22-octobre-partage-397.jpg', import.meta.url)))
})

test('draw rules exclude the organizer household and give a reachable contact', () => {
  const rules = fs.readFileSync(new URL('../public/reglement-tirage-conference-mediumia-22-10-2026.html', import.meta.url), 'utf8')
  assert.match(rules, /Ne peuvent pas gagner : l’organisateur, les membres de son foyer/)
  assert.match(rules, /Contact : contact@mediumia\.fr\./)
  assert.match(rules, /sans obligation d’achat/)
})

test('the conference is on Thursday 22 October everywhere, and the e-mail reads the date from the event', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const fn = read('supabase/functions/conference-public/index.ts')
  assert.doesNotMatch(fn, /Vendredi 23 octobre/)
  assert.doesNotMatch(fn, /Accès au direct du 23 octobre/)
  assert.doesNotMatch(fn, /Conference_23-10-2026\.pdf/)
  assert.match(fn, /const dateLabel = eventDateLabel\(event\)/)
  for (const file of ['src/components/ConferencesPage.jsx', 'src/components/ConferenceLivePage.jsx', 'scripts/apply-route-seo-cro.mjs', 'public/reglement-tirage-conference-mediumia-22-10-2026.html']) {
    assert.doesNotMatch(read(file).replace(/initialement prévue le vendredi 23 octobre/, ''), /23 octobre/i, file)
  }
  const migration = read('supabase/migrations/20260924200000_conference_date_22_octobre.sql')
  assert.match(migration, /starts_at = starts_at - interval '1 day'/)
  assert.match(migration, /r\.status <> 'drawn'/)
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(vercel.redirects.some((r) => r.source.includes('23-10-2026') && r.destination.includes('22-10-2026')))
})
