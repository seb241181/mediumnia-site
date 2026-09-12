import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const componentPath = new URL('../src/components/CosmicLibraryHero.jsx', import.meta.url)
const stylesPath = new URL('../src/styles/cosmic-library-home.css', import.meta.url)
const designSystemPath = new URL('../src/styles/cosmic-design-system.css', import.meta.url)
const officialLogoPath = new URL('../public/images/brand/MEDIUMIA_logo_officiel_2026-09-12.png', import.meta.url)
const transparentLogoPath = new URL('../public/images/brand/MEDIUMIA_logo_officiel_transparent_2026-09-12.png', import.meta.url)
const goldLogoPath = new URL('../public/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png', import.meta.url)
const desktopScenePath = new URL('../public/images/home/mediumia-cosmic-library-hero.webp', import.meta.url)
const mobileScenePath = new URL('../public/images/home/mediumia-cosmic-library-hero-mobile.webp', import.meta.url)

test('cosmic homepage preserves the supplied official logo and uses its transparent presentation asset', async () => {
  const [component, logo, transparentLogo, goldLogo] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(officialLogoPath),
    readFile(transparentLogoPath),
    readFile(goldLogoPath),
  ])

  assert.equal(createHash('sha256').update(logo).digest('hex'), '93cfebd39d341f42bb230a54bf81564e4deaaec0e5ae6a82b5afa4eb03c039a2')
  assert.match(component, /src="\/images\/brand\/MEDIUMIA_logo_officiel_transparent_2026-09-12\.png"/)
  assert.ok(transparentLogo.byteLength < logo.byteLength)
  assert.ok(goldLogo.byteLength < logo.byteLength)
  assert.deepEqual([...transparentLogo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.deepEqual([...goldLogo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.doesNotMatch(component, /filter:|brightness-|saturate-|hue-rotate/)
})

test('cosmic hero uses responsive monumental scenes with the original editorial promise', async () => {
  const [component, desktopScene, mobileScene] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(desktopScenePath),
    readFile(mobileScenePath),
  ])

  assert.match(component, /mediumia-cosmic-library-hero\.webp/)
  assert.match(component, /mediumia-cosmic-library-hero-mobile\.webp/)
  assert.match(component, /Comprendre\. Apprendre\. Rencontrer\./)
  assert.match(component, /Exercer autrement\./)
  assert.match(component, /MediumIA rassemble celles et ceux qui explorent, transmettent et accompagnent/)
  assert.match(component, /Découvrir l'accompagnement/)
  assert.doesNotMatch(component, /Là où la conscience rencontre l’intelligence artificielle/)
  assert.doesNotMatch(component, /Commencer l'exploration|Découvrir la Formation/)
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
  assert.match(component, /cosmic-library__eye-blink/)
  assert.match(component, /cosmic-library__eyelid--upper/)
  assert.match(component, /cosmic-library__eyelid--lower/)
  assert.match(component, /cosmic-library__blink-seam/)
  assert.match(component, /setDockInfluence/)
  assert.match(component, /0\.94 \+ easedInfluence \* 0\.24/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /transform: translateY\(var\(--dock-lift\)\) scale\(var\(--dock-scale\)\)/)
  assert.match(styles, /animation: cosmic-blink-upper 31\.4s/)
  assert.match(styles, /animation: cosmic-blink-lower 31\.4s/)
  assert.match(styles, /27\.82%, 73\.07%, 74\.27% \{ transform: translateY\(0\); \}/)
  assert.match(styles, /\.cosmic-library,[\s\S]*animation: none !important/)
  assert.doesNotMatch(component, /three|webgl|canvas/i)
})

test('logo treatment has no rectangular panel and the navigation uses the cosmic glass system', async () => {
  const [styles, designSystem] = await Promise.all([
    readFile(stylesPath, 'utf8'),
    readFile(designSystemPath, 'utf8'),
  ])

  assert.match(styles, /\.cosmic-library__brand \{[\s\S]*border: 0;[\s\S]*background: transparent;/)
  assert.match(styles, /\.cosmic-library__brand-aura/)
  assert.match(styles, /\.cosmic-nav > div \{[\s\S]*border-radius: 999px;[\s\S]*backdrop-filter: blur\(22px\)/)
  assert.match(designSystem, /--cosmic-surface:/)
  assert.match(designSystem, /--cosmic-shadow-float:/)
})
