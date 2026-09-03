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
