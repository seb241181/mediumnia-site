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
  const pages = buildPages(shell, { home: { title: 'H', description: 'h' }, conferences: { title: 'Conférence offerte le 23 octobre', description: 'd' } }, [])
  const conf = pages.find((p) => p.file === 'conferences/index.html').html
  assert.match(conf, /og:image" content="https:\/\/mediumia\.fr\/images\/conference\/conference-23-octobre-partage\.jpg"/)
  assert.match(conf, /og:image:width" content="1200"/)
  assert.match(conf, /og:image:height" content="630"/)
  assert.match(conf, /og:image:alt" content="Conférence offerte MediumIA/)
  assert.ok(fs.existsSync(new URL('../public/images/conference/conference-23-octobre-partage.jpg', import.meta.url)))
})
