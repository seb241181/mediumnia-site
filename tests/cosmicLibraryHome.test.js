import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const componentPath = new URL('../src/components/CosmicLibraryHero.jsx', import.meta.url)
const stylesPath = new URL('../src/styles/cosmic-library-home.css', import.meta.url)
const officialLogoPath = new URL('../public/images/brand/MEDIUMIA_logo_officiel_2026-09-12.png', import.meta.url)

test('cosmic homepage uses the supplied official logo without generated substitutes', async () => {
  const [component, logo] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(officialLogoPath),
  ])

  assert.equal(createHash('sha256').update(logo).digest('hex'), '93cfebd39d341f42bb230a54bf81564e4deaaec0e5ae6a82b5afa4eb03c039a2')
  assert.match(component, /src="\/images\/brand\/MEDIUMIA_logo_officiel_2026-09-12\.png"/)
  assert.doesNotMatch(component, /filter:|brightness-|saturate-|hue-rotate/)
})

test('cosmic hero keeps all public entry points wired to real routes or sections', async () => {
  const [app, component] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(componentPath, 'utf8'),
  ])

  assert.match(app, /<CosmicLibraryHero[\s\S]*onOpenFormation=\{onOpenFormation\}[\s\S]*onOpenOracle=\{onOpenOracle\}[\s\S]*onOpenChronosphere=\{onOpenChronosphere\}[\s\S]*onOpenReseauDir=\{onOpenReseauDir\}/)
  for (const href of ['#decouvrir', '/formation', '/oracle', '/chronosphere', '#consulter', '/reseau']) {
    assert.match(component, new RegExp(`href: '${href.replace('/', '\\/')}'|href="${href.replace('/', '\\/')}"`))
  }
})

test('cosmic motion is CSS-only, responsive and disabled for reduced motion', async () => {
  const [component, styles] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(stylesPath, 'utf8'),
  ])

  assert.match(component, /cosmic-sphere/)
  assert.match(component, /cosmic-orbit--outer/)
  assert.match(component, /cosmic-dock__item/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /cosmic-dock__item\.is-active/)
  assert.doesNotMatch(component, /three|webgl|canvas/i)
})
