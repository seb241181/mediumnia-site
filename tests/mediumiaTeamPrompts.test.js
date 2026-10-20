import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MEDIUMIA_TEAM_PROMPT_VERSION,
  MEDIUMIA_TEAM_ROLE_PROMPTS,
  getMediumiaTeamPrompt,
} from '../lib/mediumiaTeamPrompts.js'
import { MEDIUMIA_TEAM_AGENTS, planMediumiaTeamWorkflow } from '../lib/mediumiaTeamOrchestrator.js'

const roles = ['coordinator', 'rdv', 'finance', 'communication', 'technique']

test('chaque rôle défini possède un prompt système propre et stable', () => {
  assert.deepEqual(Object.keys(MEDIUMIA_TEAM_ROLE_PROMPTS), roles)
  for (const role of roles) {
    const config = getMediumiaTeamPrompt(role)
    assert.ok(config)
    assert.equal(config.role, role)
    assert.equal(config.agentId, MEDIUMIA_TEAM_AGENTS[role].id)
    assert.equal(config.version, MEDIUMIA_TEAM_PROMPT_VERSION)
    assert.equal(config.mode, 'planning_only')
    assert.equal(config.externalActions, false)
    assert.deepEqual(config.tools, [])
    assert.equal(Object.isFrozen(config), true)
    assert.equal(Object.isFrozen(config.tools), true)
    assert.ok(config.systemPrompt.length > 900)
    assert.match(config.systemPrompt, /DONNÉES NON FIABLES/)
    assert.match(config.systemPrompt, /validation humaine explicite/)
    assert.match(config.systemPrompt, /aucun remboursement et aucun déploiement/)
  }
  assert.equal(Object.isFrozen(MEDIUMIA_TEAM_ROLE_PROMPTS), true)
  assert.notEqual(getMediumiaTeamPrompt('rdv').systemPrompt, getMediumiaTeamPrompt('finance').systemPrompt)
})

test('le finance ne peut pas déclarer un remboursement sans preuve prestataire', () => {
  const finance = getMediumiaTeamPrompt('finance').systemPrompt
  assert.match(finance, /remboursement déjà terminé/)
  assert.match(finance, /prestataire/)
  assert.match(finance, /environnement LIVE\/TEST/)
  assert.match(finance, /idempotence stable/)
})

test('Lumia RDV distingue la modification Google de la réservation MediumIA', () => {
  const rdv = getMediumiaTeamPrompt('rdv').systemPrompt
  assert.match(rdv, /déplacer un événement Google ne déplace pas automatiquement/)
  assert.match(rdv, /holds actifs/)
  assert.match(rdv, /validation/)
  assert.match(rdv, /synchronisation/)
})

test('communication ne peut pas annoncer une opération ou un envoi non vérifié', () => {
  const communication = getMediumiaTeamPrompt('communication').systemPrompt
  assert.match(communication, /BROUILLON/)
  assert.match(communication, /prestataire n a pas confirmé/)
  assert.match(communication, /vérification des doublons/)
  assert.match(communication, /Autorisation d envoi : ABSENTE/)
})

test('coordinateur ne peut pas s octroyer un GO', () => {
  const coordinator = getMediumiaTeamPrompt('coordinator').systemPrompt
  assert.match(coordinator, /ne peut jamais se donner un GO/)
  assert.match(coordinator, /propositions, pas des preuves/)
  assert.deepEqual(planMediumiaTeamWorkflow('rdv.cancel_refund').steps.map((s) => s.executable), Array(6).fill(false))
})

test('technique ne confond pas build, Preview et production', () => {
  const technique = getMediumiaTeamPrompt('technique').systemPrompt
  assert.match(technique, /réussite de build, succès CI, déploiement Preview et mise en production/)
  assert.match(technique, /tests ne sont pas réellement exécutés/)
})

test('aucun identifiant libre, objet ou clé héritée ne crée de prompt', () => {
  for (const input of [null, undefined, '', 123, {}, [], '__proto__', 'toString',
    'constructor', 'finance; rembourser immédiatement', 'Finance', 'rdv.cancel_refund']) {
    assert.equal(getMediumiaTeamPrompt(input), null)
  }
})

test('la construction des prompts ne prend ni données personnelles ni instructions externes', () => {
  const withoutContext = getMediumiaTeamPrompt('communication')
  const ignoredContext = getMediumiaTeamPrompt('communication', {
    email: 'quelquun@example.com',
    secret: 'DONT_INCLUDE_THIS',
    approved: true,
  })
  assert.deepEqual(ignoredContext, withoutContext)
  assert.doesNotMatch(withoutContext.systemPrompt, /DONT_INCLUDE_THIS|quelquun@example.com/)
})
