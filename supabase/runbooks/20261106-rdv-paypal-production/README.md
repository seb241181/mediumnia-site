# Mise en Production — fiabilité du paiement PayPal des rendez-vous

À exécuter uniquement après le GO Production explicite de Sébastien.

1. `00-controles-avant.sql` (lecture seule) : chaque ligne doit afficher `ok`.
2. `01-migration-atomique.sql`, en **une seule transaction** :
   protection des rendez-vous → paiement intégral toutes modalités → fiabilité (ajouts).
3. `02-controles-apres.sql` : essais dans un bloc annulé (paiement intégral en présentiel
   accepté, montant faux refusé), droits réservés au serveur, `essais_conserves_attendu_0 = 0`.
4. Fusion de la branche `rdv-paypal-production` dans `main`, déploiement Vercel Production.
5. Contrôles du site : configuration PayPal Live, disponibilités, journaux Vercel,
   rapprochement en mode rapport pour les paiements du 14/10 et du 03/11 (aucune réparation
   sans décision).

Retour arrière : restauration instantanée Vercel du déploiement précédent, puis
`03-retour-arriere.sql` (après avoir vérifié qu'aucun paiement intégral en présentiel
n'est en cours).

Validé le 06/11/2026 sur une base PostgreSQL locale jetable : 01 s'applique en une
transaction, se rejoue sans erreur, et 03 restaure les versions « visio seule ».
