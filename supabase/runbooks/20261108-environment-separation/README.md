# Séparation TEST / PRODUCTION — procédure

Chaque étape B à E exige un GO explicite du propriétaire. Rien n'est appliqué par cette branche.

## 1. Inventaire (08/11/2026)

### Accès aux bases

| Accès | Fichier | Base | Garde |
|---|---|---|---|
| Client serveur `service_role` (toutes les routes `api/*` et `lib/*`) | `lib/supabaseAdmin.js` | `SUPABASE_URL` | `assertDatabaseAccess` (échec fermé) ; `isSupabaseConfigured()` faux en cas d'incohérence |
| Client utilisateur de l'assistant (lecture RLS) | `api/agent-chat.js` | `SUPABASE_URL` / `VITE_SUPABASE_URL` | `checkDatabaseAccess` |
| Client navigateur (clé publique + session) | `src/lib/supabase.js` | `VITE_SUPABASE_URL` | `browserDatabaseAllowed` + niveau figé au build |
| Fonctions Edge `conference-public`, `conference-live`, `agent-documents` | `supabase/functions/*` | variables du projet Supabase qui les héberge | isolées par construction (chaque projet n'a que ses propres clés) |
| Tâche Vercel `/api/rdv-balance-cron` (07:00 UTC) | `vercel.json` | client serveur | gardée ; ne tourne que sur les déploiements de Production |
| Tâche pg_cron `lumia-message-inbox-retention` | base Production | interne | sans paiement |
| Suite de tests lancée pendant le build Vercel | `scripts/run-tests-isolated.mjs` | aucune | variables de déploiement et secrets retirés |
| Aucun appel REST Supabase direct, aucun autre `createClient` | — | — | test d'inventaire `tests/environmentGuard.test.js` |

### Fonctions SQL qui écrivent paiements ou droits
`create_rdv_deposit_hold`, `create_rdv_full_payment_hold`, `convert_rdv_deposit_hold`, `create_or_get_rdv_balance_payment`, `finalize_rdv_balance_capture`, `begin_rdv_payment_refund`, `restore_rdv_balance_cancelled_booking`, `reserve_conference_pass_checkout`, `mediumia_grant_purchase_atomic`, `mediumia_grant_purchase_access_atomic`, `mediumia_set_path_entitlement`, `mediumia_claim_access_code`, `mediumia_grant_founder`. Les déclencheurs de la garde SQL couvrent toutes les écritures sur les tables concernées, quelle que soit la fonction.

### Sélection PayPal Live / Sandbox
Toujours dérivée de `VERCEL_ENV` (Production = Live, sinon Sandbox) : arrhes, solde, remboursements, Formation, Découverte, parcours, Guidance e-mail, Pass conférence, cartes cadeaux, ChronoSphère. Une préversion ne peut pas encaisser d'argent réel. Le défaut corrigé ici est uniquement la base.

### Projets Vercel
| Projet | Dépôt | Cible | Base attendue | État relevé |
|---|---|---|---|---|
| `mediumia-site` | ce dépôt | Production (mediumia.fr) + préversions | Prod / TEST | **préversions reliées à la Production** |
| `mediumia-pr156` | ce dépôt | environnement personnalisé « staging » (`VERCEL_ENV=preview`) | TEST | relié à TEST (vérifié le 06/11) |
| `mediumia-agenda-test` | ce dépôt | tous les builds annulés | TEST | inactif |
| `mediumnia-app` (espace.mediumia.fr), `mediumnia-app-test` | autre dépôt | Production | à vérifier | hors périmètre de cette branche |
| `chronosphere`, `chronosphere-max-v1-sprint1`, `chronosphere-landing`, `mediumia` | autres | — | à vérifier | hors périmètre |

Les variables Vercel n'ont pas pu être lues (API : 403, CLI absente) : leurs cibles réelles restent à relever (étape C1).

## 2. Trois protections indépendantes

1. **Garde serveur et navigateur** (`lib/environmentGuard.js`, `src/lib/browserDatabaseGuard.js`) : préversion → TEST seulement ; Production → jamais TEST ; tout paiement exige le couple (base, PayPal) attendu. Diagnostic sans secret : `GET /api/rdv-config?environmentCheck=1`.
2. **Garde SQL** (`20261108130000_environment_separation_guard.sql`, inerte tant que la base n'est pas marquée) : une base marquée « production » refuse toute nouvelle ligne de paiement Sandbox. Droits Formation : script séparé `garde-droits-formation.sql` (GO dédié).
3. **Séparation des variables Vercel** : les préversions reçoivent les valeurs TEST.

Chaque protection suffit à elle seule à empêcher une écriture Sandbox en Production. Un retour arrière ne retire jamais plus d'une protection à la fois.

## 3. Bascule sans interruption

| Étape | Action | Effet sur la Production | GO |
|---|---|---|---|
| B1 | Comparer les schémas TEST / Production (lecture seule) | aucun | non (lecture) |
| B2 | Rattraper le schéma TEST : migrations manquantes du dépôt, sans `finance_*`, données fictives, compte propriétaire de test | aucun | **oui** |
| C1 | Relever les cibles des variables Vercel (noms seulement) | aucun | vous, ou accès en lecture |
| C2 | Sur `mediumia-site`, donner aux variables Supabase des valeurs propres à **Preview** pointant vers TEST (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) ; vérifier PayPal Sandbox, expéditeur e-mail TEST et secrets distincts en Preview. Les valeurs **Production ne sont pas modifiées** | aucun (seuls les nouveaux builds de préversion changent) | **oui** |
| D1 | Redéployer une préversion ; `?environmentCheck=1` doit répondre `tier=preview`, base `test`, `consistent=true` ; `/api/rdv-config?practitioner=…` doit renvoyer les prestations TEST | aucun | non (lecture) |
| D2 | Achat Sandbox de 1 € sur la préversion : la ligne apparaît en TEST, les compteurs de Production sont identiques avant/après | aucun | **oui** (achat Sandbox) |
| E1 | Appliquer la migration de garde SQL en TEST puis `activer-test.sql` | aucun | **oui** |
| E2 | En Production : `controle-avant.sql`, migration, `activer-production.sql` (inerte avant marquage, aucun verrou long) | aucun | **oui** |
| E3 | Fusionner `env-isolation` ; Vercel crée un déploiement de Production. Le vérifier **avant promotion** sur son URL unique : `?environmentCheck=1` doit répondre `tier=production`, bases `production`, `consistent=true`. Promouvoir seulement alors (sinon ne rien promouvoir : le site reste sur la version actuelle) | aucune interruption : la promotion est instantanée et réversible | **oui** |
| E4 | Optionnel : `garde-droits-formation.sql` en Production | aucun | **oui** (droits Formation) |

L'ordre C → D → E évite toute préversion cassée : la garde serveur n'arrive dans `main` qu'après la bascule des variables.

## 4. Retour arrière

| Couche | Comment | Ce qui continue de protéger |
|---|---|---|
| Code (E3) | « Instant Rollback » Vercel vers le déploiement précédent | variables Preview → TEST ; garde SQL |
| Garde SQL (E2) | `SET mediumia.confirm_guard_removal = 'oui';` puis `retour-arriere.sql` (refusé sans cette confirmation ; le marqueur reste) | garde serveur ; variables Preview → TEST |
| Variables (C2) | Supprimer les valeurs propres à Preview | garde serveur (préversions en « configuration requise ») ; garde SQL |

Interdit sans nouveau GO : retirer deux couches en même temps, ou rendre aux préversions des valeurs de Production.

## 5. Tests (aucune base distante)

```
npm test                                   # dont tests/environmentGuard.test.js
PSQLBASE="psql -h <socket> -p <port> -U postgres" ROOT=<dépôt> supabase/tests/environment_separation/run.sh
```
