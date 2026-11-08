# Rattrapage TEST depuis un ordinateur (SQL Editor Supabase)

À utiliser quand la confirmation interactive du connecteur Supabase ne peut pas
être validée (téléphone). Projet **MediumIA RDV PayPal Test**
(`wnbwhnqiulsdjcvkuwos`) uniquement — jamais la Production.

État de départ : B2-00 contrôlé, bloc 1 appliqué le 08/11/2026
(`b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents`).

| Ordre | Fichier | Contenu | Inscrit dans l'historique |
|---|---|---|---|
| 1 | `1-b2-10-migrations-du-depot.sql` | 13 migrations du dépôt (bloc 2 → rdv_appointment_reminder) | 20261108200000, 20261108200100 |
| 2 | `2-b2-20-b2-30-alignement.sql` | objets hors dépôt + 29 fonctions alignées | 20261108200200, 20261108200300 |
| 3 | `3-garde-environnement-et-signalements.sql` | garde TEST/PROD, marqueur « test », signalements de paiement | 20261108200400 → 20261108200600 |

Pour chaque fichier : bouton **Raw** sur GitHub → tout sélectionner → copier →
Supabase → projet TEST → **SQL Editor** → **New query** → coller → **Run**.
Le dernier résultat affiché liste les migrations inscrites.

Sécurités intégrées à chaque fichier :
- une seule transaction : en cas d'erreur, rien n'est conservé ;
- refus si la base n'est pas TEST (service de Production présent ou `seb-test` absent) ;
- refus d'une seconde exécution et refus si le fichier précédent n'a pas été exécuté ;
- inscription dans `supabase_migrations.schema_migrations` : le suivi des migrations est conservé.

Répétition à blanc du 08/11/2026 sur une réplique fidèle de TEST (bloc 1 appliqué) :
les 3 fichiers passent, 82 → 106 tables, contrôle `90-verification.sql` : 0 écart,
marqueur `test`, refus vérifiés (base non TEST, seconde exécution).

Retour arrière : `../99-retour-arriere-test.sql` puis restauration de la
sauvegarde logique du 08/11/2026 si nécessaire.

Fichiers générés par `generer.py` à partir des migrations et scripts du dépôt
(ne pas les modifier à la main).
