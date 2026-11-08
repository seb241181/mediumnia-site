# Fin du rattrapage TEST : fichiers SQL

Ces fichiers sont générés par `generer.py` à partir des migrations et scripts du dépôt.
Ne les modifiez pas à la main.

- **Projet :** `wnbwhnqiulsdjcvkuwos` (TEST) uniquement.
- **État de départ :** blocs 1 et 2 déjà appliqués par le connecteur Supabase.

**Méthode recommandée :** `../rattrapage-test.sh`, une seule commande depuis un Mac.
La procédure est décrite dans `../PROCEDURE-MAC.md`.

**Méthode de secours :** exécuter les 3 fichiers un par un, dans l'ordre, dans le
SQL Editor du projet TEST. Les fichiers 1 et 2 sont volumineux.

| Ordre | Fichier | Étapes inscrites dans l'historique |
|---|---|---|
| 1 | `1-b2-10-fin-migrations-du-depot.sql` | `b2_10_bloc3_document_shadow_a_rdv_appointment_reminder` |
| 2 | `2-b2-20-b2-30-alignement.sql` | `b2_20_objets_hors_depot`, `b2_30_alignement_fonctions` |
| 3 | `3-garde-environnement-et-signalements.sql` | `environment_separation_guard`, `activer_test_marqueur`, `payment_issue_reports` |

Chaque fichier :
- s'exécute en une seule transaction ;
- refuse toute base qui n'est pas TEST ;
- refuse une seconde exécution, ainsi qu'une étape précédente manquante (contrôle par nom
  dans l'historique) ;
- s'inscrit dans `supabase_migrations.schema_migrations`.
