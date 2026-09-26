# Étape 2 · Tests PayPal Sandbox du parcours 597 €

Tout se passe sur les **préversions Vercel** des deux branches, en **argent fictif** (PayPal Sandbox). Aucun paiement live, aucun merge, interrupteur de production inchangé (OFF).

Les préversions utilisent la base de production, mais uniquement des lignes marquées `sandbox`, et uniquement pour des comptes de test (`…+parcours…`). Ces lignes sont retirées à la fin par `90-nettoyage.sql`, limité aux 4 adresses de cette campagne. Tout le parcours live filtre par environnement : il ne voit jamais ces lignes.

## Où

| | Préversion | Commit |
|---|---|---|
| Site | https://mediumia-site-cf0n1s0bv-seguins-projects-a1d4673f.vercel.app | `e4fbbf9` (branche `feat/parcours-597`) |
| Espace élève | https://mediumnia-esko39w5j-seguins-projects-a1d4673f.vercel.app | `63ab409` (branche `feat/parcours-597-espace`) |

Les préversions sont protégées par la connexion Vercel : les ouvrir dans un navigateur connecté à Vercel. En préversion, le parcours est toujours ouvert et toujours en Sandbox.

## Prérequis (une fois)

1. **Comptes acheteurs PayPal Sandbox** (developer.paypal.com → Sandbox → Accounts → Create account → Personal). En créer 4, avec vos adresses et le suffixe `+parcours` :
   - `<votre adresse>+parcours1@…`
   - `<votre adresse>+parcours2@…`
   - `<votre adresse>+parcours3@…`
   - `<votre adresse>+parcours4@…`

   Un achat Sandbox est rattaché au compte MediumIA de l'**adresse du payeur PayPal** : ces 4 adresses deviennent les 4 comptes élèves de test. Les liens de connexion arrivent dans votre boîte habituelle (le suffixe `+parcours` est livré à la même adresse). Les scripts refusent toute autre adresse.
2. **Identifiants PayPal des préversions** : le parcours utilise les mêmes variables que la Découverte (`PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` en *Preview*, identifiants Sandbox). Si la Découverte Sandbox fonctionne déjà en préversion, rien à faire.
3. **Retour de connexion vers la préversion** : Supabase → Authentication → URL Configuration → *Redirect URLs* doit accepter `https://*-seguins-projects-a1d4673f.vercel.app/**`. C'est un réglage de production (Auth) : le vérifier en lecture. S'il manque, l'ajouter demande un GO. Sans lui, le lien de connexion ramène sur mediumia.fr au lieu de la préversion.
4. **(Facultatif) Webhook PayPal Sandbox** vers la préversion du site. Il ne passe la protection Vercel qu'avec le « Protection Bypass for Automation » ; sans lui, la page relance elle-même la synchronisation juste après l'accord PayPal, ce qui suffit pour ces tests. On peut donc s'en passer.

## Contrôle après chaque scénario

- **Base (lecture seule)** : `10-suivi-compte-test.sql`, avec l'adresse du compte (achats, registre, abonnement, commandes, droits, et total, toujours ≤ 59700).
- **PayPal** : tableau de bord Sandbox (compte marchand → Activité ; abonnement → détails).

## Scénarios

Les montants Sandbox : la Découverte et l'achat complet sont facturés **1,00 €** mais comptent pour **29 €** et **597 €**. Les mensualités et « Tout débloquer » sont facturés à leur vrai montant (argent fictif).

### Compte 1 (`+parcours1`) : le parcours complet

| # | Action | Attendu |
|---|---|---|
| S1 | Préversion site → `/formation` → **Découverte** 29 € (Sandbox 1 €), payer avec le compte PayPal `+parcours1` | Achat provisionné. Registre : `discovery` 2900. Droits : `paypal:sandbox:discovery:…` (30 jours) et `parcours:sandbox:<id>` module 1. Le bloc « Parcours progressif » et la nouvelle FAQ sont visibles sur `/formation` (préversion = ouvert). |
| S2 | `/formation/parcours` → se connecter (lien par e-mail) → case CGV → **Continuer mon parcours · 48 €/mois** → accord PayPal | **Premier prélèvement au démarrage** : message « C'est parti ✦ », registre `monthly` 4800 tout de suite, modules 1 à 3, total 77 €, reste 520 €. Abonnement `active`, 11 × 48 puis 40. Coach « jusqu'au <aujourd'hui + 12 mois> ». PayPal : plan « MediumIA — Parcours au mois (597 € maximum) », TRIAL 11 × 48,00 puis REGULAR 1 × 40,00 ; souscription avec 11 × 48 puis 40. **Point clé pour les CGV : noter si le prélèvement est immédiat.** |
| S3 | **Arrêter mon parcours** → Oui | PayPal : abonnement *Cancelled*. Base : `cancelled`. Modules 1 à 3 conservés, coach inchangé. |
| S4 | **Continuer mon parcours** (reprise) → accord | Nouvel abonnement calculé sur le reste (520 €) : **10 × 48 puis 40**. Son 1ᵉʳ prélèvement est immédiat : total 125 €, modules 1 à 5, reste 472 €. Jamais plus de 597 € en tout. |
| S5 | Pendant l'abonnement : **Tout débloquer** (reste exact) → accord | L'abonnement est arrêté **avant** l'encaissement. Registre `unlock` = reste exact. Total **59700**, 25 modules, « parcours entièrement ouvert ». |
| S8 | Revenir sur `/formation/parcours` | « Votre parcours est complet » : ni souscription ni « Tout débloquer ». |

### Compte 2 (`+parcours2`) : Découverte remboursée

| # | Action | Attendu |
|---|---|---|
| S1 | Découverte Sandbox avec `+parcours2` | Comme compte 1. |
| S6 | PayPal Sandbox, compte **marchand** → Activité → cette Découverte → **Rembourser** (total). Puis `/formation/parcours` → Continuer | Souscription refusée (« discovery_required ») ; **aucun abonnement créé**. Registre : ligne `refund (discovery)` `refund:<capture>`. État : plus de Découverte, reste 597 €. |

### Compte 3 (`+parcours3`) : achat complet pendant un parcours

| # | Action | Attendu |
|---|---|---|
| S1–S2 | Découverte, puis souscription (1ᵉʳ prélèvement) | Comme compte 1. |
| S7 | `/formation` → **Formation complète** (Sandbox 1 €), payer avec `+parcours3` | L'abonnement est **arrêté chez PayPal** et marqué `completed`. Accès complet. Total 29 + 48 + 597 > 597 : **e-mail d'alerte « trop-perçu »** à contact@mediumia.fr (attendu : c'est la détection voulue). |

### Compte 4 (`+parcours4`) : dernière échéance et plafond (**GO requis : données simulées**)

| # | Action | Attendu |
|---|---|---|
| S1 | Découverte Sandbox avec `+parcours4` | Comme compte 1. |
| S9a | `20-mensualites-simulees.sql` avec `NOMBRE = 10` (10 mensualités fictives `TEST-SANDBOX-…`) | 509 € comptés, 21 modules, reste 88 €. |
| S9b | Continuer mon parcours → accord | Abonnement **1 × 48 puis 40** (vérifier dans PayPal). 1ᵉʳ prélèvement immédiat : 557 €, 23 modules, reste 40 €. |
| S9c | La page propose **« Étape finale « Intégration » · 40 € »** → accord | L'abonnement est arrêté avant l'encaissement, puis 40 € encaissés : total **59700**, 25 modules. Plus rien de proposé. Aucun prélèvement de 40 € ne suivra chez PayPal (abonnement *Cancelled*). |

Ne pas relancer `20-mensualites-simulees.sql` après un vrai prélèvement : le total dépasserait 597 €.

### Espace élève (préversion)

| # | Action | Attendu |
|---|---|---|
| S10 | Se connecter avec `+parcours1` après S2 puis après S5 ; avec `+parcours3` après S7 | Modules ouverts = ceux du site (3, puis 25 ; 25 après l'achat complet). Coach ouvert, avec la phrase « 12 mois après votre dernier paiement ». PDF de modules : téléchargement d'un module ouvert OK, module fermé refusé. |

**Limite connue** : la carte « Mon parcours » de l'espace élève interroge le site. Entre deux préversions protégées par Vercel, cet appel est bloqué (connexion Vercel propre à chaque préversion) : ses boutons s'affichent sans l'état du site. Ils sont couverts par les tests automatiques, et seront vérifiés en production le jour J.

### Production intacte (lecture seule)

| # | Contrôle | Attendu |
|---|---|---|
| S11 | https://mediumia.fr/formation | Inchangée : ni bloc parcours, ni nouvelle FAQ. |
| S12 | SQL : `select count(*) from public.mediumia_formation_subscriptions where paypal_env = 'live';` et idem sur `mediumia_formation_unlock_orders`, et `mediumia_formation_payments` avec `kind in ('monthly', 'unlock', 'refund')` | 0 / 0 / 0 |

## Fin des tests

1. Arrêter dans « Mon parcours » tout abonnement Sandbox encore actif (sinon le nettoyage refuse).
2. **GO requis** : `90-nettoyage.sql`, après avoir inscrit en tête du script les **4 adresses exactes de cette campagne** (`ADRESSE_1` à `ADRESSE_4`). Il ne touche qu'à ces 4 comptes : aucun autre compte, même en `+parcours`, présent ou futur. Il refuse de s'exécuter si la liste n'est pas exactement 4 adresses `+parcours` distinctes. Il supprime seulement leurs lignes Sandbox, puis indique dans son résultat les PDF de modules à supprimer dans Storage (tableau de bord). Les achats Sandbox restent, pour mémoire. Les comptes eux-mêmes ne sont pas supprimés.
3. Me transmettre : pour chaque scénario, résultat conforme ou écart, et **la constatation du premier prélèvement (S2)** pour les CGV.
