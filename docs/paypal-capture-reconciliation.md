# PR #156 - confirmation concurrente et reconciliation

## Perimetre et cause

Base : c520bd5c7839aad2197c0aea7ab8ee3bb2e43fd4. Diagnostic GitHub :
https://github.com/seb241181/mediumnia-site/pull/156#issuecomment-6197549556

Un POST capture dont la reponse est perdue peut etre suivi d'un GET encore APPROVED.
Ce resultat intermediaire renvoyait 409, alors que le paiement pouvait etre termine.
Deux workers pouvaient egalement envoyer le POST avec la meme cle PayPal.

## Correctif

- Claim persistant `capture_started_at`, acquis par UPDATE conditionnel atomique
  (id + payment_pending + marqueur IS NULL), avant le seul POST capture autorise.
- Pas de verrou en memoire, pas de bail expirant ni de remise a zero automatique.
- Reconciliation : jusqu'a trois GET, avec attentes 0/100/300 ms et relecture DB
  avant chaque GET. Chaque requete PayPal conserve le timeout existant.
- Si un autre worker a confirme en DB : 200 idempotent. Si COMPLETED est confirme
  par PayPal : meme UPDATE conditionnel paid et meme notification par le gagnant.
- Etat encore incertain : 503 retryable, jamais un nouveau POST pour le resoudre.
- Conflits prouves d'identite/montant/devise : 409 conserve. Pannes DB : 503.
- Questions/contextes, suspension des ventes et message prudent du client inchanges.

## Migration et exploitation

Migration additive locale :
`supabase/migrations/20261015173755_email_question_capture_claim.sql`.
Aucune migration distante executee. Son absence bloque le claim avant le POST
(503), pas de fallback sans verrou. Appliquer avant le code uniquement apres GO
distinct sur l'environnement voulu. Ne pas revenir a un ancien code capturant
sans claim tant que des demandes restent incertaines.

Une interruption entre claim et POST peut laisser une commande non capturee.
C'est volontairement ferme : relecture et examen manuel, jamais reset automatique
ni nouvel achat conseille. Les commandes historiques payment_pending ne prouvent
pas l'absence d'une ancienne tentative ; leur rapprochement reste indispensable
avant toute reprise des ventes. Aucun historique n'est modifie ici.

Notifications : une seule invocation applicative par transition paid ; ceci ne
prouve pas une livraison e-mail exactement une fois face a un crash du fournisseur.
Les tests utilisent des collecteurs, aucun vrai destinataire.

## Validation

Regression reproduite avant correction (409 au lieu de 503), puis 23/23 tests cibles
reussis. PostgreSQL 17 local : 5/5 (4 scenarios + parent), huit connexions avec
BEGIN/COMMIT, un gagnant ; rollback, claim durable, transition paid unique et
nouvelle commande volontaire possibles. Base jetable detruite apres les essais.
ESLint cible reussi. Build complet reussi (bundle V2 et 30 pages prerendues), URL
Supabase TEST et cle factice de compilation, aucun secret ni connexion metier.
Les scripts npm regenerent des fichiers et un deuxieme prebuild sans nettoyage
echoue sur un patch sans rapport (Oracle route callbacks). Aucun correctif etranger
ajoute : sorties generees exclues du commit dans ce checkout uniquement.
Suite complete finale : 868/868, zero echec et zero skip. Aucun test d'integration
PostgreSQL n'est implicitement compte dans npm test : les 5/5 sont un lancement distinct.
Le cluster PostgreSQL temporaire a ete arrete apres suppression de la base jetable.
Aucune transaction PayPal reelle (Sandbox ou Live) dans cette etape.
Production : NO-GO. Pas de fusion, de deploiement ni de reouverture des ventes.
