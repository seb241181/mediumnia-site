# Soldes visio (#147, PR #148) — réglages Vercel et mise en production

Document de référence pour le GO de mise en production. Rien ici n'est
appliqué automatiquement.

## 1. Durée d'exécution du cron (Vercel)

| Élément | Valeur | Source |
|---|---|---|
| Cron | `/api/rdv-balance-cron`, tous les jours à 07:00 UTC (09:00 Paris) | `vercel.json` → `crons` |
| Fonction exécutée | `api/rdv-config.js` (réécriture `?rdvBalanceAction=cron`) | `vercel.json` → `rewrites` |
| Durée maximale **déclarée** | **300 s** | `vercel.json` → `functions["api/rdv-config.js"].maxDuration` |
| Région | `iad1` | déploiement de production actuel |
| Fluid compute | actif par défaut (projet créé en mai 2026, après le 23/04/2025) | documentation Vercel |

Jusqu'ici la durée n'était déclarée nulle part : elle dépendait du réglage
par défaut du projet, invisible depuis l'API. Elle est maintenant explicite.
Vercel refuse un `maxDuration` supérieur à la limite du plan au moment du
build. La Preview de la branche (état READY) confirme donc que 300 s sont
acceptés pour ce projet.

### Budget du cron

Ordre d'exécution (`lib/rdvBalanceCronHandler.js`) :

1. Libération des annulations revendiquées puis abandonnées (SQL seul).
2. Rappels et annulations du solde.
3. Avis, rappels J-3, SMS, cartes cadeaux, Défi, Lumia, Parcours.
4. **En dernier**, les étapes Google : remise des événements après une
   annulation interrompue, puis reprise des restaurations.

Règles des étapes Google :

- **Fin stricte** à 60 s après le début du cron (`CRON_GOOGLE_PHASE_BUDGET_MS`).
  Si les tâches précédentes ont déjà dépassé ce délai, aucune requête Google
  n'est envoyée et tout est reporté au lendemain.
- **Appels Google coupés** au plus tard à cette échéance (4 s par appel
  maximum), et l'attente globale est elle aussi coupée à l'échéance, même si
  Google ne répond jamais.
- **Alertes** : 10 s supplémentaires au plus après l'échéance.
- **Durée maximale** des étapes Google et des alertes : 70 s après le début
  du cron, bien en dessous des 300 s.

Ces règles sont vérifiées par les tests
« C — tâches précédentes lentes », « C — Google qui ne répond jamais » et
« C — Google lent qui respecte l'abandon ».

## 2. Variables d'environnement (Production)

| Variable | Valeur attendue | Effet |
|---|---|---|
| `RDV_BALANCE_ALERT_EMAIL` | adresse du propriétaire | sans elle, **aucune** annulation automatique (sécurité) |
| `RDV_BALANCE_RESTORE_ENABLED` | **absente** (restauration OFF) | voir § 3 |

## 3. Comportement avec la restauration OFF

**Désactivé (réponse 403 `restore_disabled`, aucune écriture en base) :**

- « Rétablir » une visio annulée pour solde ;
- « Nouveau lien de solde » sur une visio rétablie.

**Reste actif (protections P0, indépendantes de l'interrupteur) :**

- **Alerte et décision du propriétaire** avant toute annulation automatique :
  « Maintenir », « Approuver l'annulation ».
- **Paiements protégés** : aucune annulation pendant un paiement en cours de
  création, d'encaissement ou de vérification.
- **Événement Google remis** après une annulation interrompue :
  - le créneau est revérifié avant toute remise ;
  - si un autre événement occupe le créneau, rien n'est écrit et l'incident
    passe en examen manuel ;
  - si le rendez-vous a déjà commencé, rien n'est modifié dans Google, une
    alerte urgente part et l'incident reste visible.
- **Tableau de bord** : soldes à surveiller et incidents Google.

## 4. Mode de repli prudent

Premier geste en cas d'incident :
`auto_cancel_mode = 'owner_review'`. Plus aucune annulation automatique sans
décision du propriétaire ; tout le reste continue de fonctionner. Les alertes
ne sont jamais désactivées automatiquement.

La requête SQL et le retour arrière complet sont dans
`docs/rdv-balance-147-rollback.sql`.

## 5. Ordre de mise en production (sur GO uniquement)

1. Migration `20261011160000_rdv_balance_owner_review_restore.sql` en PROD.
   L'ancien code reste sûr avec la nouvelle base : sans alerte envoyée,
   aucune annulation n'a lieu.
2. Renseigner `RDV_BALANCE_ALERT_EMAIL`. Laisser
   `RDV_BALANCE_RESTORE_ENABLED` absent.
3. Fusionner la PR et mettre en ligne. Vérifier ensuite les journaux des
   crons du 16/10 et du 17/10 (`[rdv-balance-cron]`, `[rdv-balance-google]`).
4. Toute action sur une réservation réelle (« Maintenir », etc.) se fait
   uniquement sur décision du propriétaire.
