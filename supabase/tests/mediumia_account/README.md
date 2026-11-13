# Espace client (lot 1) : accès et consentement

`scenarios.sql` est un seul bloc de 45 vérifications ; chacune lève une erreur
si le résultat diffère. Le bloc se termine toujours par une exception, donc
**aucune donnée n'est conservée**.

- Succès : `OK_ROLLBACK : 45 vérifications passées, rien n'est conservé`.
- Échec : le message de la vérification en cause.

À jouer sur TEST (éditeur SQL) ou sur une base locale jetable où les quatre
migrations `20261111100000` à `20261111103000` sont appliquées. Jamais en
Production.

Couvert : rattachement par adresse confirmée uniquement, homonymes, plusieurs
adresses, absence de fusion, liste blanche de champs, arrhes réelles, paiement
PayPal en attente jamais compté, droits (`anon` / `authenticated` n'ont accès à
rien), statuts du consentement, pas de réabonnement après désinscription,
journal non modifiable.

Validé sur TEST le 11/11/2026.
