# 00 · Historique des migrations Supabase : constat et réconciliation

## Le constat

- `20260926090000_decouverte_credit_568.sql` a été **appliquée en production** : le SQL exact a été collé dans le SQL Editor, et les contrôles d'après migration étaient tous conformes.
- Le SQL Editor **n'écrit rien** dans l'historique de Supabase (`supabase_migrations.schema_migrations`). Cette version n'y figure donc très probablement pas.
- C'est vrai aussi pour beaucoup de migrations plus anciennes du dépôt, appliquées de la même façon.

## La règle

**Aucun `supabase db push` tant que l'historique n'est pas réconcilié.**

`db push` rejoue chaque fichier absent de l'historique. Il rejouerait donc :

- `20260926090000` ;
- des migrations anciennes déjà en place, dont certaines ne sont pas relançables.

Il faut aussi **ne jamais rejouer `20260926090000`**. Elle est bien relançable, mais ce n'est pas le sujet : on enregistre qu'elle est appliquée, on ne la relance pas.

## La méthode officielle : `supabase migration repair`

`supabase migration repair --status applied <version>` écrit seulement une ligne d'historique. Il n'exécute **aucun** SQL de la migration.

Prérequis :

- le CLI Supabase, version 2.x ;
- l'accès au projet, soit par `supabase login`, soit par le mot de passe de la base.

Le mot de passe est saisi dans le terminal du propriétaire. Il n'est jamais écrit dans un fichier, et jamais partagé.

### Étape 1 : constater (lecture seule)

Dans le SQL Editor, lancez les blocs A à E de `00-historique-migrations.sql`.

- Le bloc D doit être **entièrement true**. C'est la preuve que le crédit est en place.
- Si une seule valeur est false, **stop** : envoyez-moi le résultat.

Dans un terminal, à la racine du dépôt :

```bash
supabase link --project-ref uotkpygeqqnekpolezts   # une seule fois, ne modifie pas la base
supabase migration list --linked
```

`migration list` montre, pour chaque version, la colonne **Local** (fichier présent) et la colonne **Remote** (présente dans l'historique). Il est en lecture seule.

### Étape 2 : marquer le crédit comme appliqué, sans le rejouer

À faire seulement si le bloc D est entièrement true :

```bash
supabase migration repair --status applied 20260926090000 --linked
supabase migration list --linked      # 20260926090000 apparaît maintenant côté Remote
```

### Étape 3 : après la migration du parcours (plus tard, avec le GO)

La migration du parcours s'applique **comme d'habitude, dans le SQL Editor** : runbook 01, puis la migration, puis le runbook 02.

Le runbook 02 doit être conforme. Ensuite :

```bash
supabase migration repair --status applied 20260925120000 20261001090000 --linked
```

`20260925120000` (ancien modèle 34 €) est **remplacée** par `20261001090000`, qui crée les mêmes tables avec les règles 597 €. On la marque appliquée pour qu'aucun outil ne la lance un jour. Même lancée par erreur après la 597, elle ne changerait rien : ses tables existent déjà, et ses règles de montant ne sont donc pas recréées. C'est vérifié en répétition.

### Réconcilier tout l'historique (chantier séparé, avant tout futur `db push`)

Pour chaque autre version marquée « Local » sans « Remote » dans `migration list` :

1. vérifier dans le schéma réel que ses objets existent (tables, colonnes, fonctions) ;
2. si c'est le cas, lancer `supabase migration repair --status applied <version> --linked` ;
3. sinon, ne rien marquer et me demander.

Ne jamais marquer en masse sans vérification. Tant que ce n'est pas fait, les migrations continuent d'être appliquées à la main (SQL Editor), une par une, avec leur runbook.

### Sans CLI (dépannage seulement)

`repair` ne fait qu'écrire dans `supabase_migrations.schema_migrations`. Si le CLI est indisponible, ne rien écrire à la main : attendre de l'avoir. Le coût d'attendre est nul, puisque les migrations se font au SQL Editor de toute façon.
