# PR #158 — Sécurité annulation / paiements
16 octobre 2026 — **Socle et protection des colonnes appliqués sur Supabase TEST uniquement ; extension remboursements/transferts préparée, NON appliquée.** Aucune annulation réelle.

## Principe proposé

1. L'endpoint conserve le contrôle de propriétaire JWT et l'interrupteur `RDV_OWNER_CANCEL_ENABLED`, éteint par défaut.
2. Le RPC `claim_owner_booking_cancel` prend un verrou SQL sur la réservation, relit les preuves financières et enregistre un identifiant d'annulation durable. Les demandes avec carte cadeau, paiements incertains ou paiements PayPal non rapprochés sont refusées.
3. Les triggers des écritures financières verrouillent la même réservation, puis bloquent toute modification liée à cette réservation tant que le claim est actif. Les captures de solde PayPal et les écritures manuelles ne peuvent pas franchir ce verrou. Le trigger sur les réservations protège leur statut et leurs dates contre les annulations automatiques concurrentes.
4. Après le claim seulement, le service demande la suppression de l'événement Google. Aucune requête de paiement, remboursement ou d'e-mail n'a lieu avant la confirmation Google.
5. Le RPC `finalize_owner_booking_cancel` exige le même claim, puis marque le RDV annulé sans supprimer sa comptabilité. L'e-mail client est une opération distincte post-commit, avec clé d'idempotence.
6. Si Google répond de manière incertaine ou si la finalisation SQL échoue, **aucun effacement automatique du claim, aucune relance de suppression et aucun remboursement**. La situation est à réconcilier manuellement dans Google et dans MediumIA.

## Changements prêts à être relus

- Migration additive `supabase/migrations/20261016060000_owner_booking_cancel_claim.sql` : deux colonnes sur `bookings`, triggers de sérialisation et deux RPC `SECURITY DEFINER` réservés au service role.
- Le code de `lib/rdvOwnerCancellation.js` appelle les RPC avant / après Google au lieu d'alterner des lectures et un `UPDATE` isolé.
- Le bouton reste verrouillé tant que `RDV_OWNER_CANCEL_ENABLED` n'est pas explicitement défini sur `true`.

## Couverture actuelle

- Test transactionnel Supabase TEST **antérieur à cette migration** : annulation logique fictive, seconde annulation sans mutation, conservation d'une écriture fictive de 20 €, puis rollback avec 0 résidu.
- Tests applicatifs avec RPC **simulés** : collision de deux annulations, refus de paiement pendant claim simulé, erreurs de Google, répétition, détention des paiements, contrôle d'accès.
- CI Vercel : à examiner sur la tête de PR et ne pas confondre la compilation avec un test réel de concurrence SQL.

## Ce qui reste à tester sur une base isolée (GO séparé)

- Préflight de schéma et version de la migration ; appliquer la migration **sur Supabase TEST uniquement après un GO explicite**. Les triggers peuvent influer sur les autres transactions de ce projet partagé : prévoir fenêtre/test de non-régression et rollback étudié.
- Tests concurrents sur **plusieurs connexions PostgreSQL réelles** : claim contre insertion de paiement manuel ; claim contre création, claim et finalisation PayPal de solde ; double claim ; Google échoué ; RPC finalize contre annulation automatique et contre actualisation du rendez-vous ; récupération d'un claim bloqué.
- Vérifier les droits RLS, `SECURITY DEFINER`, les transactions existantes de paiement et leur absence de blocage durable ou de deadlock.
- Parcours HTTPS administrateur sur TEST avec clients et Google **fictifs ou simulés**, sans mélanger données/vrai calendrier. Pour une vraie synchronisation Google, accord distinct avec agenda de test.
- Ne jamais utiliser PayPal Live, envoyer d'e-mail réel, annuler un RDV client ou modifier Production dans ce protocole.

**Verdict : NO-GO pour la fusion et NO-GO pour la Production.** La migration et le mécanisme sont prêts à être revus, non validés de bout en bout.


## Mise à jour : remboursements et transferts (à valider)

- **Déjà exécutées en Supabase TEST** : `owner_booking_cancel_claim_test` et `owner_cancel_claim_fields_protection_test`. Validation SQL : propriétaire correct, double claim refusé, écriture comptable refusée durant le claim, finalisation par identifiant ; transactions de test annulées et zéro résidu.
- **Seulement préparée sur GitHub** : `supabase/migrations/20261016063000_owner_booking_settlement_guard.sql`. Cette migration ajoute la sérialisation des insertions/modifications/suppressions de `rdv_payment_refunds` et `rdv_deposit_transfers`. Elle relit et verrouille les anciens ET nouveaux rendez-vous référencés par une modification.
- La nouvelle version de `claim_owner_booking_cancel` refuse l'annulation automatique lorsqu'un dossier de remboursement ou un transfert existe, ainsi que les réservations externes en attente de procédure distincte.
- Script transactionnel prêt, mais **non exécuté** : `tests/sql/rdv_owner_cancel_settlement_guard_test.sql` ; il doit être exécuté après un GO spécifique pour la migration et se termine par ROLLBACK.
- **POINT CRITIQUE RESTANT** : l'effacement Google avant finalisation SQL est une orchestration externe non atomique. La PR #159 de Codex recommande la transition SQL avec job durable de synchronisation Google. Cette architecture doit être tranchée et validée avant la fusion d'un exécuteur.
- Deux PR pour un même écran : UI de #159 privilégiée (tests navigateur, lecture seule), moteur transactionnel #158 à intégrer seulement après validation, sans fusion mécanique des composants concurrents.
- Aucun résultat d'audit financier réel ni identifiant de transaction client dans ce document public.

**NO-GO Production.** Ne pas appliquer automatiquement la migration complémentaire, ne pas activer `RDV_OWNER_CANCEL_ENABLED`, ne pas lancer de suppression Google ni d'e-mail réel.


## Résultats du GO TEST — 16 octobre 2026

**Migration complémentaire appliquée sur Supabase TEST uniquement** :
`owner_booking_settlement_guard_test` (fichier source `supabase/migrations/20261016063000_owner_booking_settlement_guard.sql`).

Contrôle préalable : fonctions et tables requises présentes, zéro claim ouvert, aucun trigger homonyme, absence de transaction longue identifiée. Délai d'attente sur verrou : 2 s ; délai d'exécution : 30 s.

Postflight : deux triggers supplémentaires installés sur `rdv_payment_refunds` et `rdv_deposit_transfers`. Les fonctions sensibles sont réservées au rôle serveur ; aucun changement sur Production.

**Essai SQL effectif** exécuté sur TEST à partir de `tests/sql/rdv_owner_cancel_settlement_guard_test.sql` :
- rendez-vous technique fictif dans une transaction ;
- claim valide acquis, deuxième claim refusé ;
- insertions fictives de remboursement et transfert rejetées (`SQLSTATE 55P03`) pendant ce claim ;
- finalisation avec le claim correct, statut `cancelled` constaté dans la transaction ;
- `ROLLBACK`, puis vérification par requête indépendante : **0 réservation, claim, remboursement et transfert fictifs conservés**.

La migration est **appliquée en TEST**, mais pas en Production. Les essais mono-transactionnels ne prouvent pas la concurrence multi-connexions, l'intégration Google ni les transitions de paiements réels. **PR DRAFT — NO-GO Production**.

## Contrôle complémentaire du rôle authenticated sur TEST — 16/10/2026

- Vérification des grants SQL : `anon` et `authenticated` ne peuvent pas exécuter `claim_owner_booking_cancel`; seul `service_role` le peut. En revanche, le grant historique d'UPDATE existe sur la colonne `owner_cancel_claim_id` : le trigger de protection doit donc effectivement jouer son rôle.
- Première tentative avec le rôle `authenticated` et la politique RLS normale : la réservation fictive était invisible. Ce refus est rassurant mais **ne démontre pas le déclenchement du trigger**.
- Second essai, uniquement sur Supabase TEST : création dans la transaction d'une politique RLS temporaire, limitée à l'UUID de la réservation fictive. Le rôle `authenticated` pouvait alors SELECT cette seule ligne, mais son UPDATE direct des deux champs de claim a été **refusé (`SQLSTATE 42501`)**. Ce contrôle démontre le verrou du trigger lorsque la ligne est visible.
- La transaction incluait `ROLLBACK`; la requête postérieure a confirmé **zéro réservation fictive persistante**. La politique temporaire n'est pas conservée après le rollback.
- Script rejouable : `tests/sql/rdv_owner_cancel_authenticated_guard_test.sql`. Attention : le script crée une politique transitoire exclusivement dans une transaction TEST et ne doit jamais être exécuté en Production.
- Restent NON validés : requête HTTPS réelle portant un JWT client, concurrence sur plusieurs connexions PostgreSQL, orchestrateur Google durable, audit financier indépendant. **NO-GO fusion / Production**.
