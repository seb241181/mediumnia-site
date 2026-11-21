import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const { calculateOracleAstrology, normalizeOracleProfile } = await import('../lib/oracleAstrology.js')
const { computeAngles, computeHouses, normalizeAngleDegrees } = await import('../lib/astroHouses.js')

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Résultats de référence produits avec free-human-design 1.0.1 (avant son
// retrait de npm). L'Oracle doit rendre exactement les mêmes thèmes,
// transits, aspects et fenêtres.
const golden = JSON.parse(read('tests/fixtures/oracle-astrology-golden.json'))

test('Oracle astrology output is unchanged for fixed births (Paris, Montréal, Nouméa, Tromsø, Buenos Aires)', () => {
  const drawDate = new Date(golden.drawDate)
  assert.equal(golden.results.length, 5)
  for (const { input, output } of golden.results) {
    const actual = calculateOracleAstrology(normalizeOracleProfile(input.profile), input.location, drawDate, input.theme)
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), output, input.profile.birthPlace)
  }
})

test('polar latitude keeps the documented fallback to whole-sign houses', () => {
  const tromso = golden.results.find((r) => r.input.profile.birthPlace === 'Tromsø')
  assert.equal(tromso.output.geometry.houseSystem, 'whole')
  const houses = computeHouses({ jdUT: 2448063.5, lat: 69.6492, lng: 18.9553, system: 'placidus' })
  assert.equal(houses.system, 'whole')
  assert.match(houses.fallback, /fell back to whole sign/)
})

test('angles and houses are geometrically consistent', () => {
  const args = { jdUT: 2446145.7, lat: 48.8566, lng: 2.3522 }
  const angles = computeAngles(args)
  assert.equal(normalizeAngleDegrees(angles.descendant.longitude - angles.ascendant.longitude), 180)
  assert.equal(normalizeAngleDegrees(angles.ic.longitude - angles.mc.longitude), 180)
  const ascFromMc = normalizeAngleDegrees(angles.ascendant.longitude - angles.mc.longitude)
  assert.ok(ascFromMc > 0 && ascFromMc < 180, 'Ascendant in the rising half')
  const placidus = computeHouses({ ...args, system: 'placidus' })
  assert.equal(placidus.cusps.length, 12)
  assert.equal(placidus.cusps[0].longitude, angles.ascendant.longitude)
  assert.equal(placidus.cusps[9].longitude, angles.mc.longitude)
  const equal = computeHouses({ ...args, system: 'equal' })
  assert.equal(normalizeAngleDegrees(equal.cusps[1].longitude - equal.cusps[0].longitude), 30)
  assert.equal(normalizeAngleDegrees(-725), 355)
})

test('the withdrawn npm package is no longer a dependency; the copied code keeps its MIT licence', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['free-human-design'], undefined)
  assert.ok(pkg.dependencies.astronomia, 'astronomia is now a direct dependency')
  assert.doesNotMatch(read('package-lock.json'), /free-human-design/)
  assert.doesNotMatch(read('lib/oracleAstrology.js'), /free-human-design/)
  assert.match(read('lib/astroHouses.js'), /licence MIT/)
  assert.match(read('third_party/free-human-design/LICENSE'), /MIT License[\s\S]*Copyright \(c\) 2026 Adam Blvck/)
})
