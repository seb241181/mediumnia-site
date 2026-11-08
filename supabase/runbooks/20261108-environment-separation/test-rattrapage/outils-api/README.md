# Rattrapage TEST par l'API de gestion Supabase (HTTPS)

Outil utilisé par Claude depuis un environnement cloud sans accès direct au port PostgreSQL.
Mêmes garanties que `../rattrapage-test.sh` :

- **jeton limité au seul projet TEST** : vérifié avant tout (arrêt si la Production ou un autre projet est visible) ;
- **contrôle du contenu** : la base doit être celle de TEST ;
- **état de départ** : blocs 1 et 2 inscrits dans l'historique ;
- **sauvegarde logique** complète, en lecture seule, reconstruite dans une base locale vide et comparée table par table avant toute modification ;
- **les 3 fichiers de `../sql-editor/`**, une transaction chacun, suivis par nom dans `supabase_migrations.schema_migrations` ;
- **reprise** : après une coupure, l'historique est relu avant toute nouvelle tentative ;
- **contrôles finaux** : `90-verification` sans écart, marqueur « test », données inchangées.

Le jeton est un secret réseau de l'environnement (hôte `api.supabase.com`, `Authorization: Bearer`).
Il est injecté par le proxy et n'apparaît jamais dans les commandes ni dans les journaux.

    python3 -I rattrapage_api.py api            # projet TEST réel
    python3 -I rattrapage_api.py local <base>   # répétition locale (psql sur /tmp/rdvpg:5544)

Répétition locale du 08/11/2026 (réplique de TEST dans l'état « blocs 1 et 2 ») :
sauvegarde de 84 tables, 139 fonctions et 357 lignes reconstruite à l'identique,
3 fichiers appliqués, 0 écart, marqueur « test », relance sans effet.
