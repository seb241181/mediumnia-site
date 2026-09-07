import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const handlerPath = new URL('../lib/reseauApply.js', import.meta.url)

test('founder attribution is derived server-side from a hashed known invite', async () => {
  const source = await readFile(handlerPath, 'utf8')
  assert.match(source, /createHash\('sha256'\)/)
  assert.match(source, /CONFIRMED_FOUNDER_INVITES/)
  assert.match(source, /FOUNDER_SOURCE_RE/)
  assert.match(source, /resolveFounderInvite/)
  assert.match(source, /membership_type:\s+founderNumber \? 'founder_invited' : null/)
  assert.match(source, /billing_plan:\s+founderNumber \? 'invited_free' : null/)
})

test('founder status is never trusted from body membership fields', async () => {
  const source = await readFile(handlerPath, 'utf8')
  assert.doesNotMatch(source, /membership_type:\s+body\./)
  assert.doesNotMatch(source, /founder_number:\s+body\./)
  assert.doesNotMatch(source, /billing_plan:\s+body\./)
})
