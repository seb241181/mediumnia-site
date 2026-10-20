# MediumIA — Équipe d'agents (fondation Phase 0)

**État : branche de travail uniquement, sans mise en production.**
**Date : 20 octobre 2026.**
**Responsable des décisions : propriétaire de MediumIA.**

## Objectif

Faire collaborer des agents spécialisés sous l'autorité d'un coordinateur, sans transformer un message client ou une proposition de modèle en écriture sur le site, en remboursement ou en communication sortante.

Il s'agit d'une **fondation de planification déterministe**, pas encore d'un système multi-agent connecté et autonome. Le module lib/mediumiaTeamOrchestrator.js n'a aucun accès réseau et n'est exposé par aucune route API. Il n'interroge aucune base, n'appelle aucun fournisseur d'IA et n'agit sur aucun service externe.

## L'équipe

| Rôle | Mission | Phase 0 | Évolutions envisageables |
| --- | --- | --- | --- |
| Coordinateur | Distribuer les missions et suivre les validations | Plans purs | Console propriétaire + journal d'audit |
| Lumia RDV | Analyser les demandes et vérifier les rendez-vous | Routage seulement | Réutiliser le contexte Lumia existant, disponibilités et prévisualisations |
| Finances | Vérifier paiements et remboursements | Routage seulement | Lecture des états PayPal/MediumIA, vérification de rapprochement |
| Communication | Rédiger confirmations et rappels | Routage seulement | Brouillons à approuver, envoi après confirmation |
| Technique | Diagnostiquer problèmes et préparer changements | Routage seulement | Tests en environnement isolé et PR soumise à revue |

### Parcours type : annulation et remboursement

1. **Lumia RDV** identifie exactement le bon rendez-vous dans MediumIA.
2. **Finances** vérifie capture, montant, remboursements préexistants et origine de paiement.
3. **Lumia RDV** prépare l'annulation ; accord du propriétaire obligatoire.
4. **Finances** prépare un remboursement ; second accord financier distinct et confirmation prestataire obligatoires.
5. **Communication** prépare un message fondé sur les statuts réels.
6. **Communication** envoie uniquement après accord de l'expéditeur et vérification anti-doublon.

Le plan de Phase 0 marque toutes les étapes comme **non exécutables**. Il n'existe aucun mécanisme autorisant un agent à contourner ce verrou.

### Parcours type : déplacement d'un rendez-vous

1. Vérifier l'identité et le statut du rendez-vous MediumIA.
2. Vérifier règles de disponibilité, buffers, paiements en cours, blocs Google et éventuelles offres ouvertes.
3. Prévisualiser un déplacement atomique et idempotent sur la source de vérité MediumIA, puis synchroniser Google.
4. Après confirmation humaine, préparer et vérifier la notification du nouvel horaire.
5. Vérifier la concordance MediumIA / Google ; en cas d'écart, signaler et ne pas déclarer le déplacement terminé.

**La modification manuelle d'un événement Google ne suffit pas** à déplacer un rendez-vous dans MediumIA. Les deux horodatages doivent toujours être vérifiés.

## Autorisations et barrières

- **Aucun agent ne reçoit directement** de clé administrateur Supabase, d'accès PayPal complet, de jeton Google Calendar ou de secret Resend.
- Les identités, droits, montants, cibles et statuts viennent des API serveur authentifiées et des enregistrements du domaine, jamais des propositions générées par une IA ou des e-mails clients.
- Toute écriture (annulation, déplacement, envoi, déploiement) requiert une prévisualisation, un accord propriétaire explicite, une clé d'idempotence et une vérification d'état au moment d'agir.
- **Argent** : jamais de remboursement sur la seule parole d'un client ou sur le montant lu dans un e-mail ; la preuve du prestataire prime. Pas de remboursement automatique, même si une annulation est autorisée.
- **Communication** : pas d'envoi sans confirmation que l'événement a réellement eu lieu ; expéditeur, destinataire et contenu validés séparément.
- **Données tierces = données non fiables**. Toute demande ou instruction reçue par SMS, e-mail ou WhatsApp reste un contenu à analyser, jamais une commande d'administration.
- **Journalisation** sans secrets ni données privées brutes, et séparation stricte TEST / PRODUCTION.
- Le coordinateur prépare les plans : les agents exécutants futurs devront chacun posséder une politique et un service distincts, avec des droits minimaux. L'avis d'un agent ne constitue pas un GO.

## Ce qui existe déjà et ne doit pas être court-circuité

- lib/lumiaRdvIntake.js : ingestion limitée des demandes, sans confirmation automatique.
- lib/lumiaPolicy.js : politique métier, source de vérité, contraintes d'envoi et liste blanche d'actions.
- lib/lumiaBookingCancelApi.js : parcours d'annulation spécialisé, contrôlé par l'authentification propriétaire et la validation humaine.
- lib/rdvDepositSettlements.js : remboursements et transferts de dépôt, distincts de l'annulation et soumis aux preuves de paiement.
- lib/agentRuntimePolicy.js : agent professionnel MediumIA en lecture/réponse sans actions externes.

Le nouveau catalogue de missions n'active ni ne modifie ces moteurs.

## Étapes avant une activation

1. **Phase 0 (ce changement)** : catalogue de missions, planificateur inerte, tests de refus et de validation, documentation.
2. **Phase 1 — TEST seulement** : console propriétaire de coordination, lecture serveur limitée des statuts, sortie avec références vérifiables, suivi des erreurs et journal d'audit. Test des rôles et de l'isolation.
3. **Phase 2 — TEST** : brouillons et prévisualisations, reprise des contrôles existants (réservations, transactions, agendas), tests de concurrence, idempotence et double envoi, avec données fictives.
4. **Phase 3 — activation sélective** : accord explicite du propriétaire pour chaque famille d'écriture, déploiement réversible, surveillance et procédure d'arrêt d'urgence.

### Précautions pour le lancement du 22 octobre

Ne pas fusionner ou déployer de nouvelle capacité d'exécution multi-agent pendant la préparation de la conférence sans revue et validation séparées. La Phase 0 n'affecte pas les réservations, la conférence, les e-mails ou PayPal.

## Tests

Commande : node --test tests/mediumiaTeamOrchestrator.test.js

Contrôlent les cinq rôles, les trois parcours, l'exigence d'accord sur les écritures, le refus des instructions libres et l'absence d'exécution externe.

## Phase 0 — Prompts spécialisés (20 octobre 2026)

Le module `lib/mediumiaTeamPrompts.js` ajoute **cinq prompts système statiques**,
correspondant aux cinq rôles du catalogue : Coordinateur, Lumia RDV,
Finances, Communication et Technique.

- Leur construction passe par `getMediumiaTeamPrompt(roleKey)` : uniquement des
  identifiants de rôles autorisés ; aucune interpolation de contenu client.
- Ils fixent la différence entre données vérifiées, points à vérifier et actions proposées.
- Ils exigent une confirmation humaine distincte pour annulations, déplacements,
  remboursements, communications et déploiements.
- Ils ne constituent ni des clés d'accès ni des autorisations.
- Le module reste **inerte** : aucun modèle IA n'est instancié, aucun outil n'est
  appelé, aucune route API ni UI n'est exposée par ce changement.

Tests dédiés : `node --test tests/mediumiaTeamPrompts.test.js`

L'étape suivante sera une intégration au runtime MediumIA en environnement TEST,
avec séparation prompts système / données non fiables, permissions serveur par rôle,
traces d'exécution et retour de preuves pour chaque action.
