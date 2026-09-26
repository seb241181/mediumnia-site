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

test('home order: hero, Formation with progressive payment, Consulter, avis, Découvrir, boutique, praticiens', async () => {
  const app = await read('src/App.jsx')
  const home = app.slice(app.indexOf('function PublicPlatformHome('))
  const order = ['<CosmicLibraryHero', '<section id="formation"', '<ConsultationSection id="consulter" compact', '<ReviewsHighlight />', '<DiscoverSection id="decouvrir"', '<section id="boutique"', '<PractitionersBand']
  const positions = order.map((marker) => home.indexOf(marker))
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.doesNotMatch(app, /function FeaturedChronosphere|function OracleChronosphereBridge|Pour éviter toute confusion|Le socle arrive/)
  assert.match(app, /Paiement progressif/)
  assert.match(app, /pour commencer/)
  assert.match(app, /offer\.regularCount/)
  assert.match(app, /Total maximum/)
  const band = await read('src/components/PractitionersBand.jsx')
  assert.match(band, /label: 'Espace Pro', href: '\/pro'/)
})

test('shop: Formation MediumIA first, as the lead offer, at 597 € TTC; other prices unchanged', async () => {
  const { boutiqueProducts, boutiqueCategories } = await import('../src/data/boutiqueProducts.js')
  const visible = boutiqueProducts.filter((p) => p.publicVisible !== false)
  assert.equal(visible[0].id, 'formation-mediumia')
  assert.equal(visible[0].name, 'Formation MediumIA')
  assert.equal(visible[0].priceLabel, '597 € TTC')
  assert.equal(visible[0].spotlight, true)
  assert.equal(visible[0].paymentNote, 'Paiement en plusieurs fois disponible avec PayPal selon éligibilité.')
  assert.deepEqual(visible.map((p) => [p.id, p.priceLabel]).slice(1), [
    ['oracle-au-dela-ame', '29,90 €'],
    ['cartes-cadeaux', 'Dès 9,90 €'],
    ['le-codex', 'Disponible sur Amazon'],
  ])
  assert.equal(boutiqueCategories[1].id, 'formations')
  const shop = await read('src/components/BoutiqueEcommerce.jsx')
  assert.match(shop, /\{spotlight && <SpotlightCard product=\{spotlight\}/)
})

test('Formation first screen: promise, audience, benefits and progressive payment are immediately visible', async () => {
  const page = await read('src/components/FormationPage.jsx')
  const top = page.slice(page.indexOf('id="formation-top"'), page.indexOf('Ce parcours est pour vous si'))
  assert.match(top, /<h1[^>]*>Développer sa médiumnité, pas à pas<\/h1>/)
  assert.match(top, /Pour qui :/)
  assert.match(top, /HERO_APPORTS\.map/)
  assert.match(top, /Paiement progressif/)
  assert.match(top, /money\(offer\.discoveryCents\)/)
  assert.match(top, /offer\.regularCount/)
  assert.match(top, /Total maximum/)
  assert.match(top, /Voir les options de paiement →/)
  // Only the validated installment phrase, nowhere the old detail.
  assert.doesNotMatch(page, /4X|6X|12X|24X/)
  // Details kept but folded.
  assert.match(page, /INCLUS\.map\(\(item\) => \(\n\s+<details/)
  assert.match(page, /POINTS\.map\(\(p\) => \(\n\s+<details/)
  assert.match(page, /<NiveauxAccordion \/>/)
  assert.match(page, /<FAQAccordion \/>/)
  assert.match(page, /<SiteNav current="formation"/)
  assert.match(page, /<PageRail items=\{FORMATION_SECTIONS\}/)
})

test('every public page keeps the main navigation (no more lone « ← Accueil » headers)', async () => {
  const pages = {
    'src/components/OraclePage.jsx': 'decouvrir',
    'src/components/ChronospherePage.jsx': 'decouvrir',
    'src/components/ChronosphereExamplePage.jsx': 'decouvrir',
    'src/components/ChronosphereMaxPage.jsx': 'decouvrir',
    'src/components/ConferencesPage.jsx': 'conferences',
    'src/components/GiftCardsPage.jsx': 'boutique',
    'src/components/ReviewsPage.jsx': null,
    'src/components/ReseauDirectory.jsx': 'reseau',
    'src/components/PractitionerProfile.jsx': 'reseau',
    'src/components/ReseauJoindre.jsx': 'reseau',
  }
  for (const [path, current] of Object.entries(pages)) {
    const source = await read(path)
    assert.match(source, /<PublicPageNav\b/, path)
    if (current) assert.match(source, new RegExp(`<PublicPageNav current="${current}"`), path)
    assert.doesNotMatch(source, /<header\b/, `${path} still has its own header`)
    assert.doesNotMatch(source, /← Accueil|← MediumIA/, path)
  }
  for (const path of ['src/components/FormationPage.jsx', 'src/components/DefiIntuitionPage.jsx']) {
    assert.match(await read(path), /<SiteNav current=/, path)
  }
  // Business actions kept in the context line.
  assert.match(await read('src/components/OraclePage.jsx'), /Commander et payer — 34,69 € TTC/)
  assert.match(await read('src/components/PractitionerProfile.jsx'), /← Tous les praticiens/)
})
