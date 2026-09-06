import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('mobile guardian keeps a smaller non-intrusive footprint', () => {
  const guardian = read('src/components/SiteGuardian.jsx')
  assert.match(guardian, /w-\[64px\] h-\[64px\] md:w-\[100px\] md:h-\[100px\]/)
  assert.match(guardian, /guardian-breathe-mobile/)
  assert.match(guardian, /@media \(max-width: 639px\)/)
})

test('homepage metadata describes the whole MediumIA ecosystem', () => {
  const html = read('index.html')
  assert.match(html, /MediumIA — Médiumnité, formation, consultations & réseau/)
  assert.match(html, /Chronosphère, Oracle Au-delà de l’Âme et réseau de praticiens/)
  assert.match(html, /rel="canonical" href="https:\/\/mediumia\.fr\/"/)
  assert.match(html, /application\/ld\+json/)
  assert.doesNotMatch(html, /https:\/\/www\.mediumia\.fr/)
})

test('robots and sitemap expose public doors without private API or cancellation routes', () => {
  const robots = read('public/robots.txt')
  const sitemap = read('public/sitemap.xml')
  assert.match(robots, /Sitemap: https:\/\/mediumia\.fr\/sitemap\.xml/)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Disallow: \/rdv\/annuler/)
  for (const route of ['/formation', '/oracle', '/chronosphere', '/reseau', '/conferences']) {
    assert.match(sitemap, new RegExp(`<loc>https://mediumia\\.fr${route.replace('/', '\\/')}`))
  }
  assert.doesNotMatch(sitemap, /\/api\//)
  assert.doesNotMatch(sitemap, /\/rdv\/annuler/)
})
