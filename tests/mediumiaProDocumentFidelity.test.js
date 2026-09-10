import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAgentInstructions } from '../lib/agentRuntimePolicy.js'

test('financial and administrative sources preserve labels, amounts and component relationships', () => {
  const instructions = buildAgentInstructions({
    name: 'Copilote test',
    mission: 'Aider le praticien',
  }, '[Declaration test - extrait 1]\nMontants totaux 5 677 € 1 212 € 1 204 € 6 € 2 €')

  assert.match(instructions, /FIDELITE DOCUMENTAIRE FINANCIERE ET ADMINISTRATIVE/)
  assert.match(instructions, /conserve les intitules exacts/)
  assert.match(instructions, /Ne dis jamais qu'un poste est inclus dans un autre/)
  assert.match(instructions, /verifie que leur somme correspond au total/)
  assert.match(instructions, /cotisations, contributions, taxes et impots/)
  assert.match(instructions, /signale explicitement l'ambiguite/)
  assert.match(instructions, /donne d'abord la valeur demandee et son libelle exact/)
})

test('document fidelity rules remain subordinate to MediumIA platform secret protections', () => {
  const instructions = buildAgentInstructions({}, '')

  assert.match(instructions, /Protege uniquement les vrais secrets d'acces ou de plateforme/)
  assert.match(instructions, /FIDELITE DOCUMENTAIRE FINANCIERE ET ADMINISTRATIVE/)
})
