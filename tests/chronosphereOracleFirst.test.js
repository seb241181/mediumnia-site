import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('Chronosphere presents Sebastian Oracle before the AI layer', () => {
  const page = read('src/components/ChronospherePage.jsx')
  const oracle = page.indexOf('L’Oracle des Lignes de Temps de Sébastien')
  const ai = page.indexOf('L’IA intervient ensuite')
  assert.ok(oracle > 0 && ai > oracle)
  assert.match(page, /58 cartes/)
  assert.match(page, /thème natal/)
  assert.match(page, /ciel du moment/)
  assert.match(page, /lignes de temps possibles/)
  assert.match(page, /Elle ne choisit ni n’invente les cartes/)
})

test('Chronosphere example explains trajectories rather than a fixed future', () => {
  const example = read('src/components/ChronosphereExamplePage.jsx')
  assert.match(example, /trois nombres entre 1 et 58/)
  assert.match(example, /Oracle des Lignes de Temps créé par Sébastien/)
  assert.match(example, /explorer des lignes de temps possibles/)
  assert.match(example, /jamais un avenir unique présenté comme certain/)
})
