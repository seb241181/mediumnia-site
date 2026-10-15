# Reprise Codex - MediumIA PR #156

## Mission actuelle

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
