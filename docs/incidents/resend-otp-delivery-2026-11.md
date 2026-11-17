# Correctif MediumIA — incidents Resend et accès client

Suivi : #219. Branche isolée `fix/mediumia-resend-otp-delivery` (PR #220).

## Audit (17 novembre 2026)

### Chemins d'envoi
| E-mail | Envoyé par | Ce que voit l'application |
|---|---|---|
| Code de connexion / création d'espace (`signInWithOtp`), récupération de mot de passe, changement d'adresse | **Supabase Auth**, via son SMTP (Resend) | « 200 envoyé » dès que Resend accepte le message (environ 1,3 s de traitement SMTP dans les journaux Auth) |
| Confirmations, rappels, alertes (`lib/transactionalEmail.js`) | **API Resend** | `status: 'sent'` dès le HTTP 200 de Resend |

### Causes
1. **Rejets invisibles.** Un rejet (bounce), une suppression ou une plainte arrive *après* l'acceptation, de façon asynchrone. Rien ne l'écoutait : pas de webhook, pas d'identifiant conservé. Le client attendait un code qui n'arrivait jamais, et Sébastien n'était pas prévenu.
2. **Écran trompeur pour un client sans espace.** En mode « Code par e-mail », une adresse sans espace reçoit `422 Signups not allowed for otp`. Par anti-énumération, l'écran « Consultez vos e-mails » s'affichait quand même, alors qu'**aucun code n'était envoyé**.
   - Production : 131 des 143 clients ayant réservé n'ont pas d'espace.
   - Journaux Auth sur 24 h : 2 cas de `otp_disabled`.
3. **Échec SMTP mal expliqué.** Si Supabase ne pouvait pas remettre l'e-mail à Resend, le client lisait seulement « Une erreur est survenue ».
4. **Comptes en attente.** Production compte 5 comptes ayant reçu un code jamais validé. Ils sont « en attente » : sans adresse confirmée, ils n'ont accès à aucune donnée (`requireVerifiedAccount`).
5. **Vérification d'identité correcte.** Aucune lecture de rendez-vous ou de profil sans jeton valide **et** `email_confirmed_at`. Cette partie n'est pas modifiée.
6. **Les 9 suppressions « manual » du 11/10/2026.** Aucun code du dépôt n'ajoute de suppression chez Resend : elles viennent d'une action dans le tableau de bord ou l'API Resend. Elles sont à identifier dans Resend (Suppressions → origine et date) **avant** tout automatisme. Aucun automatisme de déblocage n'est ajouté ici.
7. **Alertes horaires.** Le système d'alertes horaires n'est pas dans ce dépôt (tâche externe). Il reste en place ; le webhook le complète en temps réel.

## Corrections

### Serveur
- **Webhook Resend signé**
  - Adresse : `POST /api/resend-webhook`, réécrit vers `/api/rdv-config?emailWebhook=resend`, car il n'y a plus de place pour une 13e fonction Vercel.
  - Signature Svix vérifiée sur les octets bruts, avec une fenêtre de 5 minutes et la rotation de clé acceptée.
  - Sans `RESEND_WEBHOOK_SECRET` : 503, rien n'est accepté. Sans signature valide : 401.
  - Événements suivis : `email.bounced`, `email.failed`, `email.suppressed`, `email.complained`, `email.delivered`, `suppression.added`, `contact.suppressed`, ainsi que `sent` et `delivery_delayed`, qui sont seulement journalisés.
- **Idempotence**
  - Un événement est enregistré une seule fois par destinataire (`UNIQUE (provider, webhook_id, recipient)`) : un renvoi de Resend ne crée ni doublon ni seconde alerte.
  - En cas de panne de la base, le webhook répond 500 pour que Resend renvoie l'événement.
- **Données minimales**
  - Conservées : type d'événement, adresse, identifiant Resend, motif du rejet, et sujet **caviardé** (chiffres, liens et jetons retirés : jamais de code OTP).
  - Jamais conservé : le contenu de l'e-mail.
- **Alerte à Sébastien**
  - Une seule alerte par incident, réservée de façon atomique. Une nouvelle alerte part si l'incident s'aggrave ou se rouvre.
  - Elle est envoyée à `EMAIL_DELIVERY_ALERT_EMAIL`, à défaut à `RDV_BALANCE_ALERT_EMAIL`.
  - Elle contient : l'adresse, le problème, l'e-mail concerné (sujet caviardé), les rendez-vous du client avec son téléphone, et la marche à suivre.
  - En cas de plainte, elle dit explicitement de **ne pas débloquer sans l'accord du client**.
- **Vérification avant envoi** : `POST /api/rdv-config?accountAction=email-check`.
  - Réponse : `ok`, `blocked`, `temporary` ou `unknown`.
  - Même réponse qu'un compte existe ou non (anti-énumération).
  - Limite de 30 demandes par heure et 120 par jour, par visiteur.
  - Une panne donne `unknown` et n'empêche jamais l'envoi.
- **Administration**
  - `GET` et `POST` sur `/api/rdv-admin?action=email-delivery`, réservés au propriétaire du profil `sebastien-seguin` : liste des incidents ouverts, et action « marquer résolu » (`op: resolve`).
  - Marquer résolu ne touche pas à Resend.
  - Compteur `email_delivery_issues` dans `action=attention`.
- **Clôture automatique** : seule une remise réussie *postérieure* clôt un incident, jamais une plainte.

### Espace client (`/mon-espace`) et invitation après réservation
- **Avant l'envoi** : si l'adresse est refusée par la messagerie, aucun code n'est demandé. Le client voit pourquoi, corrige son adresse ou écrit à contact@mediumia.fr. Même chose pour « Mot de passe oublié ».
- **Après l'envoi** : revérification à 8 s, 25 s et 60 s. Si un rejet arrive entre-temps, l'écran l'affiche : « Le code n'a pas pu être remis à cette adresse », avec un bouton « Corriger mon adresse ».
- « Renvoyer mon code » avec un délai de 60 s, celui de Supabase. Le renvoi conserve le mode d'origine (création ou connexion).
- Première visite : il est expliqué qu'aucun code n'est envoyé tant que l'espace n'est pas créé, avec un renvoi vers « Créer mon espace ». Ce message est affiché dans tous les cas, sans révéler si un espace existe.
- Message dédié en cas d'échec SMTP au lieu de « Une erreur est survenue ».

### Inchangé (volontairement)
- Vérification d'identité : OTP ou mot de passe, adresse confirmée avant toute donnée.
- Protections Resend anti-bounce et anti-plainte : aucune désactivation, aucun déblocage automatique.
- Réservations et paiements : aucun fichier touché.

## Tests
- `tests/emailDelivery.test.js` (14 tests) :
  - signature valide, falsifiée, périmée, rotation de clé, secret absent ;
  - caviardage OTP ;
  - rejet → alerte unique ; doublon → pas d'alerte ; alerte concurrente ; échec d'envoi → libération ;
  - panne base → 500 ;
  - vérification avant envoi : anti-énumération et limites ;
  - administration ;
  - messages côté client ;
  - garde-fous de structure et SQL.
- Fonctions SQL testées sur Supabase TEST avec les adresses de test Resend (`bounced@`, `delivered@`, `complained@resend.dev`) :
  - doublon ignoré ;
  - alerte réservée une seule fois ;
  - aggravation rejet → suppression ;
  - temporaire clos par une remise ;
  - plainte jamais close automatiquement ;
  - résolution manuelle puis réouverture ;
  - aucun droit `anon` ou `authenticated`.

## Activation (à faire par Sébastien)
1. **Resend → Webhooks → Add endpoint**
   - TEST : URL de la préversion TEST suivie de `/api/resend-webhook`.
   - Production : `https://mediumia.fr/api/resend-webhook`, après accord.
   - Événements : bounced, failed, suppressed, complained, delivered, ainsi que `suppression.added` s'il est proposé.
2. Copier le **Signing secret** (`whsec_…`) dans Vercel : `RESEND_WEBHOOK_SECRET` (Preview pour TEST, Production ensuite).
3. Facultatif : `EMAIL_DELIVERY_ALERT_EMAIL`, sinon `RDV_BALANCE_ALERT_EMAIL` est utilisé.
4. Appliquer la migration `20261117100000_email_delivery_tracking.sql` en Production avant le déploiement du code. Elle est additive.
5. Redéployer.
6. Tester avec `bounced@resend.dev` :
   - une alerte arrive ;
   - l'espace client affiche le message de rejet.

## Retour arrière
- Le code est sans effet tant que `RESEND_WEBHOOK_SECRET` est absent : le webhook répond 503 et la vérification répond `ok` ou `unknown`.
- Désactiver le webhook dans Resend arrête toute écriture.
- Les tables peuvent rester en place.
