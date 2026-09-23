import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const readingPath = new URL('../lib/chronosphereReading.js', import.meta.url)
const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const examplePath = new URL('../src/components/ChronosphereExamplePage.jsx', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

async function readSources() {
  const [timeline, reading, page, example, pkg] = await Promise.all([
    readFile(timelinePath, 'utf8'),
    readFile(readingPath, 'utf8'),
    readFile(pagePath, 'utf8'),
    readFile(examplePath, 'utf8'),
    readFile(packagePath, 'utf8'),
  ])
  return { timeline, reading, page, example, pkg }
}

test('paid Chronosphere uses the public-example V2 reading structure', async () => {
  const { timeline } = await readSources()
  assert.match(timeline, /Résumé en 30 secondes/)
  assert.match(timeline, /1\. « La photographie de l'instant »/)
  assert.match(timeline, /2\. « La fréquence principale »/)
  assert.match(timeline, /3\. « Les deux résonances »/)
  assert.match(timeline, /4\. « Ce que racontent les trois fréquences ensemble »/)
  assert.match(timeline, /5\. « Le ciel de naissance et le contexte astrologique »/)
  assert.match(timeline, /6\. « La ligne de temps »/)
  assert.match(timeline, /7\. « Les deux chemins possibles »/)
  assert.match(timeline, /8\. « Vos leviers concrets »/)
  assert.match(timeline, /9\. « La question que Chronosphère vous renvoie »/)
  assert.match(timeline, /ne crée donc PAS de dixième partie/)
  assert.match(timeline, /STRUCTURE V2 OBLIGATOIRE/)
  assert.match(timeline, /JSON valide demandé/)
  assert.match(timeline, /"closure": null/)
  assert.match(timeline, /"whyNow": \[\]/)
  assert.match(timeline, /Pourquoi maintenant/)
})

test('V2 reading is native and no longer depends on the build patch', async () => {
  const { timeline, reading, pkg } = await readSources()
  const parsed = JSON.parse(pkg)
  for (const name of ['predev', 'pretest', 'prebuild']) {
    assert.doesNotMatch(parsed.scripts[name], /apply-chronosphere-v2-reading\.mjs/)
  }
  assert.match(timeline, /schemaVersion: CHRONOSPHERE_SCHEMA_VERSION/)
  assert.match(timeline, /engineVersion: CHRONOSPHERE_ENGINE_VERSION/)
  assert.match(timeline, /validateChronosphereReading/)
  assert.match(reading, /CHRONOSPHERE_SCHEMA_VERSION = 'chronosphere-v2'/)
  assert.match(reading, /validateChronosphereReading/)
  assert.match(reading, /parseLegacyChronosphereReading/)
})

test('paid result exposes a 30-second summary from structured reading', async () => {
  const { page } = await readSources()
  assert.match(page, /getChronosphereReading\(result\)/)
  assert.match(page, /Votre tirage en 30 secondes/)
  assert.match(page, /parts\.summary30s/)
  assert.match(page, /parts\.direction\?\.label/)
  assert.match(page, /fallbackReading/)
})

test('paid result renders V2 reading as separate premium sections', async () => {
  const { page } = await readSources()
  assert.match(page, /readingSections/)
  assert.doesNotMatch(page, /readingSections\.map\(\(section\)/)
  assert.match(page, /sectionsById\.current_picture/)
  assert.match(page, /sectionsById\.timeline/)
  assert.match(page, /sectionsById\.two_possible_paths/)
  assert.match(page, /sectionsById\.concrete_levers/)
  assert.match(page, /<TimelineFrise timing=\{result\.sky\?\.timing\} \/>/)
  assert.match(page, /Pourquoi maintenant \?/)
  assert.match(page, /Donnée calculée/)
  assert.match(page, /Interprétation symbolique/)
  assert.match(page, /extractLeverCards/)
  assert.match(page, /extractPathCards/)
})

test('public example remains clearly fictional and conversion-oriented', async () => {
  const { example } = await readSources()
  assert.match(example, /Exemple fictif/)
  assert.match(example, /Votre tirage en 30 secondes/)
  assert.match(example, /Ce qui doit se terminer avant la suite/)
  assert.match(example, /Pourquoi maintenant/)
  assert.match(example, /Les deux chemins possibles/)
  assert.match(example, /Vos leviers concrets/)
  assert.match(example, /Faire mon tirage — dès 5 €/)
  assert.doesNotMatch(example, /ChronoSphère MAX/)
})
