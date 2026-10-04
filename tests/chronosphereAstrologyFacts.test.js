import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAstrologyFacts, bindReadingFacts } from '../lib/chronosphereAstrologyFacts.js'
import { buildChronosphereMaxSnapshot } from '../lib/chronosphereMaxSnapshot.js'
import { compareChronosphereSnapshots } from '../lib/chronosphereMaxCompare.js'

const engine = {
  natal: [{ planet: 'Soleil', longitude: 12, sign: 'Belier', house: 2, label: '12 deg Belier' }],
  transits: [{ planet: 'Mercure', longitude: 20, sign: 'Belier', natalHouse: 3, label: '20 deg Belier' }],
  geometry: { ascendant: { longitude: 30, sign: 'Taureau', label: '0 deg Taureau' } },
  aspects: [{ transitPlanet: 'Mercure', aspect: 'sextile', natalPlanet: 'Venus', orb: 0.7 }],
  timing: { primary: { start: '2026-10-01', peak: '2026-10-03', end: '2026-10-06' } },
}
test('model cannot replace a calculated house, aspect, planet or date', () => {
  const facts = buildAstrologyFacts(engine)
  const reading = bindReadingFacts({ whyNow: [
    { factId: 'natal:Soleil', calculated: 'Maison X, Pluton carre Saturne', interpretation: 'Prose symbolique conservee.' },
    { factId: 'aspect:Mercure:sextile:Venus', calculated: 'Pluton carre Saturne', interpretation: 'Symbolique.' },
    { factId: 'window:primary', calculated: '2050-12-31', interpretation: 'Fenetre symbolique.' },
    { factId: 'fake:Pluton', calculated: 'Maison X', interpretation: 'Faux fait.' },
  ] }, facts)
  assert.equal(reading.whyNow.length, 3)
  assert.match(reading.whyNow[0].calculated, /maison 2/)
  assert.equal(reading.whyNow[0].interpretation, 'Prose symbolique conservee.')
  assert.match(reading.whyNow[1].calculated, /Mercure sextile Venus/)
  assert.match(reading.whyNow[2].calculated, /2026-10-03/)
  assert.doesNotMatch(JSON.stringify(reading), /Pluton|Maison X|2050/)
  const snapshot = buildChronosphereMaxSnapshot({ theme: 'projet', reading, astrologyFacts: facts, sky: { timing: engine.timing } })
  assert.equal(snapshot.activatedDomain.house, null)
  assert.equal(snapshot.astrologyFacts.facts.find((item) => item.id === 'natal:Soleil').house, 2)
  assert.equal(snapshot.astrologyFacts.facts.find((item) => item.id === 'natal:Soleil').eclipticLongitude, 12)
  assert.match(snapshot.astrologyContributors[0].calculated, /Mercure sextile Venus/)
  assert.doesNotMatch(JSON.stringify(snapshot), /Pluton|Maison X|2050/)
})
test('MAX comparisons ignore legacy prose and card correspondences as calculated planets', () => {
  const legacy = { theme: 'projet', mainCard: { number: 1, name: 'Fixture', astre: 'Pluton' },
    activatedDomain: { house: 'X' }, astrologyContributors: [{ calculated: 'Pluton carre Saturne' }] }
  const oldComparison = compareChronosphereSnapshots(legacy, legacy)
  assert.equal(oldComparison.facts.some((item) => item.kind === 'recurring_planet'), false)
  assert.equal(oldComparison.facts.find((item) => item.kind === 'recurring_domain').domain, 'projet')
  const structured = { ...legacy, astrologyFacts: buildAstrologyFacts(engine) }
  const comparison = compareChronosphereSnapshots(structured, structured)
  assert.deepEqual(comparison.facts.find((item) => item.kind === 'recurring_planet').planets, ['Mercure', 'Venus'])
})
