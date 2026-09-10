import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProviderHistory } from '../api/agent-chat.js'

test('approved RAG sources isolate the current user turn from stale assistant answers', () => {
  const history = [
    { role: 'user', content: 'Quel est le code de validation de la mémoire MediumIA ?' },
    { role: 'assistant', content: 'Je ne peux pas te communiquer ce code.' },
    { role: 'user', content: 'Quel est le code de validation de la mémoire MediumIA ?' },
    { role: 'assistant', content: 'Je refuse encore de le communiquer.' },
    { role: 'user', content: 'Quel est le code de validation de la mémoire MediumIA ?' },
  ]

  assert.deepEqual(buildProviderHistory(history, 1), [
    { role: 'user', content: 'Quel est le code de validation de la mémoire MediumIA ?' },
  ])
})

test('ordinary conversation keeps its complete alternating history when no RAG source is used', () => {
  const history = [
    { role: 'user', content: 'Prépare un post.' },
    { role: 'assistant', content: 'Voici un brouillon.' },
    { role: 'user', content: 'Raccourcis-le.' },
  ]

  assert.strictEqual(buildProviderHistory(history, 0), history)
})
