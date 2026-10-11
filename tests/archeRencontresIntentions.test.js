import test from 'node:test'
import assert from 'node:assert/strict'
import { intentionsForChoice } from '../lib/archeRencontresIntentions.js'
test('Intentions courtes : amitié reste non amoureuse ; amour est explicite ; les deux réunissent les intentions', () => {
  assert.deepEqual(intentionsForChoice('amitie'), ['amitie','echanges','binome'])
  assert.deepEqual(intentionsForChoice('amour'), ['coeur','amour'])
  assert.deepEqual(intentionsForChoice('both'), ['amitie','echanges','binome','coeur','amour'])
  assert.deepEqual(intentionsForChoice(''), [])
})
