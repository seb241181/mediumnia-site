import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('every response carries the security headers and hashed assets are cached for good', () => {
  const vercel = JSON.parse(read('vercel.json'))
  const all = vercel.headers.find((rule) => rule.source === '/(.*)')
  const keys = Object.fromEntries(all.headers.map((h) => [h.key, h.value]))
  assert.equal(keys['X-Content-Type-Options'], 'nosniff')
  assert.equal(keys['X-Frame-Options'], 'SAMEORIGIN')
  assert.equal(keys['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.match(keys['Permissions-Policy'], /camera=\(\)/)
  const assets = vercel.headers.find((rule) => rule.source === '/assets/(.*)')
  assert.match(assets.headers[0].value, /immutable/)
})

test('MAX timeline memory is read-only from the browser (server writes with service role)', () => {
  const sql = read('supabase/migrations/20260923170000_chronosphere_max_timeline_client_readonly.sql')
  assert.match(sql, /revoke insert, update, delete on table public\.chronosphere_timelines from authenticated/)
  assert.match(sql, /revoke insert, update, delete on table public\.chronosphere_timeline_entries from authenticated/)
  assert.doesNotMatch(sql, /revoke[^;]*select/)
})

test('MAX page speaks to customers, not in engineering terms', () => {
  const page = read('src/components/ChronosphereMaxPage.jsx')
  assert.doesNotMatch(page, /fixture actuelle/)
  assert.doesNotMatch(page, /comparaison déterministe/)
  assert.doesNotMatch(page, /snapshots comparés|Snapshots compacts|ajoute un snapshot/)
  assert.doesNotMatch(page, />V2</)
  assert.match(page, /function readableFact/)
})

test('home hero has no dock anymore and offers booking directly', () => {
  const hero = read('src/components/CosmicLibraryHero.jsx')
  assert.deepEqual([...hero.matchAll(/\{ label: '([^']+)'/g)].map((m) => m[1]), [])
  assert.match(hero, /className="cosmic-library__secondary" href="#consulter"/)
})

test('floating account button stays compact on phones', () => {
  const account = read('src/components/GlobalAccount.jsx')
  assert.match(account, /<span className="hidden sm:inline">/)
  assert.match(read('src/index.css'), /#root::after \{ content: ''; display: block; height: 84px; \}/)
})

test('booking flow helps on mobile and after confirmation', () => {
  const page = read('src/components/rdv/RdvPublic.jsx')
  assert.match(page, /Prochaine disponibilité/)
  assert.match(page, /autoComplete="given-name"/)
  assert.match(page, /Ajouter à mon agenda/)
  assert.match(page, /DTSTART;TZID=Europe\/Paris/)
  assert.match(page, /Array\.isArray\(result\?\.slots\)/)
  assert.match(page, /\{bookingError\} Choisissez un autre horaire\./)
})
