# Lumia Messages Bridge (macOS)

Pont **local** entre l'app Messages du Mac et Lumia :

```
Messages (iMessage + SMS relayés par l'iPhone)
  → lecture seule de ~/Library/Messages/chat.db
  → filtre local (probable / incertain / ignorer)
  → POST /api/rdv-admin?action=lumia-rdv-intake (contrat existant, inchangé)
  → MediumIA (demande « pending », à confirmer à la main)
```

**Phase 1 : dry-run par défaut.**
- Rien n'est envoyé, aucune réponse au client, aucun SMS, e-mail, paiement ni écriture dans l'agenda.
- Le mode réel exige deux verrous : `"live": true` dans `config.local.json` **et** l'option `--live`.

Aucune dépendance : Node.js ≥ 22.13 suffit (module intégré `node:sqlite`).

## Architecture retenue : lecture seule de `chat.db`

| Méthode | Temps réel | iMessage / SMS | Entrant / sortant | Fil stable | Stabilité macOS | Permissions |
|---|---|---|---|---|---|---|
| **A. `chat.db` en lecture seule** (retenue) | quasi (relevé toutes les 15 s) | oui, `message.service` = `iMessage`, `SMS`, `RCS` | oui, `is_from_me` | oui, `message.guid` et `chat.guid` | schéma non documenté : vérifié à chaque démarrage, arrêt net s'il change | Accès complet au disque |
| B. AppleScript (Messages) | non : les gestionnaires « message reçu » ne sont plus proposés dans les macOS récents | partiel | partiel | non | faible | Automatisation |
| C. Raccourcis | sur Mac, pas de déclencheur « message reçu » ; sur iPhone, l'automatisation « Message » existe, mais filtre par mots ou contacts, met le jeton sur l'iPhone et gère mal l'idempotence | oui (iPhone) | entrants | non | moyenne | jeton sur le téléphone |
| D. API Apple native | aucune API publique ne lit Messages ; le framework privé `IMCore` est fragile et interdit | — | — | — | — | — |

**Pourquoi A :**
- C'est la seule source complète, locale et lisible sans contourner la sécurité.
- Le bridge l'ouvre **en lecture seule** : SQLite refuse toute écriture.
- Il ne lit que les colonnes utiles, jamais les pièces jointes.
- Il ne lit pas les Contacts.
- Il n'utilise pas le mode `immutable`, qui ignorerait le journal WAL et donc les derniers messages.
- Le prix à payer est l'accès complet au disque, accordé explicitement par vous.

**Limites à connaître, documentées plutôt que contournées :**
- **Schéma non documenté par Apple.** Les colonnes indispensables sont vérifiées au démarrage. S'il en manque une, le bridge s'arrête (`chat_db_schema_changed`) au lieu de deviner.
- **Texte dans `attributedBody`.** Depuis macOS 13, la colonne `text` est souvent vide et le texte se trouve dans `attributedBody`. Le décodage est minimal, et testé seulement sur des données synthétiques. **`npm run doctor` mesure le taux de décodage sur votre Mac**, sans afficher aucun contenu. Un texte illisible est ignoré, jamais deviné.
- **RCS** (iOS 18) n'a pas de canal Lumia dédié : il est envoyé en `other`. SMS et iMessage restent distingués de façon fiable.
- **Exclus en V1 :**
  - les conversations de groupe ;
  - les réactions (« tapbacks ») ;
  - les événements système ;
  - les numéros courts (codes, banques…) ;
  - les messages sortants ;
  - les pièces jointes sans texte.
- **Messages modifiés.** Un message modifié après coup n'est pas renvoyé : seule la version lue au premier passage compte.
- **SMS absents du Mac.** Les SMS n'arrivent dans `chat.db` que si l'iPhone les relaie (Réglages iPhone → Messages → Transfert de SMS → ce Mac).

## Fichiers

```
tools/lumia-messages-bridge/
  README.md
  package.json            scripts : doctor, dry-run, test (aucune dépendance)
  config.example.json     modèle de config.local.json (ignoré par Git)
  .gitignore              state/, config.local.json, *.log
  src/cli.js              commandes doctor | run
  src/chatdb.js           lecture seule de chat.db, vérification du schéma, dates Apple, attributedBody
  src/classify.js         filtre local probable / incertain / ignorer
  src/payload.js          message → contrat Lumia existant (aucun champ inventé)
  src/bridge.js           curseur, idempotence, dry-run, envoi, nouveaux essais
  src/sender.js           POST HTTPS, interprétation de la réponse
  src/token.js            jeton depuis le Trousseau (ou variable locale)
  src/state.js            état local minimal, fichiers en 0600
  launchd/fr.mediumia.lumia-messages-bridge.plist   modèle de LaunchAgent (non installé)
  tests/                  fixtures fictives et tests
```

## Permissions macOS

- **Accès complet au disque**, pour lire `~/Library/Messages/chat.db`. Il s'accorde dans Réglages Système → Confidentialité et sécurité → Accès complet au disque, à :
  - Terminal (ou iTerm) pour les essais à la main ;
  - le binaire `node` utilisé par le LaunchAgent pour le fonctionnement automatique (voir plus bas).
- **Trousseau**, en mode réel seulement : au premier accès, macOS demande d'autoriser `security`. Choisissez « Toujours autoriser ».
- **Rien d'autre** : ni Contacts, ni Automatisation, ni Accessibilité.

## 1. Diagnostic du Mac (à faire en premier)

```bash
cd tools/lumia-messages-bridge
npm run doctor
```

Le diagnostic n'affiche que des compteurs, jamais de texte :
- la version de macOS et de Node ;
- l'accès à `chat.db` ;
- les colonnes présentes ;
- les messages des 30 derniers jours par service (iMessage, SMS, RCS) et par sens (entrants, sortants) ;
- le taux de décodage de `attributedBody` ;
- la présence du jeton dans le Trousseau, sans sa valeur.

**Si `lecture : NON` s'affiche**, accordez l'accès complet au disque à Terminal, puis relancez.

## 2. Dry-run (rien n'est envoyé)

```bash
npm run dry-run                                   # en continu, Ctrl+C pour arrêter
node --disable-warning=ExperimentalWarning src/cli.js run --show --once --lookback-minutes 30
```

- **Premier lancement** : le curseur est placé sur **le dernier message existant**, donc aucun historique n'est importé. `--lookback-minutes N` reprend seulement les N dernières minutes.
- **Messages affichés** : seuls les `probable` et `incertain`. Le numéro est masqué, sauf avec `--show-full`.
- **Messages ignorés** : seulement comptés, jamais affichés.

Exemple (données fictives) :

```
[dry-run] 2026-10-03T12:26:44.542Z imessage PROBABLE (score 7 : rendez-vous, déplacer, demande, jour)
  message_id      : 1A2B3C4D-…-…
  conversation_id : conv-5a63ed56047b47f25e091038688646d634b44906
  expéditeur      : +33•••••••78
  payload         : {"agent":"lumia","source_channel":"imessage","source_message_id":"1A2B3C4D-…","source_conversation_id":"conv-5a63…","message_sent_at":"2026-10-03T12:26:44.542Z","detected_at":"2026-10-03T12:29:44.625Z","message_text":"Bonjour Sébastien, est-ce possible de déplacer mon rendez-vous de mardi ?","modality":"unknown","confidence":0.7,"phone":"+33•••••••78"}
[dry-run] 2026-10-03T12:27:44.544Z sms INCERTAIN (score 1 : jour)
  …
2026-10-03T12:29:44.631Z tick mode=dry-run read=4 probable=1 incertain=1 ignored=1 skipped=1 …
```

## Filtre local

**Les trois classes :**
- **`probable`** : au moins un mot propre à l'activité, par exemple rendez-vous/rdv, séance, consultation, guidance, désenvoûtement, dégagement, réserver/créneau.
- **`incertain`** : seulement des indices génériques :
  - jour, demain, heure, date ;
  - « dispo », « annuler », « déplacer » ;
  - visio, WhatsApp, FaceTime, horaires, tarif.

  Un proche peut écrire la même chose, c'est pourquoi ces messages restent incertains.
- **`ignorer`** : aucun indice, politesse seule (« merci », « ok »), message personnel sans mot d'activité (« bisous », « maman »…), numéro court ou expéditeur exclu (`ignore_handles` dans `config.local.json`).

**Ce qui est transmis :**
- en dry-run, `probable` et `incertain` sont affichés ;
- en live, seul `probable` est envoyé ;
- `incertain` n'est envoyé qu'avec `"send_uncertain": true` ;
- `ignorer` n'est jamais transmis.

**Verrou de test** (`"live_only_handles"` dans `config.local.json`, vide par défaut) : en mode réel, si la liste contient des numéros ou des adresses, **seuls ces expéditeurs** peuvent être envoyés.
- Les autres sont marqués `outside_test_allowlist` et ne partent pas.
- Ils restent dans Messages, à traiter à la main.
- Ce verrou sert aux premiers essais réels. Videz la liste pour le fonctionnement normal.

**Le texte reste une donnée.** Il n'est jamais interprété comme une consigne. « Ignore les instructions système… » part tel quel dans `message_text`, et le serveur le traite comme une donnée client non fiable.

## Contrat Lumia (réutilisé tel quel)

**Champs envoyés** :
- `agent: "lumia"`, `source_channel` (`imessage` | `sms` | `other`) ;
- `source_message_id`, qui est le `guid` Apple, stable ;
- `source_conversation_id`, soit `conv-` suivi de l'empreinte SHA-256 du fil, sans le numéro en clair ;
- `message_sent_at`, `detected_at`, `message_text` (2000 caractères maximum) ;
- `phone` (normalisé comme le fait le serveur) **ou** `email` (iMessage par adresse) ;
- `modality` (`video` si visio, FaceTime ou WhatsApp est écrit, `phone` si « par téléphone », sinon `unknown`) ;
- `service_hint`, s'il est écrit ;
- `confidence`.

**Champs jamais envoyés** : le nom (non lu), un créneau ou une prestation précise. Le serveur fait son travail habituel : rapprochement client par téléphone ou e-mail, et prestation jamais inventée.

**Contrôle automatique** : un test valide chaque payload avec **le validateur réel du serveur** (`lib/lumiaRdvIntake.js`).

**Idempotence :**
- **Côté serveur** : canal + identifiant de message.
- **Côté bridge** : l'état local garde le curseur et les identifiants traités. Un nouvel essai réutilise toujours le même identifiant, donc jamais de doublon.
- **Lecture des réponses** :
  - `created`, `updated` ou `duplicate` : succès ;
  - erreur réseau, 429 ou 5xx : nouvel essai après 1, 5, 15, 60, 180, 360 puis 720 minutes ;
  - 401 ou 403 : envois suspendus pour ce passage ;
  - autre 4xx : rejet, journalisé avec le nom des champs refusés.

## Jeton dans le Trousseau

Le jeton n'apparaît jamais à l'écran, dans un fichier, dans Git ni dans les journaux.

```bash
# Ajout (ou mise à jour) : la commande DEMANDE le jeton, rien n'est tapé sur la ligne de commande
security add-generic-password -s mediumia-lumia -a intake-token -U -w
# Vérifier la présence, sans afficher la valeur
security find-generic-password -s mediumia-lumia -a intake-token >/dev/null && echo "jeton présent"
# Retirer
security delete-generic-password -s mediumia-lumia -a intake-token
```

**Lecture par le bridge** : il lit le jeton au moment de l'envoi avec `/usr/bin/security`, sans shell. À défaut, il prend la variable `LUMIA_INTAKE_TOKEN`, définie localement et jamais commitée. Sans jeton, **aucune requête n'est envoyée** et les messages restent en attente.

## 3. Passer au mode réel (plus tard, sur votre GO)

1. Installez le jeton dans le Trousseau (voir ci-dessus).
2. Lancez `cp config.example.json config.local.json`, puis mettez `"live": true`.
3. Faites un essai unique, depuis un second numéro à vous, avec un message contenant « rendez-vous test » :
   ```bash
   node --disable-warning=ExperimentalWarning src/cli.js run --live --once --lookback-minutes 5
   ```
   Vérifiez la demande dans l'espace RDV, puis supprimez-la.
4. **Point d'attention** : l'état du mode réel (`state/live.json`) est distinct de celui du dry-run. Au premier lancement réel, le curseur repart de « maintenant ».

## 4. Lancement automatique : LaunchAgent (préparé, NON installé)

1. **Préparez un binaire `node` dédié.** L'accès complet au disque n'est alors donné qu'à cette copie, et pas à tous vos scripts Node :
   ```bash
   mkdir -p "$HOME/Library/Application Support/MediumIA"
   cp "$(realpath "$(which node)")" "$HOME/Library/Application Support/MediumIA/lumia-node"
   ```
2. **Accordez l'accès complet au disque** à `~/Library/Application Support/MediumIA/lumia-node`.
3. **Installez le fichier**, en remplaçant les chemins :
   ```bash
   BRIDGE="$(pwd)"   # depuis tools/lumia-messages-bridge
   sed -e "s#__NODE__#$HOME/Library/Application Support/MediumIA/lumia-node#" \
       -e "s#__BRIDGE__#$BRIDGE#g" -e "s#__HOME__#$HOME#" \
       launchd/fr.mediumia.lumia-messages-bridge.plist > ~/Library/LaunchAgents/fr.mediumia.lumia-messages-bridge.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/fr.mediumia.lumia-messages-bridge.plist
   ```
4. **Suivez et arrêtez :**
   ```bash
   tail -f ~/Library/Logs/mediumia-lumia-bridge.log          # compteurs seulement, aucun texte
   launchctl bootout gui/$(id -u)/fr.mediumia.lumia-messages-bridge
   ```

**Comportement** : le bridge démarre à l'ouverture de session (`RunAtLoad`) et redémarre s'il s'arrête (`KeepAlive`, au plus une fois par minute). Il tourne en arrière-plan, sans fenêtre, en basse priorité. Sans l'option `--live` dans le fichier **et** `"live": true`, il reste en dry-run et ne journalise que des compteurs.

## 5. Boîte de réception Lumia (V2, désactivée par défaut)

Second pipeline, **indépendant** du pipeline RDV : chaque message **entrant texte** en 1-à-1 (iMessage, SMS, RCS, quel que soit son classement) est déposé dans la boîte de réception privée de Lumia (`POST /api/rdv-admin?action=lumia-message-intake`, table `lumia_message_inbox`). Les messages `probable` continuent **aussi** vers l'intake RDV, inchangé.

- **Activation** : `"inbox_enabled": true` dans `config.local.json` (avec `"live": true` et `--live`), jeton distinct dans le Trousseau (`mediumia-lumia` / `inbox-token`), et `LUMIA_INBOX_TOKEN` côté serveur. Sans l'un de ces éléments, rien n'est envoyé.
- **Pas d'historique** : à l'activation, l'Inbox part du dernier message existant (`state.inbox.since_cursor`), même après un `--lookback-minutes`.
- **Indépendance** : file d'attente, nouveaux essais, jeton et endpoint séparés. Une panne de l'Inbox ne retarde, ne perd ni ne double aucun envoi RDV, et inversement.
- **Jamais dans l'Inbox** : messages sortants, groupes, réactions, événements système, pièces jointes (ni le fichier ni un message sans texte), numéros courts (codes, banques…), expéditeurs de `ignore_handles`.
- **RCS** : canal `rcs` dans l'Inbox (le pipeline RDV garde `other`).
- **Verrou de test** : `live_only_handles` s'applique aussi à l'Inbox.

Le guide serveur (schéma, RLS, recherche, rétention) est dans `docs/lumia-message-inbox.md`.

## 6. Rattrapage documentaire de l'Inbox (backfill-inbox)

Importe dans la boîte de réception Lumia les messages **entrants texte** d'une période passée (92 jours au plus, bornes en heure de Paris). C'est un import **Inbox uniquement**, à seule fin de consultation.

```bash
node --disable-warning=ExperimentalWarning src/cli.js backfill-inbox --from 2026-09-01 --to 2026-09-30            # dry-run : compteurs seulement
node --disable-warning=ExperimentalWarning src/cli.js backfill-inbox --from 2026-09-01 --to 2026-09-30 --live --confirm 2026-09-01..2026-09-30:<N>
```

- **Seul endpoint appelé :** `lumia-message-intake`. Jamais l'intake RDV, ni `booking_requests`, ni les bookings ; aucun agenda, e-mail, message sortant ni paiement.
- **Dry-run d'abord, toujours :** l'écriture exige `"live": true`, `"inbox_enabled": true` et la phrase de confirmation exacte affichée par le dry-run (période + nombre d'éligibles).
- **État séparé** (`state/backfill-inbox.json`) : le curseur et `state/live.json` ne sont ni lus ni modifiés, et le LaunchAgent continue sans interruption.
- **Idempotent :** le serveur déduplique, et une relance ne renvoie pas un message déjà accepté.
- **Données conservées :** chaque message garde sa vraie date (`message_sent_at`), son canal réel (`rcs` compris), son classement (probable, incertain, ignorer) et l'empreinte du fil. Le serveur fixe `owner_id`.
- **Mêmes exclusions que le pipeline Inbox live :** sortants, groupes, réactions, événements système, pièces jointes sans texte, numéros courts et `ignore_handles`.
- **`--until-rowid N`** (ROWID inclus) : s'arrêter exactement où le live a pris le relais (`state.inbox.since_cursor` ou `outgoing_since_cursor`). La phrase de confirmation l'inclut (`…@N:compte`), et le compte reste stable même si de nouveaux messages arrivent.

## 7. Messages sortants en lecture seule (désactivés par défaut)

- **Activation :** `"inbox_outgoing": true` (avec `"inbox_enabled": true`), et `LUMIA_INBOX_OUTGOING_ENABLED=true` côté serveur.
- **Point de départ :** le dernier ROWID à l'activation ; aucun historique sortant importé automatiquement.
- **Ce qui est lu :** messages texte en 1-à-1 (iMessage, SMS, RCS), vers l'Inbox **uniquement** : jamais vers le pipeline RDV, jamais classés.
- **Aucune capacité d'envoi :** rien n'est écrit dans Messages.
- **Rattrapage d'une période :** `backfill-inbox --from … --to … --direction sortants` (dry-run, puis `--live --confirm sortants:…:N`).

## Confidentialité et sécurité

**Base Apple** :
- lue en lecture seule (écriture refusée par SQLite, test dédié) ;
- jamais modifiée ;
- pas de copie de la base ;
- aucune pièce jointe lue.

**Contenu transmis** : seuls les messages **entrants**, en conversation 1-à-1 et classés `probable` partent vers MediumIA, uniquement en mode réel. Aucune copie générale de la messagerie n'est faite.

**État local** (`state/*.json`, 0600, dossier 0700, ignoré par Git) :
- il contient le curseur, les identifiants Apple, le statut et la date ;
- **il ne contient jamais** de texte, de numéro ni de nom ;
- un nouvel essai relit le message dans `chat.db` ;
- il est purgé après 60 jours (5 000 entrées au plus).

**Journal technique** : uniquement des compteurs, des empreintes courtes d'identifiants, les codes HTTP et le nom des champs refusés. Jamais de texte, de numéro ni de jeton (test dédié).

**Affichage dry-run** (terminal) : le texte des seuls messages `probable` et `incertain`, numéro masqué.

**Réseau et jeton** :
- HTTPS obligatoire, sauf vers un faux serveur local de test ;
- jeton lu dans le Trousseau, envoyé seulement dans l'en-tête `Authorization`.

**Garde-fous** : aucune IA locale ni distante dans le filtre, aucune réponse automatique, aucune action au-delà du dépôt d'une demande « pending ».

## Tests

```bash
npm test
```

Données entièrement fictives. Les tests utilisent une fausse `chat.db` en mode WAL et un faux serveur HTTP local, sans aucun envoi vers la PROD.

**Les 12 cas demandés :**
1. iMessage lié à un rendez-vous ;
2. SMS lié à un rendez-vous ;
3. message personnel ignoré ;
4. message incertain ;
5. lecture double sans doublon ;
6. message sortant jamais importé ;
7. pièce jointe sans texte ;
8. redémarrage sans réimport ;
9. jeton absent ;
10. erreur réseau et nouvel essai ;
11. réponse `duplicate` ;
12. contenu malveillant.

**Cas supplémentaires :**
- validateur réel du serveur ;
- lecture seule ;
- `attributedBody` ;
- groupes, réactions et numéros courts ;
- confidentialité de l'état et du journal ;
- dates Apple ;
- HTTPS ;
- refus du mode réel sans configuration.
