import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChronosphereEmail, normalizeDeliveryEmail } from '../lib/chronosphereEmail.js'

test('normalise et valide l’adresse de livraison Chronosphere', () => {
  assert.equal(normalizeDeliveryEmail('  CLIENT@Example.FR '), 'client@example.fr')
  assert.equal(normalizeDeliveryEmail('adresse-invalide'), null)
  assert.equal(normalizeDeliveryEmail('a'.repeat(250) + '@test.fr'), null)
})

test('échappe les données utilisateur dans l’email Chronosphere', () => {
  const email = buildChronosphereEmail({
    theme: '<script>theme</script>',
    profile: { fullName: '<img src=x onerror=alert(1)>' },
    cards: [{ name: '<b>Carte</b>', block: 'A', density: 'dense' }],
    sky: { timing: { primary: { start: '2026-09-10', end: '2026-09-12', peak: '2026-09-11' }, alternatives: [] } },
    interpretation: '<em>Lecture</em>',
  })

  assert.equal(email.subject, 'Votre ligne de temps CHRONOSPHERE 999')
  assert.match(email.html, /&lt;script&gt;theme&lt;\/script&gt;/)
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(email.html, /&lt;em&gt;Lecture&lt;\/em&gt;/)
  assert.doesNotMatch(email.html, /<script>theme<\/script>/)
})

const emailResult = {
  theme: 'projet',
  profile: { fullName: 'Camille' },
  cards: [{ number: 9, name: 'Le Passage', block: 'Expansion', density: 'fluide' }],
  sky: { timing: { primary: { start: '2026-09-10', end: '2026-09-12', peak: '2026-09-11' }, alternatives: [] } },
  interpretation: 'Une lecture complète.',
}
const packToken = 'A'.repeat(43)

test('email pack avec 2 crédits contient le lien personnel de reprise', () => {
  const email = buildChronosphereEmail(emailResult, { packToken, creditsRemaining: 2 })
  assert.match(email.html, /Il vous reste 2 tirages Chronosphère\./)
  assert.match(email.html, /Utiliser mes 2 tirages restants/)
  assert.match(email.html, new RegExp(`#resume=${packToken}`))
  assert.match(email.text, new RegExp(`#resume=${packToken}`))
  assert.match(email.html, /Ce lien est personnel\. Ne le partagez pas\./)
})

test('email pack avec 1 crédit contient le lien du dernier tirage', () => {
  const email = buildChronosphereEmail(emailResult, { packToken, creditsRemaining: 1 })
  assert.match(email.html, /Il vous reste 1 tirage Chronosphère\./)
  assert.match(email.html, /Utiliser mon dernier tirage/)
  assert.match(email.html, new RegExp(`#resume=${packToken}`))
  assert.match(email.text, new RegExp(`#resume=${packToken}`))
})

test('email pack épuisé ne contient plus le token et propose un nouveau pack', () => {
  const email = buildChronosphereEmail(emailResult, { packToken, creditsRemaining: 0 })
  assert.match(email.html, /Votre pack de 3 tirages est maintenant terminé\./)
  assert.match(email.html, /Obtenir 3 nouveaux tirages — 9,90 €/)
  assert.doesNotMatch(email.html, new RegExp(packToken))
  assert.doesNotMatch(email.text, new RegExp(packToken))
  assert.doesNotMatch(email.html, /#resume=/)
})

test('email single ne contient aucune section ni lien secret de pack', () => {
  const email = buildChronosphereEmail(emailResult)
  assert.doesNotMatch(email.html, /Votre pack Chronosphère/)
  assert.doesNotMatch(email.html, /#resume=/)
  assert.doesNotMatch(email.text, /#resume=/)
})
