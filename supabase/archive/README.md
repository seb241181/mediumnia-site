# Migrations archivées

Ce dossier conserve, pour mémoire, des migrations **qui ne doivent jamais être appliquées**. Le CLI Supabase ne lit que `supabase/migrations/` : rien ici ne peut être lancé par `supabase db push`, `db reset` ou `migration up`.

| Fichier | Pourquoi archivé | Remplacé par |
|---|---|---|
| `20260925120000_formation_parcours_mensuel.sql` | Parcours au mois, ancien modèle 34 € (plafond 397 €), abandonné. Jamais appliqué en production, jamais inscrit dans l'historique Supabase (vérifié le 26/09/2026). | `supabase/migrations/20260926100000_formation_parcours_597.sql` : mêmes tables, colonnes, index, droits et fonction, avec les règles 597 €. |

## Règles

- Ne jamais remettre un fichier d'ici dans `supabase/migrations/`.
- Ne jamais inscrire ces versions dans l'historique (`supabase migration repair`) : elles n'ont jamais été appliquées.
- La preuve d'équivalence et la reconstruction d'une base neuve sont dans `supabase/runbooks/20260926-parcours-597/`.
