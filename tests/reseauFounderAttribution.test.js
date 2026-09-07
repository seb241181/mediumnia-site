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

test('Clara founder 004 can be recognized through both confirmed email aliases', async () => {
  const source = await readFile(handlerPath, 'utf8')
  assert.match(source, /36ae4bdd3ffc90317249aad9b04943314c95bf86edee28b080122c7ed1b6ef36', 4/)
  assert.match(source, /3122d97ccce6adf9ed3746a2aa8b17aff1b6983931a43b7b68048dc3b84c4ab4', 4/)
})

test('founder status is never trusted from body membership fields', async () => {
  const source = await readFile(handlerPath, 'utf8')
  assert.doesNotMatch(source, /membership_type:\s+body\./)
  assert.doesNotMatch(source, /founder_number:\s+body\./)
  assert.doesNotMatch(source, /billing_plan:\s+body\./)
})
