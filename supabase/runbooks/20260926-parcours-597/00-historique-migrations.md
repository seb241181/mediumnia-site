# 00 · Historique des migrations Supabase : diagnostic et réconciliation

Rien dans ce document n'est à lancer sans un GO explicite. Les blocs SQL du fichier `00-historique-migrations.sql` sont en lecture seule. Les commandes `supabase` qui écrivent sont marquées **ÉCRIT**.

## 1. Le constat

**Toutes les migrations ont été appliquées à la main.** On les a collées dans le SQL Editor ; aucune n'est passée par `supabase db push`. Or le SQL Editor n'écrit rien dans l'historique (`supabase_migrations.schema_migrations`). La table d'historique n'existe donc probablement pas, ou elle est vide. Le bloc A le vérifie.

**Une seule base pour deux dépôts.** Les dépôts `mediumnia-site` et `mediumnia-app` partagent un seul projet Supabase, donc un seul historique. Aucune version n'est commune aux deux dépôts : c'est vérifié, et un test du site l'impose pour ses propres versions.

**Le cas de chaque version :**

| Version | Dépôt | Réalité attendue | Preuve (bloc) | Historique cible |
|---|---|---|---|---|
| `20260925120000` formation_parcours_mensuel (34 €) | site | **jamais appliquée** | E : 4 × null + false | **absente**, ne jamais l'inscrire |
| `20260925150000` parcours_personal_pdfs_and_founder | espace élève | pas encore appliquée | G : 3 × false ; ses dépendances sont en place (F) | appliquée, après son application |
| `20260926090000` decouverte_credit_568 | site | **appliquée à la main**, sans historique | D : tout true | appliquée, sans rejouer son SQL |
| `20260926100000` formation_parcours_597 | site | pas encore appliquée | E | appliquée, après son application |

## 2. Pourquoi `20260925120000` ne doit pas être inscrite

`20260926100000` recrée **tout** ce que `20260925120000` aurait créé. C'est démontré sur PostgreSQL 16 : le script `repetition/repetition.mjs`, scénario 0, compare le catalogue des deux bases. Sont identiques :

- les 4 tables et leur RLS ;
- les 39 colonnes (type, nullabilité, défaut) ;
- les 7 index ;
- les 27 règles hors montants, dont la règle d'accès des droits ;
- les policies et les droits des rôles `anon`, `authenticated` et `service_role` ;
- la fonction `mediumia_set_path_entitlement`, au caractère près, avec ses droits ;
- les 3 lignes recopiées dans le registre.

Seules diffèrent, et c'est voulu, les règles de montant : 34 € et 368 € dans l'ancienne, 48 € et 568 € dans la 597.

`20260925120000` n'ayant jamais été appliquée, l'inscrire « appliquée » serait faux : ses règles 34 € n'ont jamais existé. L'historique cible ne la contient donc pas.

Elle restera visible comme « fichier local jamais appliqué » dans `supabase migration list`. C'est exact, et sans danger tant qu'on n'utilise pas `db push` (voir §4). Même lancée par erreur après la 597, elle ne change rien : c'est démontré dans la répétition.

Plus tard, on pourra la sortir du dossier `supabase/migrations/` pour l'archiver. C'est un changement séparé, à décider.

**Si le bloc E montrait au contraire des tables existantes**, elle aurait été appliquée. On l'inscrirait alors telle quelle, puisque ce serait vrai, et la 597 remplacerait ses règles de montant. Ce cas est couvert par le scénario 3 de la répétition. Dans ce cas, stop : envoyez-moi les résultats avant d'aller plus loin.

## 3. Ce que fait `supabase migration repair --status applied <version>`

Vérifié avec le CLI Supabase 2.118 sur un PostgreSQL local (`repetition/historique-cli.sh`) :

- La commande crée la table d'historique si elle n'existe pas.
- Elle y écrit une ligne : la version, le nom, et le **texte** du fichier local.
- Elle **n'exécute pas** ce texte. Preuve : sur une base témoin sans le crédit, `repair 20260926090000` laisse les colonnes du crédit absentes.
- Elle doit être lancée **depuis le dépôt qui contient le fichier**. Sinon elle échoue : « file does not exist ».

## 4. Pourquoi ne jamais lancer `supabase db push`, ni suivre ses suggestions

Répétition faite avec l'historique cible :

- **Depuis le site**, `db push` refuse, parce que `20260925150000` (espace élève) est inscrite sans fichier local. Il **suggère** alors `supabase migration repair --status reverted 20260925150000` : ne jamais suivre cette suggestion.
- `db push --include-all` rejouerait **58 migrations** du site jamais inscrites, dont l'ancienne 34 €.

Les migrations continuent donc d'être appliquées au SQL Editor, une à une, avec leur runbook. L'historique sert de registre fidèle.

## 5. Séquence exacte (à ne lancer qu'avec le GO production)

Prérequis, une seule fois par dépôt :

- CLI Supabase 2.x installé ;
- `supabase login` : ouvre le navigateur ; ne jamais coller de jeton dans un fichier ou un message ;
- `supabase link --project-ref uotkpygeqqnekpolezts` : demande le mot de passe de la base, à taper dans le terminal uniquement. Elle crée des fichiers locaux dans `supabase/.temp/`, ignorés par git dans les deux dépôts.
- Si le CLI réclame un `config.toml` dans le dépôt site, lancer `supabase init` : il crée un fichier local, sans toucher la base. Ne pas le commiter sans en parler.

**Étape 1. Diagnostic (lecture seule).**

- SQL Editor : blocs A à G de `00-historique-migrations.sql`.
- Dans le dépôt site : `supabase migration list --linked` (lecture seule).
- Continuer seulement si D est tout true, E vaut 4 × null + false, F est tout true, G vaut 3 × false, et si A est null ou si C est false partout.
- Sinon, stop : envoyez-moi les résultats.

**Étape 2. Inscrire le crédit (ÉCRIT l'historique, pas le schéma).** Dans le dépôt site :

```bash
supabase migration repair --status applied 20260926090000 --linked
```

**Étape 3. Migration du parcours (ÉCRIT le schéma).** Au SQL Editor :

- runbook `01-avant-migration.sql` (noter le bloc G) ;
- puis `supabase/migrations/20260926100000_formation_parcours_597.sql` ;
- puis `02-controle-apres-migration.sql` : synthèse tout true, empreintes = bloc G du 01, bloc 4 vide.

Si ce n'est pas conforme : `03-rollback.sql`, puis stop.

**Étape 4. Inscrire la migration du parcours (ÉCRIT l'historique).** Dans le dépôt site :

```bash
supabase migration repair --status applied 20260926100000 --linked
```

**Étape 5. Migration de l'espace élève (ÉCRIT le schéma).** Au SQL Editor : `supabase/migrations/20260925150000_parcours_personal_pdfs_and_founder.sql` du dépôt `mediumnia-app`, avec son contrôle.

**Étape 6. L'inscrire (ÉCRIT l'historique).** Dans le dépôt `mediumnia-app` :

```bash
supabase migration repair --status applied 20260925150000 --linked
```

**Étape 7. Contrôle final (lecture seule).** SQL Editor, bloc B. Attendu, exactement :

```
20260925150000  parcours_personal_pdfs_and_founder
20260926090000  decouverte_credit_568
20260926100000  formation_parcours_597
```

`20260925120000` ne doit pas apparaître.

## 6. Plus tard : réconcilier tout l'historique (chantier séparé)

Les 57 autres migrations du site et celles de l'espace élève restent non inscrites. Pour chacune :

1. vérifier ses objets dans le schéma réel ;
2. si tout y est, lancer `repair --status applied` depuis son propre dépôt ;
3. sinon, ne rien inscrire.

Jamais en masse, jamais sans vérification.
