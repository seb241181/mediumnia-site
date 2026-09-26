# 00 · Historique des migrations Supabase : diagnostic et réconciliation

Rien dans ce document n'est à lancer sans un GO explicite. Les blocs SQL de `00-historique-migrations.sql` et `04-controle-historique-final.sql` sont en lecture seule. Les commandes `supabase` qui écrivent sont marquées **ÉCRIT**.

## 1. État réel de la production (vérifié en lecture seule le 26/09/2026)

- `supabase_migrations.schema_migrations` existe et contient **97 versions**. Ce nombre peut évoluer : il ne sert jamais de critère.
- `20260925120000`, `20260925150000`, `20260926090000` et `20260926100000` sont **absentes** de l'historique.
- `public.mediumia_formation_payments` n'existe pas : le parcours n'a jamais été appliqué.
- Le schéma du crédit Découverte 568 € est **présent**. `20260926090000` a été appliquée au SQL Editor, qui n'inscrit rien dans l'historique.

Les dépôts `mediumnia-site` et `mediumnia-app` partagent ce projet, donc cet historique. Aucune version n'est commune aux deux dépôts ; un test du site l'impose pour ses propres versions.

| Version | Dépôt | Réalité | Historique cible |
|---|---|---|---|
| `20260925120000` formation_parcours_mensuel (34 €) | site, **archivée** dans `supabase/archive/` | jamais appliquée | **absente**, ne jamais l'inscrire |
| `20260925150000` parcours_personal_pdfs_and_founder | espace élève | pas encore appliquée ; ses dépendances sont en place (bloc F) | présente, après son application |
| `20260926090000` decouverte_credit_568 | site | appliquée à la main (bloc D) | présente, **sans rejouer son SQL** |
| `20260926100000` formation_parcours_597 | site | pas encore appliquée | présente, après son application |
| les versions déjà inscrites | — | — | **intactes** (empreinte, bloc H puis contrôle 04) |

## 2. L'ancienne `20260925120000` : archivée, jamais inscrite

- **Équivalence démontrée.** `20260926100000` recrée tout ce que `20260925120000` aurait créé : mêmes tables, colonnes, index, règles hors montants, RLS, droits, fonction (au caractère près) et registre recopié. Seules diffèrent les règles de montant, 48 € et 568 € au lieu de 34 € et 368 €. Preuve : `repetition/repetition.mjs`, scénario 0.
- **Sortie de la chaîne active.** Le fichier a été déplacé dans `supabase/archive/`, avec un en-tête « ARCHIVE — NE PAS APPLIQUER » et un `README.md`. Le CLI Supabase ne lit que `supabase/migrations/` : `db push`, `db reset` et `migration up` ne peuvent plus la lancer. Vérifié : sur un historique vide, `db push --dry-run --include-all` propose les 59 migrations actives du site, sans elle.
- **Jamais inscrite dans l'historique.** Elle n'a jamais été appliquée ; l'inscrire serait faux.

## 3. Ce que fait `supabase migration repair --status applied <version>`

Vérifié avec le CLI Supabase 2.118 sur un PostgreSQL local (`repetition/historique-cli.sh`) :

- La commande ajoute une ligne à l'historique : la version, le nom et le **texte** du fichier local. Elle n'exécute **aucune** SQL : sur une base témoin sans le crédit, `repair 20260926090000` laisse les colonnes du crédit absentes.
- Elle ne touche pas aux lignes déjà inscrites.
- Elle se lance **depuis le dépôt qui contient le fichier**, sinon elle échoue (« file does not exist »). Lancer `repair` depuis le même commit que le fichier collé au SQL Editor : le texte inscrit est alors exactement celui qui a été appliqué.

## 4. Ne jamais lancer `supabase db push`, ni suivre ses suggestions

L'historique contient des versions inscrites hors de ce dépôt : d'autres dépôts, ou des migrations créées directement sur Supabase. Depuis le site, `db push` refuse donc de s'exécuter. Il **suggère** alors `supabase migration repair --status reverted <liste>` : ne jamais suivre cette suggestion, elle effacerait des inscriptions réelles.

Les migrations continuent d'être appliquées au SQL Editor, une à une, avec leur runbook.

## 5. Séquence exacte (à ne lancer qu'avec le GO production)

**Prérequis, une seule fois par dépôt :**

- CLI Supabase 2.x ;
- `supabase login` : ouvre le navigateur ; ne jamais coller de jeton dans un fichier ou un message ;
- `supabase link --project-ref uotkpygeqqnekpolezts` : demande le mot de passe de la base, à taper dans le terminal uniquement ; crée `supabase/.temp/`, ignoré par git dans les deux dépôts.
- Si le CLI réclame un `config.toml` dans le dépôt site : `supabase init` (fichier local, sans toucher la base, à ne pas commiter sans en parler).

**Étape 1. Diagnostic (lecture seule).**

- SQL Editor : blocs A à H de `00-historique-migrations.sql`. **Garder le résultat du bloc H** : nombre, liste des versions, empreinte.
- Dans le dépôt site : `supabase migration list --linked` (lecture seule).
- Continuer seulement si C est false partout, D tout true, E vaut 4 × null + false, F tout true et G 3 × false.
- Sinon, stop : envoyez-moi les résultats.

**Étape 2. Inscrire le crédit (ÉCRIT l'historique, pas le schéma).** Dans le dépôt site :

```bash
supabase migration repair --status applied 20260926090000 --linked
```

**Étape 3. Migration du parcours (ÉCRIT le schéma).** Au SQL Editor :

- runbook `01` (noter le bloc G) ;
- puis `supabase/migrations/20260926100000_formation_parcours_597.sql` ;
- puis runbook `02` : synthèse tout true, empreintes = bloc G du 01, bloc 4 vide.

Si ce n'est pas conforme : `03-rollback.sql`, puis stop.

**Étape 4. L'inscrire (ÉCRIT l'historique).** Dans le dépôt site :

```bash
supabase migration repair --status applied 20260926100000 --linked
```

**Étape 5. Migration de l'espace élève (ÉCRIT le schéma).** Au SQL Editor : `supabase/migrations/20260925150000_parcours_personal_pdfs_and_founder.sql` du dépôt `mediumnia-app`, avec son contrôle.

**Étape 6. L'inscrire (ÉCRIT l'historique).** Dans le dépôt `mediumnia-app` :

```bash
supabase migration repair --status applied 20260925150000 --linked
```

**Étape 7. Contrôle final (lecture seule).** SQL Editor, `04-controle-historique-final.sql` :

- **bloc 1** : une ligne `true | true | true | true`, c'est-à-dire les trois versions présentes sous leur nom et `20260925120000` absente ;
- **bloc 2**, après avoir collé la liste du bloc H : `versions_disparues = 0`, et le nombre et l'empreinte **identiques** à ceux du bloc H. L'historique existant est intact ;
- **bloc 3**, pour mémoire : les versions inscrites depuis le 25/09.

Aucun nombre total n'est vérifié : une migration sans rapport inscrite entre-temps ne fausse pas le contrôle. Une version existante modifiée ou disparue le fait échouer (testé).

## 6. Plus tard : base neuve et historique complet (chantier séparé)

`repetition/base-neuve.sh` reconstruit une base **neuve** avec les seules migrations actives des deux dépôts, 59 du site et 6 de l'espace élève, dans l'ordre. La reconstruction réussit, et le schéma du parcours obtenu est identique à celui de la répétition.

Elle a cependant révélé des objets présents en production mais créés par **aucune** migration des dépôts. Ils sont rejoués depuis `repetition/hors-depot/` :

- la table `mediumia_paypal_purchases`, avec son déclencheur `mediumia_paypal_purchase_set_updated_at` ;
- les colonnes `display_name` et `license_number` de `mediumia_students` ;
- le schéma des rendez-vous (`booking_*`), tenu dans `docs/rdv-*.sql` et appliqué à la main.
- le coffre `mediumia-personal-pdfs` (privé, PDF uniquement, 20 Mo) et ses règles `mediumia_personal_pdfs_insert_by_token` / `mediumia_personal_pdfs_select_by_token`, créés le 01/09/2026 par la migration `mediumia_private_pdf_delivery`, absente des deux dépôts. Depuis la correction de `20260925150000`, une base neuve recrée le coffre avec les mêmes propriétés, mais pas encore ses règles par jeton.

Pour qu'un environnement neuf se reconstruise **sans** ce complément, il faudra une migration de rattrapage idempotente, écrite à partir du schéma réel de production (`supabase db dump --schema public`, en lecture seule). C'est un chantier séparé, avec son propre GO. Il faudra aussi comparer les 97 versions inscrites aux fichiers des deux dépôts.
