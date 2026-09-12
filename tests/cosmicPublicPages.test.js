import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const PUBLIC_WINGS = [
  ['src/components/FormationPage.jsx', 'formation'],
  ['src/components/OraclePage.jsx', 'oracle'],
  ['src/components/ChronospherePage.jsx', 'chronosphere'],
  ['src/components/ChronosphereExamplePage.jsx', 'chronosphere'],
  ['src/components/ConferencesPage.jsx', 'conferences'],
  ['src/components/ReseauDirectory.jsx', 'network'],
  ['src/components/PractitionerProfile.jsx', 'network'],
  ['src/components/ReseauJoindre.jsx', 'network'],
  ['src/components/ProWaitlistPublic.jsx', 'agents'],
  ['src/components/FounderCopilotAccess.jsx', 'agents'],
  ['src/components/rdv/RdvPublic.jsx', 'rdv'],
  ['src/components/rdv/RdvCancellation.jsx', 'rdv'],
  ['src/components/LegalPages.jsx', 'legal'],
]

test('public routes share one tokenized cosmic visual system', async () => {
  const [app, styles] = await Promise.all([
    source('src/App.jsx'),
    source('src/styles/cosmic-design-system.css'),
  ])

  assert.match(app, /import '\.\/styles\/cosmic-design-system\.css'/)
  for (const token of ['--cosmic-paper', '--cosmic-deep', '--cosmic-gold', '--cosmic-surface', '--cosmic-shadow-float']) {
    assert.match(styles, new RegExp(token))
  }
  assert.match(styles, /\.cosmic-page__header/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('each public product wing opts into the shared system without changing its route logic', async () => {
  for (const [path, wing] of PUBLIC_WINGS) {
    const contents = await source(path)
    assert.match(contents, new RegExp(`cosmic-page--${wing}`), `${path} should use the ${wing} wing`)
  }
})

test('the homepage hero keeps main editorial copy and existing destinations', async () => {
  const component = await source('src/components/CosmicLibraryHero.jsx')

  for (const wording of [
    'Comprendre. Apprendre. Rencontrer.',
    'Exercer autrement.',
    "Découvrir l'accompagnement",
  ]) {
    assert.match(component, new RegExp(wording.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  for (const href of ['/formation', '/oracle', '/chronosphere', '/agents', '/conferences', '/reseau']) {
    assert.match(component, new RegExp(href.replace('/', '\\/')))
  }
})

test('targeted visual polish keeps the guardian and discovery offer in the shared palette', async () => {
  const [guardian, discoveryGenerator] = await Promise.all([
    source('src/components/SiteGuardian.jsx'),
    source('scripts/apply-discovery-offer.mjs'),
  ])

  assert.match(guardian, /radial-gradient\(circle at 50% 38%, #294f86 0%, #142e5c 55%, #091a3e 100%\)/)
  assert.match(guardian, /linear-gradient\(135deg, #1c2b55, #0d1737\)/)
  assert.match(discoveryGenerator, /border-2 border-gold\/35 bg-white\/75/)
})
