import test from 'node:test'
import assert from 'node:assert/strict'
import { initialSocialState, socialReducer, canMessage, canLueur, isCloseContact } from '../lib/archeLocalSocial.js'
const act = (state, type, data = {}) => socialReducer(state, { type, ...data })
test('Aucune conversation libre sans consentement, y compris pour un pseudonyme utilisé comme ID', () => {
  const state = initialSocialState()
  for (const id of ['aurore', 'phare', 'Aurore', 'Petit Phare', 'unknown']) {
    assert.equal(canMessage(state, id), false)
    assert.equal(act(state, 'SEND', { id, text: 'Bonjour' }), state)
  }
  assert.equal(act(state, 'ACCEPT', { id: 'Petit Phare' }), state)
})
test('Une invitation acceptée ajoute la rencontre à la messagerie sans créer un proche', () => {
  const state = act(initialSocialState(), 'ACCEPT', { id: 'phare' })
  assert.equal(canMessage(state, 'phare'), true)
  assert.deepEqual(state.encounters, ['phare'])
  assert.equal(isCloseContact('phare'), false)
  assert.equal(canLueur(state, 'phare', true), false)
})
test('Ignorer ou refuser ferme la conversation ; seule une décision explicite peut la rouvrir', () => {
  for (const status of ['ignored', 'refused']) {
    let state = act(initialSocialState(), 'ANSWER', { id: 'aurore', status })
    assert.equal(canMessage(state, 'aurore'), false)
    state = act(state, 'ANSWER', { id: 'aurore', status: 'pending' })
    state = act(state, 'ACCEPT', { id: 'aurore' })
    assert.equal(canMessage(state, 'aurore'), true)
  }
})
test('Le blocage révoque le consentement, efface le fil privé et empêche tous les signaux', () => {
  let state = act(initialSocialState(), 'ACCEPT', { id: 'phare' })
  state = act(state, 'SEND', { id: 'phare', text: 'Message privé fictif' })
  state = act(state, 'SET_BLOCKED', { update: ids => [...ids, 'phare'] })
  assert.equal(canMessage(state, 'phare'), false)
  assert.equal(canLueur(state, 'phare', true), false)
  assert.equal(state.threads.phare, undefined)
  assert.equal(state.consent.phare, undefined)
  assert.deepEqual(state.encounters, [])
  assert.equal(act(state, 'ACCEPT', { id: 'phare' }), state)
  assert.equal(act(state, 'SEND', { id: 'phare', text: 'Relance' }), state)
})
test('Débloquer ne restaure ni consentement, ni historique, ni lien accepté', () => {
  let state = act(initialSocialState(), 'ACCEPT', { id: 'aurore' })
  state = act(state, 'SET_BLOCKED', { update: ['aurore'] })
  state = act(state, 'SET_BLOCKED', { update: [] })
  assert.equal(canMessage(state, 'aurore'), false)
  assert.equal(state.threads.aurore, undefined)
  assert.equal(act(state, 'ACCEPT', { id: 'aurore' }), state)
})
test('La Lueur reste réservée à un proche accepté et au consentement du destinataire', () => {
  const state = act(initialSocialState(), 'ACCEPT', { id: 'aurore' })
  assert.equal(canLueur(state, 'aurore', false), false)
  assert.equal(canLueur(state, 'aurore', true), true)
  assert.equal(canLueur(act(state, 'SET_BLOCKED', { update: ['aurore'] }), 'aurore', true), false)
})
test('Les messages de deux rencontres ne se mélangent pas et le rechargement réinitialise la simulation', () => {
  let state = act(initialSocialState(), 'ACCEPT', { id: 'phare' })
  state = act(state, 'ACCEPT', { id: 'sentier' })
  state = act(state, 'SEND', { id: 'phare', text: '  Bonjour Phare  ' })
  state = act(state, 'SEND', { id: 'sentier', text: 'Bonjour Sentier' })
  assert.deepEqual(state.threads.phare, [{ who: 'me', text: 'Bonjour Phare' }])
  assert.deepEqual(state.threads.sentier, [{ who: 'me', text: 'Bonjour Sentier' }])
  assert.deepEqual(initialSocialState().encounters, [])
})
