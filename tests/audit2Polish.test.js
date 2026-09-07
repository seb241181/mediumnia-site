import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appPath = new URL('../src/App.jsx', import.meta.url)
const chronoPath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const legalPath = new URL('../src/components/LegalPages.jsx', import.meta.url)
const guardianPath = new URL('../src/components/SiteGuardian.jsx', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

test('homepage has one clear H1 and commercial navigation uses real links', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /<h1 className="font-bodoni[\s\S]*Comprendre\. Apprendre\. Rencontrer\./)
  assert.match(app, /Découvrir la Formation MediumIA →/)
  assert.match(app, /href="\/formation"[\s\S]*>Se former<\/a>/)
  assert.match(app, /href="\/conferences"[\s\S]*>Conférences<\/a>/)
  assert.match(app, /href="\/reseau"[\s\S]*>Trouver un praticien<\/a>/)
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

test('audit2 polish runs after all layered product patches', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  for (const name of ['predev', 'pretest', 'prebuild']) {
    const script = pkg.scripts[name]
    assert.match(script, /apply-formation-email-lead\.mjs && node scripts\/apply-audit2-polish\.mjs/)
  }
})
