# PR #158 — Préparation du verrou atomique annulation / paiements
16 octobre 2026 — **Migration préparée, NON APPLIQUÉE**. Aucune annulation réelle.

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
