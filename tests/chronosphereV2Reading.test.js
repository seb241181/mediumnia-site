import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)
const examplePath = new URL('../src/components/ChronosphereExamplePage.jsx', import.meta.url)

async function readSources() {
  const [timeline, page, example] = await Promise.all([
    readFile(timelinePath, 'utf8'),
    readFile(pagePath, 'utf8'),
    readFile(examplePath, 'utf8'),
  ])
  return { timeline, page, example }
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
})

test('paid result exposes a 30-second summary even without a closed question', async () => {
  const { page } = await readSources()
  assert.match(page, /\(parts\.direction \|\| parts\.summary\)/)
  assert.match(page, /Votre tirage en 30 secondes/)
  assert.match(page, /Résumé en 30 secondes\|Votre tirage en 30 secondes/)
  assert.match(page, /directionMatch \? directionMatch\[1\]/)
})

test('paid result renders V2 reading as separate premium sections', async () => {
  const { page } = await readSources()
  assert.match(page, /READING_SECTION_TITLES/)
  assert.match(page, /splitReadingSections/)
  assert.match(page, /readingSections\.map/)
  assert.match(page, /section\.title/)
  assert.match(page, /section\.content/)
  assert.match(page, /section\.number === 6/)
  assert.match(page, /<TimelineFrise timing=\{result\.sky\?\.timing\} \/>/)
})

test('public example remains clearly fictional and conversion-oriented', async () => {
  const { example } = await readSources()
  assert.match(example, /Exemple fictif/)
  assert.match(example, /Votre tirage en 30 secondes/)
  assert.match(example, /Les deux chemins possibles/)
  assert.match(example, /Vos leviers concrets/)
  assert.match(example, /Faire mon tirage — dès 5 €/)
})