import test from 'node:test'
import assert from 'node:assert/strict'
import { readRouteMeta, withMeta, buildPages } from '../scripts/prerender-route-meta.mjs'

const shell = `<!doctype html><html><head>
    <meta name="description" content="old" />
    <title>Old</title>
    <meta property="og:title" content="old" />
    <meta property="og:description" content="old" />
    <meta property="og:image" content="https://www.mediumia.fr/og-image.jpg" />
    <meta property="og:url" content="https://www.mediumia.fr" />
    <meta name="twitter:title" content="old" />
    <meta name="twitter:description" content="old" />
    <meta name="twitter:image" content="https://www.mediumia.fr/og-image.jpg" />
  </head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`

test('ROUTE_META is read from the generated App source', () => {
  const app = `const x = 1\nconst ROUTE_META = {\n  home: {\n    title: 'Accueil',\n    description: 'D’accueil',\n  },\n}\n\nfunction f() {}`
  assert.deepEqual(readRouteMeta(app), { home: { title: 'Accueil', description: 'D’accueil' } })
  assert.throws(() => readRouteMeta('no meta here'))
})

test('each page head carries its own title, description, URL, canonical and image, escaped', () => {
  const html = withMeta(shell, { title: 'A & "B"', description: 'x < y', url: 'https://mediumia.fr/formation', image: 'https://mediumia.fr/p.jpg' })
  assert.match(html, /<title>A &amp; "B"<\/title>/)
  assert.match(html, /<meta property="og:title" content="A &amp; &quot;B&quot;" \/>/)
  assert.match(html, /<meta name="description" content="x &lt; y" \/>/)
  assert.match(html, /<meta property="og:url" content="https:\/\/mediumia\.fr\/formation" \/>/)
  assert.match(html, /<link rel="canonical" href="https:\/\/mediumia\.fr\/formation" \/>/)
  assert.match(html, /<meta name="twitter:image" content="https:\/\/mediumia\.fr\/p\.jpg" \/>/)
  assert.match(html, /<script type="module" src="\/assets\/index\.js">/, 'the app shell is untouched')
  assert.equal((html.match(/og:title/g) || []).length, 1)
})

test('practitioner pages use their portrait; routes without meta are skipped', () => {
  const pages = buildPages(shell, {
    home: { title: 'H', description: 'h' },
    formation: { title: 'F', description: 'f' },
  }, [{ id: 'gilda', name: 'Gilda', role: 'Voyante', city: '', portrait: '/images/reseau/gilda.jpg' }])
  const files = pages.map((p) => p.file)
  assert.deepEqual(files, ['index.html', 'formation/index.html', 'reseau/gilda/index.html'])
  const gilda = pages.find((p) => p.file === 'reseau/gilda/index.html').html
  assert.match(gilda, /<title>Gilda — Voyante \| Réseau MediumIA<\/title>/)
  assert.match(gilda, /og:image" content="https:\/\/mediumia\.fr\/images\/reseau\/gilda\.jpg"/)
})
