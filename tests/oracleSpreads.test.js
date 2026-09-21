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

test('oracle selector is generated after the existing email sequence patch chain', () => {
  const ui = fs.readFileSync(new URL('../src/components/OracleTest.jsx', import.meta.url), 'utf8')
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

  assert.match(ui, /spreadId/)
  assert.match(ui, /ORACLE_SPREADS/)
  assert.match(ui, /body: JSON\.stringify\(\{ email: trimmedEmail, cardIds: ids, spreadId \}\)/)
  assert.match(ui, /spread\.positions\[idx\]\.label/)

  const pilotage = pkg.indexOf('apply-oracle-email-sequence-pilotage.mjs')
  const spreads = pkg.indexOf('apply-oracle-multi-spreads.mjs')
  const formationLead = pkg.indexOf('apply-formation-email-lead.mjs')
  assert.ok(pilotage >= 0 && spreads > pilotage && formationLead > spreads)
})
