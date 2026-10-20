/**
 * MediumIA — rapports fictifs de transmission entre rôles (Phase 0).
 * Aucun client, fournisseur, modèle IA, base de données, API ou effet externe.
 * La simulation illustre les échanges à construire, elle ne les exécute pas.
 */

import { MEDIUMIA_TEAM_MISSIONS, planMediumiaTeamWorkflow } from './mediumiaTeamOrchestrator.js'

export const MEDIUMIA_TEAM_DEMO_VERSION = '2026-10-20.dry-run'

const RESULTS = Object.freeze({
  'rdv.verify': Object.freeze({
    fact: 'DOSSIER FICTIF : un rendez-vous de démonstration a été sélectionné. Aucun client réel n’a été recherché.',
    handoff: 'Au prochain rôle : vérifier les détails dans MediumIA avant toute décision.',
  }),
  'rdv.availability': Object.freeze({
    fact: 'Disponibilité NON VÉRIFIÉE : la plage 9 h 30 – 10 h 30 est une hypothèse d’exercice.',
    handoff: 'Au coordinateur : un contrôle réel des blocs Google, des réservations et des tampons sera indispensable.',
  }),
  'rdv.cancel': Object.freeze({
    fact: 'PROPOSITION UNIQUEMENT : une annulation serait préparée après consentement du propriétaire. Aucune réservation modifiée.',
    handoff: 'Au service Finances : ne jamais considérer une annulation comme la preuve d’un remboursement.',
  }),
  'rdv.reschedule': Object.freeze({
    fact: 'PROPOSITION UNIQUEMENT : décaler un rendez-vous fictif de 8 h à 9 h 30. Aucun agenda ni enregistrement modifié.',
    handoff: 'Au coordinateur : exiger une confirmation cohérente de MediumIA et de Google Agenda.',
  }),
  'finance.verify': Object.freeze({
    fact: 'PAIEMENT FICTIF : exemple d’arrhes à 20 €. Aucune preuve PayPal réelle n’a été consultée.',
    handoff: 'Au prochain rôle : en production, vérifier identifiant de transaction, environnement, montant et doublons.',
  }),
  'finance.refund': Object.freeze({
    fact: 'REMBOURSEMENT NON EFFECTUÉ : exercice sur 20 € fictifs, sans transaction PayPal et sans possibilité d’envoyer de l’argent.',
    handoff: 'Au coordinateur : l’autorisation propriétaire et la confirmation du prestataire restent obligatoires.',
  }),
  'communication.draft': Object.freeze({
    fact: 'BROUILLON SIMULÉ : « Bonjour, votre demande est en cours de vérification. Nous vous confirmerons la suite. »',
    handoff: 'Au contrôle final : ne jamais affirmer une annulation ou un remboursement avant leurs confirmations réelles.',
  }),
  'communication.send': Object.freeze({
    fact: 'AUCUN ENVOI : la mission réclamerait un destinataire confirmé, un accord et une vérification anti-doublon.',
    handoff: 'Fin de démonstration : aucun e-mail, SMS ou message WhatsApp envoyé.',
  }),
  'technique.audit': Object.freeze({
    fact: 'AUDIT FICTIF : l’agent aurait à comparer les statuts MediumIA et les retours du prestataire. Aucun système consulté.',
    handoff: 'Compte rendu à préparer avec les écarts observés et la liste des éléments manquants.',
  }),
})

/**
 * Construit la chronologie d'une démonstration. Un identifiant de workflow non
 * autorisé est refusé, et le paramètre de sortie ne peut modifier aucun état.
 */
export function buildMediumiaTeamDemo(workflowId, visibleCount = 0) {
  const plan = planMediumiaTeamWorkflow(workflowId)
  if (!plan.ok) return Object.freeze({ ok: false, reason: 'unknown_workflow', steps: Object.freeze([]), mode: 'fixture_only' })

  const count = Number.isSafeInteger(visibleCount)
    ? Math.max(0, Math.min(visibleCount, plan.steps.length))
    : 0
  const steps = plan.steps.slice(0, count).map((step) => {
    const report = RESULTS[step.mission]
    if (!report || !MEDIUMIA_TEAM_MISSIONS[step.mission]) {
      throw new Error('missing_demo_report')
    }
    return Object.freeze({
      order: step.order,
      mission: step.mission,
      agent: step.agent,
      simulatedFinding: report.fact,
      handoff: report.handoff,
      ownerApprovalRequired: step.requiresOwnerApproval,
      actionExecuted: false,
      providerVerified: false,
      mode: 'SIMULATION',
    })
  })

  return Object.freeze({
    ok: true,
    workflow: workflowId,
    mode: 'fixture_only',
    version: MEDIUMIA_TEAM_DEMO_VERSION,
    visibleCount: count,
    totalSteps: plan.steps.length,
    complete: count === plan.steps.length,
    externalActionCount: 0,
    modelCalls: 0,
    source: 'données fictives intégrées au code',
    steps: Object.freeze(steps),
  })
}
