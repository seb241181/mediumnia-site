/**
 * MediumIA — équipe d'agents, fondation Phase 0.
 *
 * Planification DÉTERMINISTE uniquement : aucune LLM, aucun outil, aucun appel
 * réseau, aucune lecture de données client, aucune écriture et aucun envoi.
 * Les futures exécutions passent obligatoirement par des API serveur dédiées
 * authentifiées, journalisées, avec autorisation par action et contrôle humain.
 *
 * Ne PAS confondre un plan de mission avec une capacité d'exécution.
 */

export const MEDIUMIA_TEAM_VERSION = '2026-10-20.phase0'

const agent = (id, name, scope) => Object.freeze({
  id, name, scope,
  mode: 'planning_only',
  tools: Object.freeze([]),
  externalActions: false,
})

export const MEDIUMIA_TEAM_AGENTS = Object.freeze({
  coordinator: agent('coordinator', 'Coordinateur MediumIA', 'Affectation, suivi et contrôle'),
  rdv: agent('lumia_rdv', 'Lumia Rendez-vous', 'Demandes, agenda et réservations'),
  finance: agent('finance', 'Finances', 'Contrôle des paiements et remboursements'),
  communication: agent('communication', 'Communication', 'Brouillons, confirmations et rappels'),
  technique: agent('technique', 'Technique', 'Audit, tests et améliorations MediumIA'),
})

const mission = (assignedTo, description, category = 'read') => Object.freeze({
  assignedTo,
  description,
  category,
  requiresOwnerApproval: category !== 'read',
  // Phase 0: même une consultation n'exécute aucun appel réel.
  executable: false,
})

export const MEDIUMIA_TEAM_MISSIONS = Object.freeze({
  'rdv.verify': mission('rdv', 'Vérifier une réservation dans la source de vérité'),
  'rdv.availability': mission('rdv', 'Vérifier les disponibilités et les blocages'),
  'rdv.cancel': mission('rdv', 'Préparer une annulation avec contrôles serveur', 'write'),
  'rdv.reschedule': mission('rdv', 'Préparer un déplacement cohérent agenda + base', 'write'),
  'finance.verify': mission('finance', 'Vérifier paiement, montant, état prestataire et historique'),
  'finance.refund': mission('finance', 'Préparer un remboursement avec preuve PayPal', 'money'),
  'communication.draft': mission('communication', 'Préparer un message pour validation'),
  'communication.send': mission('communication', 'Envoyer un message vérifié une seule fois', 'send'),
  'technique.audit': mission('technique', 'Examiner les écarts de synchronisation'),
  'technique.deploy': mission('technique', 'Déployer une version validée', 'deploy'),
})

function workflow(title, missions) {
  return Object.freeze({
    title,
    missions: Object.freeze([...missions]),
  })
}

export const MEDIUMIA_TEAM_WORKFLOWS = Object.freeze({
  'rdv.cancel_refund': workflow('Annulation et remboursement', [
    'rdv.verify',
    'finance.verify',
    'rdv.cancel',
    'finance.refund',
    'communication.draft',
    'communication.send',
  ]),
  'rdv.reschedule': workflow('Déplacement de rendez-vous', [
    'rdv.verify',
    'rdv.availability',
    'rdv.reschedule',
    'communication.draft',
    'communication.send',
  ]),
  'finance.reconcile': workflow('Vérification financière', [
    'finance.verify',
    'technique.audit',
  ]),
})

const fail = (reason) => Object.freeze({
  ok: false,
  reason,
  version: MEDIUMIA_TEAM_VERSION,
  execution: 'disabled',
  steps: Object.freeze([]),
})

/**
 * Accepte UNIQUEMENT un identifiant de workflow exact.
 * Ne déduit jamais une action à partir du texte d'un client, d'un e-mail ou
 * d'une instruction donnée par un autre agent.
 *
 * Le retour ne contient ni nom de client, ni e-mail, ni token, ni montant.
 * Aucun paramètre utilisateur ne peut activer une écriture ou court-circuiter
 * une validation. Ces barrières doivent également exister côté API serveur.
 */
export function planMediumiaTeamWorkflow(workflowId) {
  if (typeof workflowId !== 'string' || !Object.hasOwn(MEDIUMIA_TEAM_WORKFLOWS, workflowId)) {
    return fail('unknown_workflow')
  }
  const selected = MEDIUMIA_TEAM_WORKFLOWS[workflowId]
  const steps = selected.missions.map((missionId, index) => {
    const item = MEDIUMIA_TEAM_MISSIONS[missionId]
    return Object.freeze({
      order: index + 1,
      mission: missionId,
      agent: MEDIUMIA_TEAM_AGENTS[item.assignedTo].id,
      description: item.description,
      category: item.category,
      requiresOwnerApproval: item.requiresOwnerApproval,
      // Aucun GO transmis au planificateur ne peut activer l'exécution.
      executable: false,
      status: item.requiresOwnerApproval ? 'approval_required' : 'planned_read_only',
    })
  })
  return Object.freeze({
    ok: true,
    workflow: workflowId,
    title: selected.title,
    version: MEDIUMIA_TEAM_VERSION,
    coordinator: MEDIUMIA_TEAM_AGENTS.coordinator.id,
    execution: 'disabled',
    steps: Object.freeze(steps),
  })
}

/**
 * Préparation d'une mission isolée : même contrat sans action externe.
 */
export function planMediumiaTeamMission(missionId) {
  if (typeof missionId !== 'string' || !Object.hasOwn(MEDIUMIA_TEAM_MISSIONS, missionId)) {
    return fail('unknown_mission')
  }
  const m = MEDIUMIA_TEAM_MISSIONS[missionId]
  return Object.freeze({
    ok: true,
    mission: missionId,
    version: MEDIUMIA_TEAM_VERSION,
    agent: MEDIUMIA_TEAM_AGENTS[m.assignedTo].id,
    category: m.category,
    requiresOwnerApproval: m.requiresOwnerApproval,
    execution: 'disabled',
    executable: false,
  })
}
