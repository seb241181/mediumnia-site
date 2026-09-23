import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)

// The MAX e-mail branch in chronosphereEmail.js only fires when pack.product === 'max3'.
// Every pack object handed to delivery must therefore carry the product type.
test('every delivered pack carries its product so MAX buyers get the MAX e-mail', async () => {
  const timeline = await readFile(timelinePath, 'utf8')
  const packObjects = timeline.match(/pack: isPack \? \{[^}]*\}/g) || []
  assert.ok(packObjects.length >= 2, 'expected the cached and fresh delivery paths')
  for (const packObject of packObjects) {
    assert.match(packObject, /product: maxPack \? 'max3' : 'pack3'/)
  }
})
