import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  DEFAULT_ORACLE_SPREAD_ID,
  getOracleSpread,
  ORACLE_GUIDED_SPREADS,
  ORACLE_SPREADS,
} from '../src/data/oracleSpreads.js'

test('oracle exposes one free draw plus five optional Lumia guided spreads', () => {
  assert.equal(ORACLE_SPREADS.length, 6)
  assert.equal(ORACLE_GUIDED_SPREADS.length, 5)
  assert.equal(new Set(ORACLE_SPREADS.map((spread) => spread.id)).size, ORACLE_SPREADS.length)

  const free = getOracleSpread(DEFAULT_ORACLE_SPREAD_ID)
  assert.equal(free.kind, 'free')
  assert.deepEqual(free.positions.map((position) => position.label), ['Carte 1', 'Carte 2', 'Carte 3'])

  for (const spread of ORACLE_SPREADS) {
    assert.equal(spread.positions.length, 3)
    assert.ok(spread.name)
    assert.ok(spread.shortDescription)
    assert.ok(['free', 'guided'].includes(spread.kind))
    assert.equal(new Set(spread.positions.map((position) => position.label)).size, 3)

    for (const position of spread.positions) {
      assert.ok(position.label)
      assert.ok(position.meaning)
    }
  }
})

test('free physical draw is the default and unknown ids safely fall back to it', () => {
  assert.equal(DEFAULT_ORACLE_SPREAD_ID, 'tirage-libre')
  assert.equal(getOracleSpread().id, 'tirage-libre')
  assert.equal(getOracleSpread('unknown-spread').id, 'tirage-libre')
})

test('multi-spread patch keeps the printed oracle distinct from Lumia guided methods', () => {
  const patch = fs.readFileSync(new URL('../scripts/apply-oracle-multi-spreads.mjs', import.meta.url), 'utf8')
  const pkg = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

  for (const needle of [
    'ORACLE_GUIDED_SPREADS',
    'spreadId',
    'getOracleSpread',
    "spread.kind === 'free'",
    "tirage libre fidèle au jeu physique",
    "N'attribue aucun rôle prédéfini aux cartes",
    "ne modifient pas les règles de l'oracle imprimé",
    'buildOracleEmail(cards, interpretation, spread)',
  ]) {
    assert.ok(patch.includes(needle), needle)
  }

  const pilotage = pkg.indexOf('apply-oracle-email-sequence-pilotage.mjs')
  const spreads = pkg.indexOf('apply-oracle-multi-spreads.mjs')
  const formationLead = pkg.indexOf('apply-formation-email-lead.mjs')
  assert.ok(pilotage >= 0 && spreads > pilotage && formationLead > spreads)
})
