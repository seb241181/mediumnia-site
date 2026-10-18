# Reprise Codex - MediumIA

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
  branche et mise a jour de PR #165, autorises par la demande courante. Ne pas fusionner
  ni lancer de deploiement manuel. Les essais transactionnels/test-authentifies attendent
  un GO distinct pour migration Supabase TEST.
- Production : NO-GO. Aucun secret, donnee client, migration distante ou action externe
  conservee ou executee dans cette etape.

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
