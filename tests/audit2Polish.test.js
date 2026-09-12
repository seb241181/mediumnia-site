import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const cosmicHeroPath = new URL('../src/components/CosmicLibraryHero.jsx', import.meta.url)
const chronoPath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const legalPath = new URL('../src/components/LegalPages.jsx', import.meta.url)
const guardianPath = new URL('../src/components/SiteGuardian.jsx', import.meta.url)
const indexPath = new URL('../index.html', import.meta.url)
const transactionalEmailPath = new URL('../lib/transactionalEmail.js', import.meta.url)
const oracleEmailSequencePath = new URL('../lib/oracleEmailSequence.js', import.meta.url)
const formationEmailLeadPath = new URL('../lib/formationEmailLead.js', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

test('homepage has one clear H1 and commercial navigation uses real links', async () => {
  const [app, cosmicHero] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(cosmicHeroPath, 'utf8'),
  ])
  assert.match(cosmicHero, /<h1 id="cosmic-home-title">[\s\S]*COSMIC_HOME_CONFIG\.title/)
  assert.match(cosmicHero, /Découvrir la Formation MediumIA/)
  assert.match(app, /href="\/formation"[\s\S]*>Se former<\/a>/)
  assert.match(app, /href="\/conferences"[\s\S]*>Conférences<\/a>/)
  assert.match(app, /href="\/reseau"[\s\S]*>Trouver un praticien<\/a>/)
})

test('homepage prioritizes the hero image and defers heavy below-fold imagery', async () => {
  const [app, cosmicHero, index] = await Promise.all([
    readFile(appPath, 'utf8'),
    readFile(cosmicHeroPath, 'utf8'),
    readFile(indexPath, 'utf8'),
  ])
  assert.match(index, /rel="preload" as="image" href="\/images\/brand\/MEDIUMIA_logo_officiel_2026-09-12\.png" fetchpriority="high"/)
  assert.match(cosmicHero, /MEDIUMIA_logo_officiel_2026-09-12\.png"[\s\S]*fetchPriority="high"[\s\S]*decoding="async"/)
  assert.match(app, /MEDIUMIA_logo_maitre_2026-08-16\.png"[\s\S]*loading="lazy"[\s\S]*fetchPriority="low"/)
})

test('Chronosphere exposes its public example immediately before the form', async () => {
  const chrono = await readFile(chronoPath, 'utf8')
  const exampleIndex = chrono.indexOf('Voir un exemple complet avant de remplir')
  const formIndex = chrono.indexOf('{/* Form — always visible */}')
  assert.ok(exampleIndex >= 0)
  assert.ok(formIndex > exampleIndex)
  assert.match(chrono, /href="\/chronosphere\/exemple"/)
})

test('privacy policy explicitly documents Chronosphere birth data', async () => {
  const legal = await readFile(legalPath, 'utf8')
  assert.match(legal, /Données collectées — Chronosphère/)
  assert.match(legal, /heure exacte de naissance/)
  assert.match(legal, /lieu de naissance/)
  assert.match(legal, /trois nombres distincts/)
  assert.match(legal, /prospection commerciale sans consentement distinct/)
})

test('Guardian renders public MediumIA URLs as clickable links', async () => {
  const guardian = await readFile(guardianPath, 'utf8')
  assert.match(guardian, /function LinkedGuardianMessage/)
  assert.match(guardian, /https:\/\/mediumia\.fr/)
  assert.match(guardian, /<LinkedGuardianMessage content=\{msg\.content\} \/>/)
})

test('three-exercise emails use the human Sébastien sender without changing other transactional mail', async () => {
  const [transactionalEmail, oracleSequence, formationLead] = await Promise.all([
    readFile(transactionalEmailPath, 'utf8'),
    readFile(oracleEmailSequencePath, 'utf8'),
    readFile(formationEmailLeadPath, 'utf8'),
  ])

  assert.match(transactionalEmail, /from: fromOverride/)
  assert.match(transactionalEmail, /fromOverride \|\| process\.env\.RESEND_FROM_EMAIL/)
  assert.match(oracleSequence, /Sébastien — MediumIA <sebastien@mail\.mediumia\.fr>/)
  assert.match(formationLead, /Sébastien — MediumIA <sebastien@mail\.mediumia\.fr>/)
  assert.match(oracleSequence, /sendEmail\(\{\n\s*from: SEQUENCE_FROM,/)
  assert.match(formationLead, /sendEmail\(\{\n\s*from: SEQUENCE_FROM,/)
})

test('exercise 1 does not repeat its opening sentence in the body', async () => {
  const oracleSequence = await readFile(oracleEmailSequencePath, 'utf8')
  const repeatedLine = 'On commence par le premier geste de toute pratique consciente : poser une direction claire.'
  assert.equal(oracleSequence.split(repeatedLine).length - 1, 1)
})

test('audit2 polish runs after all layered product patches', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  for (const name of ['predev', 'pretest', 'prebuild']) {
    const script = pkg.scripts[name]
    assert.match(script, /apply-formation-email-lead\.mjs && node scripts\/apply-audit2-polish\.mjs/)
  }
})
