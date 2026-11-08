# Séparation TEST / PRODUCTION — plan exact des étapes B à E

Préparé le 08/11/2026 en lecture seule. **Rien n'est exécuté sans GO explicite, opération par opération.**

## 1. Comparaison des schémas (lecture seule, 08/11/2026)

| Élément | Production | TEST | Écart |
|---|---|---|---|
| Tables `public` | 105 | 76 | 35 absentes de TEST (dont 8 `finance_*`, volontairement exclues) ; 6 propres à TEST |
| Fonctions `public` (hors `finance_*`) | 138 | — | 37 absentes de TEST, 25 différentes, 82 identiques ; 25 propres à TEST |
| Colonnes sur tables communes | — | — | 10 tables divergentes (ex. `bookings.appointment_reminder_sent_at`, `agents.workspace_id`) |
| Déclencheurs | 46 | 26 | 28 absents de TEST, dont `trg_on_auth_user_created` sur `auth.users` |
| Politiques RLS `public` | 69 | 25 | 44 absentes de TEST |
| Compartiments de stockage | 3 | 2 | `conference-preparation` absent |
| Comptes (auth) | 30 | 4 | normal |
| Adresses de clients réels dans TEST | — | 0 | conforme |

L'historique des migrations ne peut pas servir de référence : les mêmes migrations portent des noms différents dans les deux projets. La comparaison porte donc sur les objets et leurs empreintes (`90-verification.sql`).

**Absents du dépôt mais présents en Production** (appliqués directement) :
- tables `mediumia_access_codes_v2`, `mediumia_valid_codes`, `oracle_timeline_follow_plans` ;
- colonne `mediumia_students.legacy_code_hash` ;
- 8 fonctions, dont `mediumia_handle_new_user` (création du profil élève à l'inscription) ;
- le compartiment `conference-preparation`.

Ces objets sont repris à l'identique dans `test-rattrapage/20-objets-hors-depot.sql`.

## 2. Rattrapage du schéma TEST (étape B2), dans l'ordre

Toutes les opérations visent **la base TEST uniquement**. Les scripts générés refusent de s'exécuter sur la Production (garde testée).

| # | Opération | Dépendances | Contrôle |
|---|---|---|---|
| B2-00 | `test-rattrapage/00-controle-avant-test.sql` | — | `est_test = true`, 0 adresse réelle |
| B2-01 | **Répétition à blanc** de B2-10 à B2-30 sur TEST : `BEGIN; … ROLLBACK;` (le DDL PostgreSQL est transactionnel ; aucun `CONCURRENTLY` ni `ADD VALUE` dans ces fichiers) | B2-00 | aucune erreur ; rien ne persiste |
| B2-10 | Migrations du dépôt, une transaction chacune, dans cet ordre : `20260827165437_create_oracle_free_draws`, `20260827180000_create_oracle_rate_limits`, `20260829120000_pro_waitlist`, `20260902120000_reseau_applications`, `20260907050000_oracle_email_sequence_subscriptions`, `20260909133000_mediumia_paypal_order_intents`, `20260910140000_mediumia_pro_workspace_shadow`, `20260910181600_mediumia_pro_phase1a_fk_indexes`, `20260910184117_mediumia_pro_phase1b_document_shadow`, `20260911120000_mediumia_pro_phase1b_edge_bridge_support`, `20260923180000_customer_reviews`, `20260924100000_rdv_review_requests`, `20260924120000_gift_cards`, `20260924204500_conference_raffle_eligibility`, `20260925090000_defi_intuition_reminders`, `20260926100000_formation_parcours_597`, `20260927150800_mediumia_pro_reseau_invitations`, `20260928200000_mediumia_pro_public_assistant`, `20260929101207_rdv_appointment_reminder` | ordre chronologique ; espace Pro : 07 → 08 → 09 → 10 → 17 → 18 | arrêt au premier échec |
| B2-20 | `test-rattrapage/20-objets-hors-depot.sql` | B2-10 (`mediumia_students`, droits) | 3 tables, 8 fonctions, déclencheur d'inscription, compartiment |
| B2-30 | `test-rattrapage/30-alignement-fonctions.sql` : les 25 fonctions divergentes reprennent la définition exacte de Production | B2-10, B2-20 | — |
| B2-40 | Données fictives : praticien et prestations de test, compte propriétaire de test lié à `booking_practitioners.owner_id` | B2-30 | aucune donnée de Production copiée |
| B2-90 | `test-rattrapage/90-verification.sql` | tout | **0 ligne** : aucune table ni fonction manquante ou différente |

**Objets propres à TEST conservés** :
- tables `conference_five_*`, `formation_rencontre*`, `chronosphere_max_attempts` ;
- 25 fonctions, dont `claim_owner_booking_cancel` ;
- 8 déclencheurs `guard_owner_cancel_*` sur les tables de paiement.

Ils proviennent de chantiers non fusionnés. Leur suppression n'est pas proposée sans votre décision : les déclencheurs `guard_owner_cancel_*` ne gênaient pas les paiements Sandbox validés le 06/11.

**Retour arrière B2 (TEST)** : `test-rattrapage/99-retour-arriere-test.sql`.
- Il rétablit les 25 fonctions TEST telles que relues avant l'alignement, puis retire les objets de B2-20.
- Il a été testé localement : application, puis retour arrière, puis réapplication.
- Les migrations de B2-10 sont additives ; si besoin, leur retrait se fait objet par objet, sur TEST seulement.

## 3. Les cinq variables Supabase « Preview » (projet Vercel `mediumia-site`)

| Variable | Côté | Valeur Preview | Rôle |
|---|---|---|---|
| `SUPABASE_URL` | serveur | `https://wnbwhnqiulsdjcvkuwos.supabase.co` | toutes les routes `api/*` |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur, **secret** | clé `service_role` du projet TEST | écritures serveur |
| `SUPABASE_PUBLISHABLE_KEY` | serveur | clé publique du projet TEST | client utilisateur de l'assistant (`agent-chat`) |
| `VITE_SUPABASE_URL` | navigateur, figée au build | `https://wnbwhnqiulsdjcvkuwos.supabase.co` | connexion propriétaire / élève |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | navigateur, figée au build | clé publique du projet TEST | idem |

Constat de la préversion du 08/11 : en Preview, `SUPABASE_URL` désigne la Production et `VITE_SUPABASE_URL` est absente.

**Méthode qui ne touche jamais la valeur de Production** :
- si une variable est partagée entre Production et Preview, la *modifier* pour décocher « Preview », sans changer sa valeur, puis en *ajouter* une nouvelle, cochée « Preview » seulement ;
- ne jamais cocher « Production » sur une valeur TEST.

À **vérifier sans les changer**, en Preview :
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` : identifiants Sandbox ;
- `PAYPAL_ENV` ≠ `live` ;
- `RESEND_FROM_EMAIL` : expéditeur TEST ;
- `CRON_SECRET`, `RDV_RATE_LIMIT_SECRET`, `CALENDAR_TOKEN_ENCRYPTION_KEY` : distincts de la Production.

## 4. Interactions vérifiées

| Domaine | Effet de la bascule | Risque |
|---|---|---|
| **Authentification** | Les préversions se connectent aux comptes TEST (4 comptes, propriétaire `sebastien-seguin` présent en TEST). Le déclencheur `trg_on_auth_user_created` manque en TEST : une inscription sur préversion ne créerait pas le profil élève. B2-20 l'ajoute. Les URL de redirection de l'authentification du projet TEST doivent accepter `*-seguins-projects-a1d4673f.vercel.app` (réglage Supabase TEST, à vérifier par vous) | aucun pour la Production |
| **Paiements Sandbox** | Déjà Sandbox en Preview (déduit de `VERCEL_ENV`). Après bascule, les lignes Sandbox vont dans TEST | aucun pour la Production |
| **Webhooks PayPal** | Webhooks Live (Guidance, parcours) : ils visent mediumia.fr et ne sont pas concernés. Les préversions sont protégées par l'authentification Vercel, que PayPal ne peut pas franchir : aucun webhook Sandbox n'y arrive, ni avant ni après | inchangé |
| **Tâches automatiques** | La tâche Vercel `/api/rdv-balance-cron` ne tourne que sur la Production. pg_cron : une seule tâche, en Production (rétention Lumia). Les fonctions Edge (`conference-*`, `agent-documents`) restent dans leur projet Supabase | aucun |
| **E-mails** | Une préversion n'enverra des e-mails qu'aux adresses de TEST, toutes fictives au 08/11 | réduit (aujourd'hui, une préversion peut lire de vraies adresses) |
| **Google Agenda** | Le praticien `sebastien-seguin` de TEST a une connexion Google invalide (`invalid_grant` relevé le 06/11) : sur préversion, ses disponibilités répondront en erreur, et `seb-test` utilise l'agenda fictif. L'agenda Google de Production n'est pas touché | aucun pour la Production |

## 5. Absence de perturbation des réservations et paiements Live

1. **B2 et E1** n'écrivent que sur TEST, et les scripts refusent la Production.
2. **C2** ne modifie que des valeurs « Preview » : le déploiement de Production en cours continue avec ses variables, et le prochain les garde intactes.
3. **E2**, en Production :
   - la migration de garde est **inerte tant que la base n'est pas marquée**, et `activer-production.sql` est une seule insertion ;
   - les déclencheurs ne refusent que des lignes `paypal_env = 'sandbox'`, ce que la Production n'écrit jamais (paiements Live, vérifié sur les 13 tables en local) ;
   - aucun verrou long ni réécriture de table : `CREATE TRIGGER` prend un verrou bref.
4. **E3** : la garde serveur laisse passer les 9 portes de paiement Live en Production (tests). Le déploiement est vérifié par `?environmentCheck=1` **avant promotion**. Si ce n'est pas propre, rien n'est promu.
5. **Fenêtre conseillée** pour E2 et E3 : hors créneaux de rendez-vous et hors cron (07:00 UTC). Par exemple en soirée, après contrôle qu'aucune capture n'est en cours :
   ```sql
   SELECT count(*) FROM rdv_paypal_payments WHERE status = 'capturing';
   ```

## 6. Vérifications de retour arrière

| Après le retour arrière de… | Vérifier (lecture seule) | Attendu |
|---|---|---|
| E3 (code) | `GET https://mediumia.fr/api/rdv-availability?…` et prise de rendez-vous de lecture | `mode: live`, réponses inchangées |
| E3 (code) | Déploiement promu = déploiement précédent (liste Vercel) | ID identique |
| E2 (garde SQL) | `SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'zz_mediumia_no_sandbox%'` | 0 ; marqueur toujours « production » |
| E2 (garde SQL) | Empreintes des fonctions de paiement (`controle-avant.sql` de chaque runbook) | identiques à avant E2 |
| C2 (variables) | `?environmentCheck=1` sur une nouvelle préversion | la garde serveur refuse encore la Production (`consistent: false`) |
| B2 (TEST) | `test-rattrapage/90-verification.sql` | écarts revenus à l'état initial (25 différentes, 37 manquantes) |
| Toujours | Compteurs de Production (rendez-vous, paiements, droits) avant / après | identiques |

## 7. Opérations exactes soumises à votre GO

| # | Opération | Cible | Réversible |
|---|---|---|---|
| 1 | B2-00 puis B2-01 (répétition à blanc) | TEST | oui (rien ne persiste) |
| 2 | B2-10 → B2-30, puis B2-90 | TEST | oui (`99-retour-arriere-test.sql`) |
| 3 | B2-40 : données fictives et compte propriétaire de test | TEST | oui |
| 4 | Me communiquer les cibles des variables Vercel (noms et environnements, sans valeurs) | — | — |
| 5 | C2 : créer les 5 variables Preview → TEST (par vous, ou par moi avec un accès en écriture) | Vercel Preview | oui (supprimer les variables Preview) |
| 6 | D1 : redéployer une préversion et lire `?environmentCheck=1` | préversion | — |
| 7 | D2 : achat Sandbox de 1 € sur préversion, compteurs de Production avant / après | préversion + lecture Production | — |
| 8 | E1 : migration de garde, puis `activer-test.sql` | TEST | oui |
| 9 | E2 : `controle-avant.sql`, migration, `activer-production.sql` | **Production** | oui (`retour-arriere.sql` avec confirmation) |
| 10 | E3 : fusion de #204, vérification avant promotion, promotion | **Production** | oui (« Instant Rollback ») |
| 11 | E4 (optionnel) : `garde-droits-formation.sql` | **Production** | oui |

**Chantier suivant, indépendant** : « Signaler un problème de paiement ». Il est commencé sur une branche locale non poussée, et reprendra après la séparation.
