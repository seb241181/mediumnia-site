import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  DEFAULT_ORACLE_SPREAD_ID,
  getOracleSpread,
  ORACLE_SPREADS,
} from '../src/data/oracleSpreads.js'

test('oracle exposes five distinct three-card spreads', () => {
  assert.equal(ORACLE_SPREADS.length, 5)
  assert.equal(new Set(ORACLE_SPREADS.map((spread) => spread.id)).size, ORACLE_SPREADS.length)

  for (const spread of ORACLE_SPREADS) {
    assert.equal(spread.positions.length, 3)
    assert.ok(spread.name)
    assert.ok(spread.shortDescription)
    assert.equal(new Set(spread.positions.map((position) => position.label)).size, 3)

    for (const position of spread.positions) {
      assert.ok(position.label)
      assert.ok(position.meaning)
    }
  }
})

test('legacy oracle spread remains the default for backwards compatibility', () => {
  const spread = getOracleSpread()
  assert.equal(DEFAULT_ORACLE_SPREAD_ID, 'ombre-passage-guerison')
  assert.equal(spread.id, DEFAULT_ORACLE_SPREAD_ID)
  assert.deepEqual(spread.positions.map((position) => position.label), ['Ombre', 'Passage', 'Guérison'])
})

test('oracle client sends spreadId and API interprets server-side spread definitions', () => {
  const ui = fs.readFileSync(new URL('../src/components/OracleTest.jsx', import.meta.url), 'utf8')
  const api = fs.readFileSync(new URL('../api/oracle-interpret.js', import.meta.url), 'utf8')

  assert.match(ui, /spreadId/)
  assert.match(ui, /ORACLE_SPREADS/)
  assert.match(ui, /body: JSON\.stringify\(\{ email: trimmedEmail, cardIds: ids, spreadId \}\)/)

  assert.match(api, /getOracleSpread\(spreadId\)/)
  assert.match(api, /position\.meaning/)
  assert.match(api, /Structure choisie:/)
  assert.doesNotMatch(api, /cardLabels/)
})
