# Lumia — réponses SMS/iMessage depuis le Mac (phase pilote, désactivée par défaut)

## Architecture

Message reçu (Mac → Inbox MediumIA) → texte exact écrit par Sébastien dans
**Lumia authentifiée** → aperçu immuable avec numéro, canal et texte →
`GO SMS #ABC123` dans la **même conversation** (sous 10 minutes) →
`lumia_sms_outbox` → **Mac** retire UNE fois le message via HTTPS →
Messages.app AppleScript → vérification du sortant dans `chat.db` →
statut `accepted` ou `uncertain`.

**Important :** `accepted` signifie seulement « retrouvé parmi les sortants
de Messages.app », PAS reçu ou lu par le client. Le Mac n'envoie aucun message
tant que tous les commutateurs ne sont pas explicitement activés.

Cette première version prend exclusivement un **numéro explicite**, déjà
présent dans un message entrant personnel et récent (14 jours). **Pas de
résolution par prénom**, pas de groupe, pas de RCS sortant, aucun nouvel
interlocuteur par simple dictée, et aucun routage de secours d'un SMS via
iMessage. Le choix de service est strict. Les messages clients ne sont
jamais des ordres d'envoi.

## Exemple Lumia

Sébastien : `SMS à +33612345678 : Bonjour, jeudi à 15 h est disponible.`

Lumia : « Brouillon — rien n'est envoyé. Destinataire +33…,
canal SMS ou iMessage (selon le message entrant). Texte exact… Pour
confirmer, réponds `GO SMS #ABC123`. »

Sébastien : `GO SMS #ABC123`

Lumia : « GO enregistré, message placé en file d'envoi. » Le propriétaire
peut vérifier l'état depuis son téléphone en envoyant `STATUT SMS #ABC123`.
Elle ne prétend
JAMAIS qu'un SMS est parti avant le retour de la synchronisation Mac.

Le GO générique des annulations et des demandes est distinct du **GO SMS**.

## Conditions serveur à contrôler APRÈS tests

1. Migration `supabase/migrations/20261124193000_lumia_sms_outbox.sql`
   appliquée sur **TEST** puis Production, en gardant les RPC accessibles
   uniquement à `service_role`.
2. Variables Vercel Production (toutes ABSENTES / non activées par défaut) :
   - `LUMIA_SMS_SEND_ENABLED=true` : permet de préparer et valider depuis Lumia.
   - `LUMIA_SMS_OUTBOX_ENABLED=true` : permet le retrait par le Mac.
   - `LUMIA_SMS_OUTBOX_TOKEN` : chaîne aléatoire d'au moins 32 caractères,
     **réservée à cet usage**, jamais dans Git, jamais dans un SMS/chat.
3. Vérifier que le déploiement Production est READY et pointe vers le
   bon projet Supabase ; tester en Preview+TEST d'abord.

La désactivation immédiate : remettre `LUMIA_SMS_SEND_ENABLED=false` et
`LUMIA_SMS_OUTBOX_ENABLED=false`, puis redéployer. Un message déjà réclamé
reste `dispatching` et ne peut pas être renvoyé automatiquement.

## Mac (Codex peut aider à l'installation)

- macOS Messages.app doit être ouvert avec le compte Apple habituel ;
  l'iPhone doit relayer les SMS vers ce Mac.
- Le Mac doit avoir l'« Accès complet au disque » pour le binaire Node
  qui lit `chat.db`, et autoriser l'automatisation de Messages.app pour
  `osascript` lors du premier essai.
- Dans `tools/lumia-messages-bridge/config.local.json` (non versionné),
  configurer :
  ```json
  {
    "live": true,
    "outbox_enabled": true,
    "outbox_endpoint": "",
    "outbox_only_handles": ["+33612345678"],
    "outbox_allow_all": false
  }
  ```
  L’URL de sortie est **obligatoire** : il n’y a plus d’endpoint par défaut.
  Renseigner ici l’URL de la **dernière Preview READY au commit testé**,
  suivie de `/api/rdv-admin?action=lumia-sms-outbox`.
  Cette URL est une Preview : il faut **prouver qu’elle utilise Supabase TEST
  et jamais Production** avant d’activer les envois. Les variables Vercel
  génériques Preview ne suffisent pas comme preuve d’isolement.
  Configurer sur la branche de la PR les variables Supabase TEST
  (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY), sans afficher ni transmettre les secrets
  par chat, et contrôler la cible après redéploiement.
  Le numéro est **un exemple fictif** : remplacer par le numéro du téléphone
  test réellement utilisé, qui a déjà écrit récemment.
- Placer le secret identique à Vercel dans le Trousseau macOS, service
  `mediumia-lumia`, compte `sms-outbox-token`, sans l'afficher :
  ```sh
  security add-generic-password -s mediumia-lumia -a sms-outbox-token -U -w
  ```
- Depuis `tools/lumia-messages-bridge` :
  ```sh
  npm test
  node src/cli.js doctor
  npm run send-approved -- --live --once
  ```
  Par défaut, `npm run send-approved` **sans --live** n'appelle même pas
  le serveur. Pour boucle active, retirer `--once`. Lancer comme processus
  utilisateur Mac uniquement après test ; ne pas créer de LaunchAgent avant
  une validation manuelle avec un destinataire test.

## Preview Vercel protégée et données de test

Le projet MediumIA protège les Previews par SSO. Le worker Mac doit
utiliser, uniquement lors des essais de Preview, un jeton OIDC **court**
fourni par la CLI Vercel liée au projet (`vc env run`). Le code transmet
`x-vercel-trusted-oidc-idp-token` uniquement aux hôtes Preview
`mediumia-site-*.vercel.app`, jamais à `mediumia.fr`. Si le jeton manque,
l'essai s'arrête avant tout retrait de la file. Ne pas désactiver la
protection Vercel ni enregistrer un secret de contournement permanent.

Codex peut vérifier d'abord la connexion en lecture via `vc curl` vers
la Preview. Ne **jamais** utiliser le GET `lumia-sms-outbox` pour une
simple vérification : ce GET retire irréversiblement le prochain SMS
approuvé de la file.

Le LaunchAgent historique peut continuer à alimenter la **Production**.
Il ne faut pas le couper à l'aveugle. Par conséquent, la base Supabase
TEST peut ne pas contenir le message source du numéro d'essai :
prévoir un import Inbox TEST **séparé**, sur liste blanche du numéro
d'essai et dans un répertoire d'état distinct, sans toucher au relais
habituel ni recopier les SMS réels des clients dans TEST.

Sur le Mac, après avoir vérifié les droits Vercel et le pointage vers
Supabase TEST, exécuter manuellement avec l'environnement OIDC
éphémère du projet :

```sh
vc env run -- node tools/lumia-messages-bridge/src/cli.js send-approved --live --once
```

Cette commande ne doit être utilisée **qu'après un GO de test SMS
spécifique**, avec le jeton d'outbox au Trousseau, une allowlist
limitée au numéro contrôlé par Sébastien et l'endpoint exact de la
dernière Preview prête. La CLI doit être déjà authentifiée et liée
au projet MediumIA. Ne jamais afficher les variables ou leurs valeurs.
## Essais indispensables avant publication

1. Test unitaire et compilation en Preview+Supabase TEST.
2. Test manuel macOS avec **un second numéro que Sébastien contrôle** :
   message entrant vers le Mac, brouillon exact, GO exact, vérification du
   destinataire et de la réception sur l'autre téléphone.
3. Refaire avec SMS (non iMessage) et iMessage si les deux canaux sont souhaités.
4. Vérifier les refus : GO expiré, mauvais code, numéro non connu,
   groupe, RCS, appel répété, Mac hors ligne, outil sans permission, source
   modifiée après préparation.
5. Vérifier après envoi la **ligne sortante exacte dans chat.db**.
   Certaines versions de macOS acceptent AppleScript sans réellement
   créer le SMS ; dans ce cas statut `uncertain` et intervention humaine.
6. **Aucun retry automatique du send.** Lorsqu'un GET a réclamé un message,
   `dispatching` ne redevient jamais `ready` : à vérifier manuellement.

## API privée

`GET /api/rdv-admin?action=lumia-sms-outbox` :
`Authorization: Bearer <LUMIA_SMS_OUTBOX_TOKEN>` ; retire au plus un
message en statut `ready` et le marque `dispatching` transactionnellement.

`POST /api/rdv-admin?action=lumia-sms-outbox` :
`{ "id": "UUID", "status": "accepted | uncertain | failed", "error_code": "..." }`.

Ce jeton n'ouvre ni Supabase, ni Gmail, ni PayPal, ni la création de
rendez-vous. Les tables et RPC sont privées. Les textes ne sont jamais
écrits dans les logs techniques.

## Limites du rôle de Codex

Codex peut **installer et lancer** ce travailleur sur le Mac s'il possède
un accès autorisé à ce Mac. La conversation ChatGPT seule ne peut pas
commander `Messages.app` à distance sans ce relais. Aucun envoi ne se
produit par un simple GO émis dans le chat ChatGPT : le GO doit être
saisi **dans Lumia authentifiée sur MediumIA**.
