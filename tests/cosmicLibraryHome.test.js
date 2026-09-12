import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const componentPath = new URL('../src/components/CosmicLibraryHero.jsx', import.meta.url)
const stylesPath = new URL('../src/styles/cosmic-library-home.css', import.meta.url)
const officialLogoPath = new URL('../public/images/brand/MEDIUMIA_logo_officiel_2026-09-12.png', import.meta.url)
const desktopScenePath = new URL('../public/images/home/mediumia-cosmic-library-hero.webp', import.meta.url)
const mobileScenePath = new URL('../public/images/home/mediumia-cosmic-library-hero-mobile.webp', import.meta.url)

test('cosmic homepage uses the supplied official logo without generated substitutes', async () => {
  const [component, logo] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(officialLogoPath),
  ])

  assert.equal(createHash('sha256').update(logo).digest('hex'), '93cfebd39d341f42bb230a54bf81564e4deaaec0e5ae6a82b5afa4eb03c039a2')
  assert.match(component, /src="\/images\/brand\/MEDIUMIA_logo_officiel_2026-09-12\.png"/)
  assert.doesNotMatch(component, /filter:|brightness-|saturate-|hue-rotate/)
})

test('cosmic hero uses responsive monumental library scenes without restoring the editorial headline', async () => {
  const [component, desktopScene, mobileScene] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(desktopScenePath),
    readFile(mobileScenePath),
  ])

  assert.match(component, /mediumia-cosmic-library-hero\.webp/)
  assert.match(component, /mediumia-cosmic-library-hero-mobile\.webp/)
  assert.match(component, /Là où la conscience rencontre l’intelligence artificielle/)
  assert.doesNotMatch(component, /Comprendre\. Apprendre\. Rencontrer\.|Exercer autrement\./)
  assert.ok(desktopScene.byteLength < 400_000)
  assert.ok(mobileScene.byteLength < 400_000)
})

test('cosmic hero keeps the six requested public entry points wired to real routes', async () => {
  const [app, component] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(componentPath, 'utf8'),
  ])

  assert.match(app, /<CosmicLibraryHero[\s\S]*onOpenPro=\{onOpenPro\}[\s\S]*onOpenFormation=\{onOpenFormation\}[\s\S]*onOpenOracle=\{onOpenOracle\}[\s\S]*onOpenChronosphere=\{onOpenChronosphere\}[\s\S]*onOpenReseauDir=\{onOpenReseauDir\}/)
  for (const href of ['/formation', '/oracle', '/chronosphere', '/agents', '/conferences', '/reseau']) {
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
  assert.match(component, /setDockInfluence/)
  assert.match(component, /0\.94 \+ easedInfluence \* 0\.24/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /transform: translateY\(var\(--dock-lift\)\) scale\(var\(--dock-scale\)\)/)
  assert.doesNotMatch(component, /three|webgl|canvas/i)
})
