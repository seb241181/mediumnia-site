# Préversions isolées, validation du bouton « Signaler un problème de paiement » et mise en Production

Ce document s'applique une fois le rattrapage TEST terminé
(`test-rattrapage/PROCEDURE-MAC.md`). Il complète `PLAN-B-E.md`, sections 3 à 7.

Les opérations marquées **[Vous]** sont à faire dans un tableau de bord. Aucun secret ne doit
transiter par une conversation. Celles marquées **[Claude]** ne sont que des lectures, et
seulement sur TEST.

## 1. Variables « Preview » du projet Vercel `mediumia-site` [Vous]

Vercel, projet **mediumia-site**, puis **Settings > Environment Variables**.

| Variable | Valeur, pour **Preview uniquement** | Où la trouver |
|---|---|---|
| `SUPABASE_URL` | `https://wnbwhnqiulsdjcvkuwos.supabase.co` | — |
| `VITE_SUPABASE_URL` | `https://wnbwhnqiulsdjcvkuwos.supabase.co` | — |
| `SUPABASE_SERVICE_ROLE_KEY` | clé secrète `service_role` du projet TEST (cochez « Sensitive ») | Supabase TEST > Project Settings > API Keys |
| `SUPABASE_PUBLISHABLE_KEY` | clé publique du projet TEST | idem |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | clé publique du projet TEST | idem |
| `RDV_RATE_LIMIT_SECRET` | 64 caractères aléatoires, **différents de la Production** (`openssl rand -hex 32` dans Terminal) | à créer |
| `PAYMENT_ISSUE_OWNER_EMAIL` (facultatif) | votre adresse de réception des alertes de test | — |

Pour chaque variable :

1. Si une ligne existe déjà avec **Production** et **Preview** cochés, ouvrez **⋯ > Edit**,
   décochez **Preview** et enregistrez **sans toucher à la valeur**. Cette ligne devient
   « Production » seule.
2. Cliquez sur **Add New** : saisissez la clé, puis la valeur TEST. Pour **Environments**,
   cochez **Preview seulement**, jamais Production. Enregistrez.
3. Ne supprimez ni ne modifiez aucune valeur de Production.

À **contrôler sans rien changer**, en Preview :
- `PAYPAL_ENV` et `PAYPAL_RDV_DEPOSIT_ENV` ne valent pas `live` ;
- `PAYPAL_CLIENT_ID` et `PAYPAL_CLIENT_SECRET` sont des identifiants **Sandbox** ;
- `RESEND_FROM_EMAIL` est un expéditeur de test.

**Authentification Supabase TEST.** Dans Supabase TEST, ouvrez Authentication > URL Configuration
> Redirect URLs et ajoutez `https://*-seguins-projects-a1d4673f.vercel.app/**` pour que la
connexion fonctionne sur les préversions.

## 2. Redéploiement et contrôle d'isolation [Vous, puis Claude]

1. **Redéploiement.** Dans Vercel > Deployments, ouvrez la dernière préversion de la branche
   `payment-issue-report` > **⋯ > Redeploy**, en **décochant** « Use existing Build Cache ».
   Les variables `VITE_*` sont figées au moment du build.
2. **Contrôle.** Connecté à Vercel, ouvrez `https://<préversion>/api/rdv-config?environmentCheck=1`.
   Résultat attendu : `"tier":"preview"`, `"database":{"server":"test","browser":"test"}`,
   `"consistent":true` et `"problems":[]`. Envoyez cette réponse à Claude : elle ne contient
   aucun secret.
3. **Si ce n'est pas le cas**, la garde serveur refuse déjà toute écriture vers la Production
   depuis une préversion, donc rien ne peut fuiter. Il faut corriger les variables, puis
   redéployer.

## 3. Validation du bouton sur la préversion (PayPal Sandbox uniquement)

Le bouton n'appelle jamais PayPal. Le signalement s'enregistre dans TEST, une alerte part vers
l'adresse du propriétaire, et un accusé de réception part vers l'adresse saisie. Pour ces
essais, n'utilisez que **vos propres adresses**.

| # | Scénario | Où | Attendu |
|---|---|---|---|
| 1 | Le bouton est présent | `/chronosphere`, `/chronosphere-max`, `/rdv/seb-test`, `/rdv/solde`, `/formation`, `/formation/parcours`, `/question`, `/cartes-cadeaux`, `/pass/mediumia/…`, `/conferences`, `/oracle` | Bouton en bas à gauche, au-dessus du bouton « compte » |
| 2 | Le bouton est absent | `/`, `/mentions`, `/rdv`, `/pro`, `/reseau` | Aucun bouton |
| 3 | Signalement normal | `/chronosphere-max` : formulaire rempli avec votre adresse | Référence `PB-XXXXXXXX` affichée ; une alerte et un accusé reçus |
| 4 | Contexte après échec Sandbox | `/rdv/seb-test` : lancez un paiement Sandbox, annulez-le dans la fenêtre PayPal, puis signalez | Étape « cancelled » et identifiant de commande joints automatiquement |
| 5 | Session expirée ou rechargement | Rechargez la page après le scénario 4, puis signalez | Contexte conservé (48 h) |
| 6 | Doublon | Renvoyez le même signalement aussitôt | Même référence, aucun nouvel e-mail |
| 7 | Solde RDV | `/rdv/solde?token=…` (lien de test) > « Signaler un problème » | Signalement enregistré **sans** le jeton du lien |
| 8 | Saisie d'un numéro de carte | Commentaire « carte 4970 1012 3456 7890 » | Enregistré comme `[numéro masqué]` |
| 9 | Tableau propriétaire autorisé | Les Coulisses > Incidents, connecté avec le compte propriétaire TEST | Liste, filtres, « Prendre en charge », note, « Marquer résolu », historique |
| 10 | Accès non autorisé | Même écran avec un compte élève TEST | Message « Réservé à l'administration », aucune donnée |

**Ce que Claude vérifie ensuite, en lecture seule sur TEST :**
- les lignes de `payment_issue_reports` et `payment_issue_events` ;
- l'absence de toute nouvelle commande ou capture PayPal, et de toute réservation modifiée,
  en comparant les compteurs avant et après ;
- aucun accès à la Production.

## 4. Mise en Production, ordre exact (sur votre GO explicite, étape par étape)

| # | Opération | Cible | Contrôle | Retour arrière |
|---|---|---|---|---|
| P0 | Relevé des compteurs (rendez-vous, paiements, droits) et `controle-avant.sql` | Production, lecture | — | — |
| P1 | Migration `20261108130000_environment_separation_guard.sql`, puis `activer-production.sql` | Production, SQL | 13 déclencheurs `zz_mediumia_no_sandbox_*`, marqueur « production », compteurs identiques | `retour-arriere.sql` |
| P2 | Fusion de **#204**, déploiement **sans promotion automatique** si possible | Vercel | `https://<déploiement>/api/rdv-config?environmentCheck=1` : `tier` = production, `server` = production, `consistent` = true | « Instant Rollback » vers `76d2c70` |
| P3 | Promotion, puis lecture de `/api/rdv-availability` (2 services) | Production | `mode: live`, réponses identiques à avant | « Instant Rollback » |
| P4 | Migration `20261108140000_payment_issue_reports.sql` | Production, SQL | 2 tables, 3 fonctions, aucun droit pour `anon` ni `authenticated` | Supprimer les 2 tables et les 3 fonctions, qui ne touchent à rien d'existant |
| P5 | Vérifier en Production que `RDV_RATE_LIMIT_SECRET` (au moins 32 caractères) et une adresse propriétaire sont présentes, sans les modifier. Sinon, le signalement répond « indisponible », par fermeture de sécurité | Vercel Production, lecture | — | — |
| P6 | Fusion de **#205**, vérification, promotion | Vercel | Bouton visible, signalement réel avec votre propre adresse, tableau Incidents | « Instant Rollback » |

**Fenêtre conseillée :** en soirée, hors créneaux de rendez-vous et hors de la tâche
automatique de 07:00 UTC, après vérification qu'aucune capture n'est en cours :
`SELECT count(*) FROM rdv_paypal_payments WHERE status = 'capturing';` doit renvoyer 0.

**Contrôles PayPal Live, en lecture :** pas de nouvelle commande créée par le déploiement,
webhooks Live inchangés (ils pointent vers mediumia.fr), aucune capture modifiée.

**Hors périmètre, à laisser tel quel :**
- la **PR #203**, qui reste en brouillon ;
- les fichiers ChronoSphère et le travail de Codex, qu'un test vérifie ;
- `garde-droits-formation.sql` (étape facultative E4).
