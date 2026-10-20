# Reprise Codex - MediumIA

## Résultats concurrence TEST reçus (20 octobre 2026)

- Rapport transmis par le propriétaire : les deux scénarios sur `rdv_admin_reschedule_booking` sont PASS. Clés différentes : A réussit, B retourne `booking_changed`; 70 observations de `pg_blocking_pids(B)` montrent A comme bloqueur et `wait_event_type=Lock`. Clé identique : A réussit et B retourne `idempotent:true`, avec le même blocage observé. Le rapport indique trois PID indépendants, jobs terminés, aucun double historique et nettoyage complet. Codex n’a pas rejoué le protocole.
- Vérification indépendante post-test, en lecture seule via le connecteur Supabase TEST : fixture `seb-test` `confirmed`/`mediumia`, restaurée au 26 octobre 2026 09:00–10:00 UTC; `updated_at=2026-10-20 14:38:45.892236+00`. Acompte clair, prix nominal toujours 7000 centimes; 0 historique, job Google, hold, paiement, écriture financière, remboursement, transfert, gift-card redemption ou offre; aucun événement Google; schéma temporaire absent. Le rapport fourni mentionne aussi 0 job cron temporaire, 0 session QA active et maintien du job Lumia; ces trois points n’ont pas été vérifiés séparément par Codex.
- Ajustement local de `scripts/mediumia_agenda_concurrency_test.py` : le prix nominal `booked_price_cents` n’est plus confondu avec un encaissement. Le préflight continue d’exiger `reservation_payment_kind='none'`, acompte nul, prix nominal non négatif et absence de toutes les lignes financières liées. `--self-test` PASS, y compris cas de prix nominal 7000 accepté et acompte non nul/type avec acompte rejetés.
- Non-régression locale : 909/909 tests Node PASS. `npm test` exécute un `pretest` avec scripts `apply-*`; ceux-ci ont touché 29 fichiers suivis initialement propres. Ces seuls fichiers ont été restaurés après autorisation du contrôle système. `docs/codex-reprise.md`, `src/components/rdv/UnifiedAgenda.jsx` et tous les fichiers non suivis préexistants ont été préservés. À la clôture de cette première étape, aucun build, push, déploiement, migration, RPC mutateur ou changement Production n'avait encore eu lieu.
- Reste à valider avant clôture de la PR : préflight non mutateur complet (triggers, disponibilités/créneaux), tests authentifiés de l’API/UI agenda sur TEST et revue finale du diff. Aucun test de concurrence à relancer sans nouveau GO; Production NO-GO.

## Publication agenda et Preview TEST (20 octobre 2026)

- Commit de code publié sur `codex/admin-unified-agenda`: `97d662efa3959d201de296ba88e1f05550292207`, parent `ff4fecdc7b43bae8ab5457e832817413de2ab249`. Les cinq fichiers du commit sont le compte rendu, `UnifiedAgenda.jsx`, le module de messages, le script de préflight et ses tests. Le distant a été vérifié au SHA publié; aucun push forcé, merge ou changement de `main`.
- Build local standard : `npm run build` PASS, incluant les 909 tests du `prebuild`, Vite, la vérification du bundle ChronoSphère et le pré-rendu de 30 pages. ESLint ciblé, tests agenda 28/28, self-test Python et `git diff --check` PASS. Les réécritures temporaires du `prebuild` ont été restaurées pour les 29 fichiers initialement propres; six fichiers non suivis préexistants ont été conservés hors commit.
- Projet Vercel isolé `mediumia-agenda-test` : déploiement `dpl_HXixwfJW7AhTcswDYjSNGjuAhjQb`, état `READY`, commit Git `97d662efa3959d201de296ba88e1f05550292207`, branche `codex/admin-unified-agenda`. Preview : https://mediumia-agenda-test-arcgvblsn-seguins-projects-a1d4673f.vercel.app
- Contrôle navigateur de `/rdv` sur cette Preview : la page MediumIA répond et présente le formulaire « Connexion praticien ». L’agenda protégé après authentification n’a pas été vérifié faute de session de test disponible; aucun identifiant n’a été demandé ni saisi. Une session autorisée est nécessaire pour finir le smoke test UI.
- Aucune opération Production, paiement, remboursement, message client, modification Google, migration ou fusion. PR #165 reste ouverte; PR #156 non touchée. Production : NO-GO.

## Piste RPC HTTPS (20 octobre 2026)

- Étude sans mot de passe PostgreSQL : le RPC `public.rdv_admin_reschedule_booking(...)` existe sur Supabase TEST et son exécution est accordée à `service_role` seulement; `authenticated` et `anon` sont refusés. L’API REST PostgREST peut techniquement invoquer ce RPC en HTTPS avec une clé serveur, mais cette clé ne doit pas quitter Vercel. Le projet Vercel laboratoire a les variables TEST côté Preview (métadonnées vérifiées sans déchiffrer de secret); aucune variable ni aucun déploiement n’a été modifié.
- Préflight TEST strictement en lecture : fixture unique `seb-test`, synthétique, confirmée, sans événement Google; acompte clair; 0 historique, job Google, hold, paiement, écriture financière, remboursement, transfert, gift card ou offre; RPC présent. Le prix nominal n’est pas une preuve de paiement; le garde-fou local a été corrigé pour cette distinction. `updated_at` doit toujours être relu au lancement. Aucun RPC mutateur ni déplacement appelé dans ce préflight.
- Limite de preuve : deux POST REST parallèles sont possibles mais PostgREST ne garde pas la transaction ouverte après sa réponse et n’expose pas `pg_backend_pid`/`pg_blocking_pids` pour prouver l’attente. Un PASS conforme au protocole de concurrence exige un coordinateur serveur TEST transactionnel avec observation des verrous (ou un helper RPC temporaire, limité à `service_role`, utilisant le RPC existant et `pg_sleep`); cela implique une modification de schéma TEST et une autorisation distincte. Autre prérequis si l’on passe par `/api/rdv-admin`: une session JWT du propriétaire pour l’authentification serveur. Aucune demande de secret ou de mot de passe dans le chat.

## Automatisation locale du test de concurrence (20 octobre 2026)

- Base locale : `codex/admin-unified-agenda`, commit `ff4fecdc7b43bae8ab5457e832817413de2ab249`.
- En cours local : messages français par code API dans `src/lib/rdvAgendaMessages.js`, utilisés par `UnifiedAgenda.jsx`, et tests unitaires dédiés.
- Fixture fournie par le propriétaire : booking `50385d2d-b312-4335-9d47-2fab4a8613dd`, praticien `seb-test`, horaire initial 26 octobre 2026 à 10 h Paris. Les données distantes n'ont pas été lues dans cette préparation; le script revérifie l'identité et le vrai `updated_at` au lancement.
- Script local préparé : `scripts/mediumia_agenda_concurrency_test.py`. Le script `~/Downloads/mediumia_concurrence_test.py` a été audité et rejeté pour cette mission : il crée/supprime une réservation différente et efface des jobs Google.
- Le script dédié n'insère/supprime aucune réservation. Il vérifie l'endpoint TEST avant connexion, l'identité synthétique, le praticien/service, les déclencheurs attendus, l'absence de dépendances paiement/Google/historique, les créneaux et collisions. A/B/C utilisent trois backends indépendants; C exige `pg_blocking_pids(B)` contenant le PID de A et `wait_event_type = Lock`.
- Après les courses, la restauration passe par la RPC. Seules les lignes d'historique du booking, du propriétaire et des clés aléatoires exactes de ce run sont nettoyées; aucun paiement, Google ni rendez-vous n'est supprimé.
- Contrôles locaux : venv Python temporaire `/private/tmp/mediumia-agenda-concurrency-venv-py39`, psycopg v3.2.13 installé; `--self-test`, parsing AST et `--help` PASS. Aucun déplacement ni requête SQL exécutés. La variable de connexion n'a été fournie qu'au processus de contrôle, jamais persistée.
- Préflight distant : le tableau de bord confirme le Session pooler TEST sur 5432. Le mot de passe a été copié depuis Mots de passe macOS sans l'afficher, utilisé en mémoire, puis le presse-papiers a été vidé. Deux tentatives pooler ont échoué en authentification après la rotation. Une tentative directe de diagnostic a également échoué, mais ses détails sont masqués; l'identité DB et le fixture n'ont donc pas été lus. Aucun SQL du préflight n'a été exécuté.
- Diagnostic final (20 octobre) : Supabase Connect affiche explicitement le Session pooler TEST `aws-1-eu-west-3.pooler.supabase.com`, port `5432`, utilisateur `postgres.wnbwhnqiulsdjcvkuwos`, base `postgres`; mode Session et proxy IPv4 confirmés. L’app Mots de passe a été déverrouillée par le propriétaire; l’encodage URI a été validé en mémoire et le presse-papiers vidé ensuite. L’unique lancement `--preflight-only` a échoué avec une erreur de connexion autre, sans classification `28P01` ni signature réseau/IPv6 reconnue. Aucun détail du pilote ni secret n’a été conservé ou rapporté. Le préflight n’a pas atteint les requêtes de contrôle; aucun déplacement/SQL métier n’a été exécuté. STOP : ne pas réessayer, ne pas réinitialiser le mot de passe, ne pas tenter le direct ni les déplacements avant diagnostic séparé et nouvelle autorisation.
- Le mode concurrence `--execute-test-only` n'a pas été exécuté et attend un GO final après préflight réussi. Aucun commit, push, déploiement ou action Production.
- Production : NO-GO.

## Correctif local - simulation agenda TEST sans connexion Google

- Base : branche `codex/admin-unified-agenda`, HEAD local `5b501841`.
- Ajoute un mode de simulation fermé par défaut, activable uniquement par
  `RDV_AGENDA_TEST_SIMULATION=true` dans le Preview du projet Vercel agenda TEST,
  avec l'URL Supabase TEST exacte, le praticien `seb-test`, une adresse
  `qa-interface-...@example.invalid` et `google_event_id IS NULL`.
- Seule la lecture Google d'occupation est omise pour ce jeu de démonstration.
  Les requêtes PostgreSQL de disponibilité et la RPC transactionnelle
  versionnée/idempotente restent obligatoires; les contrôles financiers SQL ne
  sont pas modifiés. Toute autre réservation garde le contrôle Google et renvoie
  `google_calendar_unavailable` si le calendrier est indisponible.
- Vérifications locales : tests agenda ciblés 11/11, ESLint cible et build Vite
  réussis (avertissement préexistant de chunk > 500 kB). Aucun accès Supabase,
  Google, PayPal, e-mail/SMS, migration, push ou déploiement n'a été effectué.
- Restant : revue du diff. Ne pas activer la variable distante, pousser ni
  déployer sans autorisation distincte; vérifier ensuite uniquement le Preview TEST.
- Production : NO-GO.

## Reprise du 18 octobre 2026 - agenda unifie, lot 2

- Projet : seb241181/mediumnia-site ; branche locale codex/admin-unified-agenda.
- PR cible : #165, brouillon. PR #156 conservee sans modification.
- GO du proprietaire : developpement et tests locaux uniquement ; aucun remboursement,
  message client, migration distante, fusion ou changement Production.
- PR #165 demande un reschedule idempotent Paris avec verrou/version, outbox Google
  durable, annulation par le vrai parcours Lumia, historique et aucun remboursement
  automatique. Sa consigne antérieure « aucune action distante » reste respectee ici.
- Termine localement : replanification owner-only, validation des disponibilites,
  buffers, duree de service et heure DST; transaction SQL versionnee et idempotente;
  outbox Google avec reprise GET avant tout second PATCH; historique des deplacements
  et des intentions Lumia; acces a Lumia avec brouillon date/heure sans execution auto.
- Aucun email client ni paiement/remboursement n'est declenche par ces actions.
  Google-only reste sans client/paiement; le registre MediumIA n'est pas affirme comme
  verification provider. Les arrhes restent bloquees aux gardes du noyau Lumia.
- Migration additive preparee seulement :
  supabase/migrations/20261018165006_rdv_agenda_operations.sql. Aucun DDL distant.
- Tests finaux : npm test 902/902, 0 echec, 0 skip; build complet reussi avec
  902 tests, controle bundle ChronoSphere V2 et 30 routes. Tests cibles agenda 16/16.
- ESLint cible sur operations/agenda reussi.
- Test navigateur local et captures non executes : la dependance `playwright` est
  absente de ce checkout. Tentative sur serveur loopback arretee sans appel externe.
- Le cycle npm test/build a ete execute dans une copie jetable car les hooks apply-*
  reecrivent des sources. Deux ancres de patch historiques ont ete alignees au nouveau
  wiring de Lumia. Les sorties de validation n'ont pas ete integrees a la branche.
- Blocage : Docker local absent; PostgreSQL multi-connexion, isolation Supabase TEST,
  transactions Google reelles et parcours authentifie TEST restent non verifies.
  Aucun evenement Google reel n'a ete deplace/annule. La politique n'invente pas de
  difference de remboursement avant/apres H-48 : annulation Lumia existante, aucune
  restitution automatique, arrhes a rapprocher separement.
- Restant : revue SQL avec moteur PostgreSQL; tester concurrence vraie, fuseau/DST,
  buffers, erreurs Google ambigues et reprise; tester les cas <48h/>48h contre TEST;
  verifier affichage admin authentifie TEST; trier les alertes npm audit avant toute
  mise en production.
- Prochaine action exacte : revue technique finale du diff puis commit/push de la
  branche et mise a jour de PR #165 effectues. Commit lot 2 :
  b2b5f13c6e50bb9cc491799148a11ef94dad68b3. La PR reste brouillon, ouverte et non
  fusionnee. Vercel a demarre automatiquement un Preview apres le push; ne pas l'ouvrir
  tant que l'isolation TEST n'est pas prouvee. Ne lancer aucun deploiement manuel.
- Prochaine action exacte : demander un GO distinct pour appliquer la migration sur
  Supabase TEST isole; apres ce GO, executer concurrence PostgreSQL multi-connexion et
  verification authentifiee TEST. Aucun GO TEST recu dans cette etape.
- Production : NO-GO. Aucun secret, donnee client, migration distante ou action externe
  conservee ou executee dans cette etape.

## Revue corrective PR #165 - securite et reprise

- Commentaire de revue traite : #6252742534. La relation PostgREST utilise maintenant
  le filtre sur l'alias `practitioner.owner_id`; la route `agenda-sync` passe par le
  meme helper owner-only que les autres actions agenda.
- Rejeu reschedule : le serveur cherche d'abord l'historique idempotent du proprietaire
  et rejoue le resultat enregistre avant de comparer la version stale ou de recalculer
  les disponibilites. Une cle reutilisee pour un autre creneau est refusee. Un replay
  exact peut relancer le job Google par sa cle durable sans refaire la mutation DB.
- Outbox : un job `pending` orphelin ou `retry` est reprenable par l'action explicite
  owner-only; les erreurs ambigues Google sont reconciliees par GET avant PATCH. Il n'y
  a pas de worker/cron automatique prouve : la reprise depend du retry explicite dans
  l'agenda ou du replay reschedule. Les jobs `review` restent bloques pour intervention.
- Tests locaux de la correction : tests cibles agenda 8/8 reussis, incluant perte de
  reponse puis replay exact sans RPC supplementaire, conflit de cle, reprise pending,
  refus owner fail-closed, PATCH ambigu sans deuxieme mutation et erreur permanente
  en revue. Suite complete : 904/904, aucun echec ni skip; build complet dans une
  copie propre reussi, bundle ChronoSphere V2 verifie et 30 pages generees; ESLint
  cible et verification syntaxique reussis.
- Isolation relue sans dechiffrer de valeurs : Supabase TEST confirme `wnbwhnqiulsdjcvkuwos`;
  les tables `rdv_booking_action_history` et `rdv_calendar_sync_jobs` sont absentes,
  conforme a une migration encore non appliquee. Sur Vercel `mediumia-site`, aucune
  variable Preview ciblee pour `codex/admin-unified-agenda` n'a ete trouvee; des variables
  Preview partagees existent. Leurs valeurs n'ont pas ete dechiffrees, donc la cible
  Supabase et l'absence de capacite d'e-mail reel ne sont pas demontrees. Ne pas ouvrir
  ni utiliser la Preview comme environnement de test. Aucun secret n'a ete dechiffre.
- Blocage publication : pousser sur la branche declenche le deploiement Preview Vercel;
  sans isolation prouvee, la nouvelle version ne doit pas etre publiee/ouverte. Les
  corrections restent locales jusqu'a configuration Preview ciblee TEST sans e-mail
  reel, puis nouvelle verification des seuls noms/cibles d'environnement.
- Restant : migration jamais appliquee; concurrence PostgreSQL multi-connexion, vraie
  auth PostgREST et Google TEST non valides. Pas de worker/cron : reprise de l'outbox
  manuelle owner-only, pas d'engagement de reprise automatique. Aucun remboursement,
  message, mutation Google ou action Production.
- Prochaine action exacte : isoler les variables Preview de `codex/admin-unified-agenda`
  sur Supabase TEST et neutraliser tout transport d'e-mail; ensuite seulement pousser
  la correction pour mise a jour du diff PR #165. Demander ensuite un GO distinct avant
  migration TEST et essais multi-connexion. Ne pas ouvrir la Preview avant preuve.
- Production : NO-GO. PR #156 preservee, migrations non appliquees, aucun changement Google.

## Reprise du 18 octobre 2026 - agenda administrateur

- Projet confirme par le proprietaire : seb241181/mediumnia-site ; issue
  seb241181/mediumia#1 = cahier des charges uniquement.
- Checkout propre isole : /private/tmp/mediumia-unified-agenda.
- Branche : codex/admin-unified-agenda ; base main recuperee :
  23a5df6f06d73984312695e8d3727bcba9d6d694.
- Audit source et plan : docs/admin-agenda-audit.md. Les preuves PayPal historiques
  ci-dessous sont conservees, sans refaire les audits ni modifier la PR #156.
- Termine : lecture issue, clarification depot, audit cible auth/RDV/finance/
  Google/Lumia. Aucun acces ni changement de donnees Production.
- Termine : consultation owner-only, vues jour/semaine/mois Paris, filtres et detail
  des paiements du registre. Pas de verification PayPal distante revendiquee.
- Restant : replanification/annulation protegees, historique, modalite choisie,
  validation authentifiee TEST. Ce lot est volontairement non executable en mutation.
- Blocage technique identifie : le sync Google existant ne deplace pas les
  evenements lies ; ne pas le reutiliser comme une replanification.
- Tests de cette branche : 15 nouveaux tests serveur passes ; npm test 896/896,
  build complet reussi avec 896 tests prebuild, lint cible reussi, 18 controles
  navigateur desktop/mobile fictifs et externes bloques. Captures agenda-captures.
- Les scripts apply-* generent 29 changements hors scope, retires de ce checkout
  uniquement depuis l'index contenant le lot manuel. Ne pas les committer.
- Prochaine action : concevoir la replanification atomique et l'outbox (version,
  conflits/buffers, paiements en cours, reprise Google), puis presenter le SQL local
  avant application distante. Ne pas activer les boutons sans ces protections.
- GO developpement et tests isoles. NO-GO Production, paiement/remboursement reel,
  envoi client, migration distante et fusion. Aucun secret conserve ici.
- Premier commit fonctionnel : 2409ef54f7dc320585eab31ca665867368d8357b.
- PR #165 creee en brouillon, branche poussee ; PR #156 inchangee. Controle GitHub :
  Vercel Preview automatique en cours au premier controle, pas de validation distante
  revendiquee. Aucun deploiement manuel ni Production lance.
- Demo locale fictive : http://127.0.0.1:4193/tests/fixtures/unified-agenda-preview.html?demo
  (serveur Vite local ; aucune donnee/authentification reelle).

## Archives PR #156

## Reprise du 15 octobre 2026 - synchronisation et preflight TEST

- Checkout : /private/tmp/mediumia-pr156-test-validation ; les anciens checkouts
  ne sont plus presents. Aucun travail des autres branches touche. Chemin sans espace
  requis par deux tests existants (leur conversion URL locale est incorrecte).
- PR #156 ouverte/en brouillon, correctif 6dd3a7e1169cf4d54825172bbbe05247df64b529.
- Main recupere : 2465ba068d7935e9bcb33d8fc4deb6e92e7681fa (fusion #157).
- Integration main sans conflit ; les cinq fichiers Coulisses sont identiques a main.
- Supabase TEST wnbwhnqiulsdjcvkuwos interroge uniquement en lecture : colonne absente,
  table compatible, RLS/FORCE RLS actifs et aucun trigger applicatif.
- Aucun DDL distant, paiement, webhook externe, e-mail ou modification Production.
- npm ci verrouille, sans scripts d'installation. npm test final : 868/868, aucun
  echec/skip. Premier passage sous New project : 866/868 a cause du chemin encode.
- Build complet : reussi, 868 tests prebuild, bundle V2 verifie, 30 pages prerendues.
  URL Supabase TEST et cle factice de compilation, aucun secret ni acces metier.
- Sorties generees npm exclues du commit ; fichiers Coulisses identiques a main.
- Registre webhook et RPC claim/finish presents sur TEST, ne pas les reappliquer.
- Rapport/protocole : docs/paypal-test-validation-preflight.md.
- Prochaine action : demander GO migration TEST, sans transaction Sandbox. Une fois
  la colonne verifiee, demander un GO distinct avant le scenario concurrent prepare.
- Attendre ensuite deux GO distincts : migration TEST, puis transactions Sandbox.
- Production : NO-GO ; ventes suspendues et PR en brouillon.

## Mission actuelle

Les sections ci-dessous conservent les preuves de la phase precedente ; le point
de reprise du 15 octobre ci-dessus est prioritaire.

Corriger le faux 409 paypal_capture_unconfirmed et les confirmations concurrentes.
Base exacte : c520bd5c7839aad2197c0aea7ab8ee3bb2e43fd4, branche distante
fix/guidance-paypal-repair-isolated. Checkout isole :
/private/tmp/mediumia-pr156-reconciliation. Worktree historique sale preserve.

## Termine

- Diagnostic du dernier commentaire GitHub repris, sans refaire l'audit Live.
- Regression reproduite : 409 avant correction, puis 503 retryable apres correction.
- Claim DB durable et reconciliation GET bornee implementes, migration locale seulement.
- 23/23 tests cibles, incluant concurrence, un seul POST, reprise et notification unique.
- PostgreSQL local : 5/5 (4 scenarios + test parent), huit connexions/transactions,
  rollback, claim durable, transition paid unique et nouvelle commande possible.
- Suite complete finale : 868/868, zero echec/skip (egalement executee par prebuild).
- npm run build : reussi depuis un checkout sans sorties pretest, bundle V2 valide.
- ESLint cible : reussi.
- Rapport : docs/paypal-capture-reconciliation.md.

## Restant / prochaine action exacte

Verifier le diff indexe et committer uniquement le correctif sur la branche de la PR #156.
Les scripts pretest/prebuild reecrivent des sources et ne sont pas idempotents entre
deux executions : retirer leurs sorties uniquement du checkout cree ici, jamais du
worktree historique. Build valide avec URL publique TEST et cle factice non secrete.
Ne pas reutiliser les credentials ni relancer une transaction Sandbox reelle.

## Limites / decisions

- Ancien audit des huit ordres termine ; ne pas le recommencer.
- Ancien essai Sandbox : capture unique, faux 409 identifie (rapport conserve dans
  /private/tmp/mediumia-pr156/docs/paypal-sandbox-b-results.md).
- Vrai webhook signe et authentification complete de l'admin Preview non valides.
- Claim sans POST apres crash : examen manuel, jamais reset automatique.
- Migration claim preparee et testee localement seulement ; son absence ferme le POST.
- Aucun jeton, serveur d'essai ou collecteur e-mail lance ; cluster PostgreSQL temporaire
  arrete apres suppression de la base jetable. Aucune transaction PayPal dans cette mission.
- GO developpement/tests simules et locaux. NO-GO production, migration distante,
  transaction reelle, fusion et ventes. Aucun secret dans ce point de reprise.

## Travaux anterieurs conserves

- Six P0 precedents : signature PayPal serveur, correlation webhook par order_id puis
  GET, registre prive event_id/capture_id, erreurs transitoires, timeouts et fixtures.
- Validation historique : 32 tests cibles, 854 tests complets, ESLint et build reussis.
- Commits precedents : 4db54de3107354bb8d3d60e9c03827b43fc7566e et
  8cf8855bbbb0b27104ba6e889ae72acc10859343. Preview historique READY,
  POST non signe rejete HTTP 401. Ces preuves ne valent pas webhook signe reel.
- Depuis : laboratoire TEST cree/configure, migration registre appliquee sur TEST,
  solution B executee sans relais public. Ne pas reprendre les etapes historiques
  indiquant encore le contraire dans d'anciens rapports.
- Checkpoint historique complet et rapports Sandbox : /private/tmp/mediumia-pr156/docs/.
