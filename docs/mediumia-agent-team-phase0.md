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

## Tableau de bord Phase 0 — TEST uniquement

- Prototype visuel : `src/components/rdv/MediumiaTeamDashboard.jsx`.
- Trois simulations locales sans dossier client, appel réseau ni écriture.
- L'onglet **Équipe IA** est injecté dans les Coulisses `/rdv` uniquement pour le profil `sebastien-seguin` déjà authentifié, après tous les scripts de migration frontend existants.
- **Désactivé par défaut**. Il requiert la variable de build publique `VITE_MEDIUMIA_TEAM_PHASE0=true`.
- Ce drapeau est paramétré uniquement pour la branche `codex/mediumia-agent-team-phase0` dans le projet Vercel **mediumia-agenda-test**, sur les déploiements Preview. Il n'est pas défini pour le projet public mediumia-site.
- Aucune fonction de pilotage réel, aucune tâche persistée, aucune API, aucun envoi ni remboursement n'est activé.
- Vérification : `tests/mediumiaTeamDashboardPatch.test.js` et build Preview. Ne pas fusionner tant qu'une validation de l'interface et des permissions n'a pas été faite.


## Phase 0 — Bureau de direction, vérification TEST (20 octobre 2026)

- Interface de simulation : src/components/rdv/MediumiaTeamDashboard.jsx.
- Injection de l'onglet dans Les Coulisses par scripts/apply-mediumia-team-dashboard.mjs, à la fin de la chaîne de construction historique.
- Affichage limité au praticien prévu, avec interrupteur de compilation VITE_MEDIUMIA_TEAM_PHASE0, activé seulement dans l'environnement Vercel Preview de la branche codex/mediumia-agent-team-phase0.
- Les variables SUPABASE_URL et VITE_SUPABASE_URL de ce projet Vercel TEST pointent vers le projet Supabase TEST, et non la production.
- PR #168 toujours en brouillon ; aucune fusion vers main ni autorisation d'exécution des agents.
- Vercel TEST : déploiement READY du commit a9c407a1a07ac2f4d6c8afa333853540475701f7, construction Vite réussie. La chaîne prebuild inclut les tests Node et le patch affiche « execution remains disabled ».
- Aucune fonction de messagerie, de remboursement, d'annulation ou de modification de réservation n'est raccordée à cette nouvelle interface.
- Le déploiement est protégé par l'accès Vercel ; aucune validation de parcours par un utilisateur final n'a encore été réalisée dans le navigateur.

**Suite du chantier** : Phase 1, connecter uniquement des contrôles de lecture aux agents en Supabase TEST, puis auditer chaque sortie avant toute mise à disposition d'actions. Ne jamais réutiliser un jeton réel de client ou une clé PayPal LIVE dans les simulations.


## Démonstration IA à un bouton (Phase 1 expérimentale, 20 octobre 2026)

- Le module lib/mediumiaTeamLiveDemo.js fait circuler un cas inventé entre deux rôles IA successifs et indépendants. Aucun texte libre ni identifiant client n'entre dans le moteur.
- L'action de démonstration /api/rdv-admin?action=mediumia-team-demo n'est accessible qu'en Vercel Preview, branche dédiée, et avec le drapeau serveur MEDIUMIA_TEAM_AI_DEMO_ENABLED=true. Aucune action réelle n'est autorisée.
- Le bureau de direction propose un bouton unique « Faire travailler mon équipe IA » quand le serveur est configuré, et indique sinon qu'il faut terminer la connexion.
- Aucun outil ni accès Supabase/Google/PayPal/Resend n'est transmis aux modèles. Les réponses restent des avis sur données fictives, pas des vérifications.
- Les deux drapeaux de préversion sont activés uniquement pour la branche codex/mediumia-agent-team-phase0 dans le projet Vercel mediumia-site, lequel possède déjà une clé Anthropic en environnement Preview. Aucune clé n'a été copiée, et la configuration Production est inchangée.
- L'autre projet Vercel mediumia-agenda-test conserve le simulateur statique ; sa connexion à un modèle IA n'est pas activée.
- La protection Vercel limite l'accès à la préversion et les deux appels IA restent courts ; ne pas fusionner avant validation du propriétaire.

Tests : node --test tests/mediumiaTeamLiveDemo.test.js

Prochaine étape : valider l'appel du modèle en ouvrant la préversion, puis seulement envisager des sources TEST en lecture seule.

### Compatibilité Vercel Hobby

Le projet utilise déjà la limite de 12 fonctions Serverless. La démonstration IA a été intégrée dans la fonction existante api/rdv-admin.js via lib/mediumiaTeamDemoApi.js, sans créer de fonction supplémentaire. L'action reste fermée hors Preview dédié. L'ancienne route dédiée a été retirée après l'échec de construction exceeded_serverless_functions_per_deployment.


## Lecture réelle des données Supabase TEST (Phase 1, 20 octobre 2026)

- **Base autorisée :** Supabase TEST `wnbwhnqiulsdjcvkuwos` exclusivement.
- Une fonction SQL `public.mediumia_team_test_read_v1()` a été créée uniquement sur ce projet via une migration nommée `mediumia_team_test_read_v1_owner_scoped`.
- Fonction `STABLE SECURITY DEFINER` : exige `auth.uid()` et correspondance avec le `owner_id` du praticien `seb-test`; exécution révoquée pour `anon`, accordée à `authenticated`.
- La fonction n'effectue **aucune écriture** et ne renvoie que des compteurs, jusqu'à cinq horaires confirmés, le titre limité de prestation et des états de paiement enregistrés en TEST. Aucun nom, e-mail, téléphone, message, token ou identifiant PayPal n'est retourné.
- L'interface `MediumiaTeamTestRead.jsx` utilise un **client Supabase TEST distinct** et sa propre session : connexion du propriétaire TEST requise une fois dans la préversion.
- Le projet Vercel mediumia-site reçoit uniquement des variables **Preview limitées à `codex/mediumia-agent-team-phase0`**, dont l'URL exacte du projet TEST et une clé publishable publique TEST. Aucun rôle service, aucune variable PROD nouvelle.
- La lecture est déclenchée à la demande par `rpc('mediumia_team_test_read_v1')`. Aucune écriture, aucun remboursement, aucun e-mail, aucune consultation PayPal ni Google. Les états de paiements sont **ceux de la base TEST**, pas une preuve de l'organisme financier.
- Le panneau est séparé de la démonstration à deux modèles IA : **à ce stade, les modèles IA n'ingèrent pas automatiquement les données TEST**. Toute extension d'analyse devra utiliser une vérification serveur du JWT TEST, une synthèse minimisée et des droits de lecture seulement.
- Aucun changement en production MediumIA ; PR #168 toujours brouillon.

Vérification directe de la migration TEST : `anon_can_execute=false`, `auth_can_execute=true`, `security_definer=true`, `volatility=stable`.

**Essai propriétaire :** ouvrir la préversion, trouver « Lumia ouvre les yeux », se connecter au compte MediumIA TEST (pas le compte du site public), puis cliquer sur « Lire mes données TEST ».
