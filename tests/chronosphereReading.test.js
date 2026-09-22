import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHRONOSPHERE_ENGINE_VERSION,
  CHRONOSPHERE_SCHEMA_VERSION,
  READING_SECTION_TITLES,
  parseLegacyChronosphereReading,
  readingToInterpretation,
  validateChronosphereReading,
} from '../lib/chronosphereReading.js'

function completeReading() {
  return {
    summary30s: 'Le tirage montre une dynamique claire et progressive.',
    direction: null,
    sections: READING_SECTION_TITLES.map((title) => ({ title, content: `Contenu ${title}` })),
    realignmentAct: { gesture: 'Poser une main sur le coeur.', decree: 'Je choisis mon axe.' },
  }
}

test('Chronosphere MAX exposes stable schema and engine versions', () => {
  assert.equal(CHRONOSPHERE_SCHEMA_VERSION, 'chronosphere-max-v1')
  assert.equal(CHRONOSPHERE_ENGINE_VERSION, 'chronosphere-999-58-max-v1')
})

test('structured V2 reading requires the 30-second summary, 9 sections and realignment act', () => {
  const validation = validateChronosphereReading(completeReading())
  assert.equal(validation.valid, true)
  assert.equal(validation.reading.sections.length, 9)
  assert.match(readingToInterpretation(validation.reading), /Résumé en 30 secondes/)
  assert.match(readingToInterpretation(validation.reading), /9\. La question que Chronosphère vous renvoie/)
})

test('structured V2 reading rejects missing sections before storage', () => {
  const invalid = completeReading()
  invalid.sections = invalid.sections.slice(0, 8)
  const validation = validateChronosphereReading(invalid)
  assert.equal(validation.valid, false)
  assert.deepEqual(validation.missingSections, ['La question que Chronosphère vous renvoie'])
})

test('legacy interpretation remains readable without modifying historical data', () => {
  const legacy = `La tendance du tirage
Tendance favorable
Une dynamique claire ressort.

1. La photographie de l'instant
Le présent se clarifie.

2. La fréquence principale
La carte principale donne l'axe.`

  const reading = parseLegacyChronosphereReading(legacy, { gesture: 'Respirer.', decree: 'Je reviens à mon axe.' })
  assert.equal(reading.direction.label, 'Tendance favorable')
  assert.equal(reading.sections[0].title, "La photographie de l'instant")
  assert.equal(reading.realignmentAct.gesture, 'Respirer.')
})
