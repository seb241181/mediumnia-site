import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('Oracle email sequence is visible in the private aggregate pilotage funnel', () => {
  const pilotage = read('src/components/rdv/PilotageDashboard.jsx')
  for (const label of [
    'Propositions 3 exercices vues',
    'Séquences 3 exercices demandées',
    'Désinscriptions séquence 3 exercices',
    'Proposition des 3 exercices vue',
    'Séquence 3 exercices demandée',
  ]) {
    assert.match(pilotage, new RegExp(label))
  }
  const resultIndex = pilotage.indexOf('Résultat obtenu')
  const offerIndex = pilotage.indexOf('Proposition des 3 exercices vue')
  const optinIndex = pilotage.indexOf('Séquence 3 exercices demandée')
  assert.ok(resultIndex >= 0 && offerIndex > resultIndex && optinIndex > offerIndex)
})

test('email pilotage patch remains aggregate-only', () => {
  const patch = read('scripts/apply-oracle-email-sequence-pilotage.mjs')
  assert.match(patch, /oracle_email_optin_view/)
  assert.match(patch, /oracle_email_optin_completed/)
  assert.match(patch, /oracle_email_unsubscribed/)
  assert.doesNotMatch(patch, /visitor_id|session_id|user_id|req\.body\?\.email/)
})
