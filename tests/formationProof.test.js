import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const formation = () => fs.readFileSync(new URL('../src/components/FormationPage.jsx', import.meta.url), 'utf8')

test('formation: first screen, payment choices, then expandable information and free trials', () => {
  const source = formation()
  const order = ['id="formation-top"', 'id="offre"', 'id="programme"', 'id="formation-apercu-reel"', 'id="essayer"', 'id="essai-assistant"', 'id="formateur"', 'id="faq"']
  const positions = order.map((marker) => source.indexOf(marker))
  assert.ok(positions.every((p) => p >= 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.match(source, /L'Intention comme Porte/)
  assert.match(source, /Avant de recevoir, il faut avoir décidé d'être disponible\./)
  assert.match(source, /On commence toujours par la porte\. Pas par la technique/)
  assert.match(source, /data-formation-ux="progressive-first"/)
  assert.match(source, /Commencer progressivement ou tout débloquer/)
  assert.match(source, /Ouvrir pour voir le contenu, les 84 exercices/)
})

test('formation keeps the five-message assistant trial and paid offer intact', () => {
  const source = formation()
  const trial = fs.readFileSync(new URL('../src/components/TrialChat.jsx', import.meta.url), 'utf8')

  assert.match(source, /<TrialChat \/>/)
  assert.match(source, /597 €/)
  assert.match(trial, /const MAX_MESSAGES = 5/)
  assert.match(source, /Tester ensuite MediumIA/)
})
