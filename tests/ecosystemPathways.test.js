import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const componentPath = new URL('../src/components/EcosystemNextSteps.jsx', import.meta.url)
const appPath = new URL('../src/App.jsx', import.meta.url)
const chronospherePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const oraclePath = new URL('../src/components/OraclePage.jsx', import.meta.url)

async function readSources() {
  const [component, app, chronosphere, oracle] = await Promise.all([
    readFile(componentPath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(chronospherePath, 'utf8'),
    readFile(oraclePath, 'utf8'),
  ])
  return { component, app, chronosphere, oracle }
}

test('ecosystem pathways stay contextual and non-coercive', async () => {
  const { component } = await readSources()
  assert.match(component, /MediumIA relie les expériences sans vous imposer de parcours/)
  assert.match(component, /Je veux essayer gratuitement/)
  assert.match(component, /J’ai besoin d’un éclairage maintenant/)
  assert.match(component, /Je veux parler à quelqu’un/)
  assert.match(component, /Je veux apprendre/)
  assert.match(component, /Faire le tirage offert/)
  assert.match(component, /Découvrir le réseau/)
  assert.match(component, /Découvrir l’accompagnement/)
  assert.match(component, /Explorer ma ligne de temps/)
})

test('public home exposes four guided doors using existing routes', async () => {
  const { app } = await readSources()
  assert.match(app, /context="home"/)
  assert.match(app, /onOpenOracle=\{onOpenOracle\}/)
  assert.match(app, /onOpenChronosphere=\{onOpenChronosphere\}/)
  assert.match(app, /onOpenReseau=\{onOpenReseauDir\}/)
  assert.match(app, /onOpenFormation=\{onOpenFormation\}/)
})

test('App wires existing MediumIA doors without adding duplicate routes', async () => {
  const { app } = await readSources()
  assert.match(app, /OraclePage[^\n]+onOpenChronosphere=\{openChronosphere\}[^\n]+onOpenFormation=\{openFormation\}[^\n]+onOpenReseau=\{openReseauDir\}/)
  assert.match(app, /ChronospherePage[^\n]+onOpenOracle=\{openOracle\}[^\n]+onOpenFormation=\{openFormation\}[^\n]+onOpenReseau=\{openReseauDir\}/)
})

test('Chronosphere only proposes next doors inside a completed result', async () => {
  const { chronosphere } = await readSources()
  const resultStart = chronosphere.indexOf('{result && parts && (')
  const pathways = chronosphere.indexOf('context="chronosphere"')
  const resultEnd = chronosphere.indexOf('</section>', resultStart)
  assert.ok(resultStart >= 0)
  assert.ok(pathways > resultStart)
  assert.ok(resultEnd > pathways)
  assert.match(chronosphere, /onOpenOracle=\{onOpenOracle\}/)
  assert.match(chronosphere, /onOpenReseau=\{onOpenReseau\}/)
  assert.match(chronosphere, /onOpenFormation=\{onOpenFormation\}/)
})

test('Oracle keeps its purchase journey first and offers the ecosystem afterwards', async () => {
  const { oracle } = await readSources()
  const finalPurchase = oracle.lastIndexOf('Commander et payer — 34,69 € TTC')
  const pathways = oracle.indexOf('context="oracle"')
  assert.ok(finalPurchase >= 0)
  assert.ok(pathways > finalPurchase)
  assert.match(oracle, /onOpenChronosphere=\{onOpenChronosphere\}/)
})
