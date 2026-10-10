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
  assert.match(source, /data-formation-ux="simple-checkout-v1"/)
  assert.match(source, /29 €, pour découvrir la méthode/)
  assert.match(source, /Ouvrir pour voir le contenu, les 84 exercices/)
})

test('formation keeps the five-message assistant trial and paid offer intact', () => {
  const source = formation()
  const trial = fs.readFileSync(new URL('../src/components/TrialChat.jsx', import.meta.url), 'utf8')

  assert.match(source, /<TrialChat \/>/)
  assert.match(source, /597 €/)
  assert.match(trial, /const MAX_MESSAGES = 5/)
  assert.match(source, /Commencer la Découverte à 29 €/)
  assert.match(source, /L’assistant MediumIA est facultatif/)
  assert.match(source, /data-formation-positioning="human-first-v1"/)
  assert.match(source, /J’ai conçu et écrit cette méthode/)
  assert.match(source, /La Découverte : l’introduction, le Module 1 complet et ses exercices\./)
  assert.match(source, /travailler ma méthode, pas pour me remplacer/)
  assert.match(source, /Mon approche MediumIA/)
  assert.doesNotMatch(source, /méthode de Sébastien|transmise par Sébastien|créée par Sébastien|conçue et écrite par Sébastien/)
})
