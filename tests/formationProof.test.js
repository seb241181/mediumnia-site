import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const formation = () => fs.readFileSync(new URL('../src/components/FormationPage.jsx', import.meta.url), 'utf8')

test('formation shows a real Module 1 proof before the assistant and checkout', () => {
  const source = formation()
  const proof = source.indexOf('id="formation-apercu-reel"')
  const assistant = source.indexOf('id="essai-assistant"')
  const offer = source.indexOf('id="offre"')

  assert.ok(proof >= 0, 'real formation preview is missing')
  assert.ok(assistant > proof, 'assistant trial must come after pedagogical proof')
  assert.ok(offer > assistant, '597 € offer must stay after both proof layers')
  assert.match(source, /L'Intention comme Porte/)
  assert.match(source, /Avant de recevoir, il faut avoir décidé d'être disponible\./)
  assert.match(source, /On commence toujours par la porte\. Pas par la technique/)
})

test('formation keeps the five-message assistant trial and paid offer intact', () => {
  const source = formation()
  const trial = fs.readFileSync(new URL('../src/components/TrialChat.jsx', import.meta.url), 'utf8')

  assert.match(source, /<TrialChat \/>/)
  assert.match(source, /597 €/)
  assert.match(trial, /const MAX_MESSAGES = 5/)
  assert.match(source, /Tester ensuite MediumIA/)
})
