import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('main navigation: validated order, real links, Espace élèves only, Espace Pro out', async () => {
  const nav = await read('src/components/SiteNav.jsx')
  const labels = [...nav.matchAll(/\{ id: '[a-z]+', label: '([^']+)', href: '([^']+)' \}/g)].map((m) => [m[1], m[2]])
  assert.deepEqual(labels, [
    ['Se former', '/formation'],
    ['Consulter', '/#consulter'],
    ['Découvrir', '/#decouvrir'],
    ['Conférences', '/conferences'],
    ['Boutique', '/#boutique'],
    ['Trouver un praticien', '/reseau'],
  ])
  assert.match(nav, /href="https:\/\/espace\.mediumia\.fr"[\s\S]*Espace élèves/)
  assert.doesNotMatch(nav.replace(/^\s*\/\/.*$/gm, ''), /Espace Pro|onOpenPro/)
})

test('phones get a real menu, not a sidebar; keyboard can close it', async () => {
  const nav = await read('src/components/SiteNav.jsx')
  assert.match(nav, /aria-expanded=\{open\}/)
  assert.match(nav, /aria-controls="site-nav-menu"/)
  assert.match(nav, /id="site-nav-menu"/)
  assert.match(nav, /event\.key === 'Escape'/)
  assert.match(nav, /className="hidden min-\[1041px\]:flex/)
  assert.match(nav, /className="site-nav__toggle/)
  const css = await read('src/styles/site-nav.css')
  assert.match(css, /@media \(min-width: 1041px\) \{\n  \.cosmic-nav \.site-nav__toggle \{ display: none; \}/)
})

test('long pages get a discreet « Sur cette page » rail on wide screens only', async () => {
  const [rail, app] = await Promise.all([read('src/components/PageRail.jsx'), read('src/App.jsx')])
  assert.match(rail, /hidden min-\[1360px\]:block/)
  assert.match(rail, /getBoundingClientRect\(\)\.top <= line/)
  assert.match(rail, /window\.scrollY > window\.innerHeight \* 0\.75/)
  assert.match(app, /<PageRail items=\{HOME_RAIL\} \/>/)
})

test('home order: hero, Formation (597 €), Consulter, avis, Découvrir, boutique, praticiens', async () => {
  const app = await read('src/App.jsx')
  const home = app.slice(app.indexOf('function PublicPlatformHome('))
  const order = ['<CosmicLibraryHero', '<section id="formation"', '<ConsultationSection id="consulter" compact', '<ReviewsHighlight />', '<DiscoverSection id="decouvrir"', '<section id="boutique"', '<PractitionersBand']
  const positions = order.map((marker) => home.indexOf(marker))
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.doesNotMatch(app, /function FeaturedChronosphere|function OracleChronosphereBridge|Pour éviter toute confusion|Le socle arrive/)
  assert.match(app, /597 € TTC<\/p>/)
  assert.match(app, /Paiement en plusieurs fois disponible avec PayPal selon éligibilité\./)
  const band = await read('src/components/PractitionersBand.jsx')
  assert.match(band, /label: 'Espace Pro', href: '\/pro'/)
})
