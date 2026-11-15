# Lumia : ajouter à « Demandes de RDV à traiter » les demandes détectées dans les messages

Lumia lisait déjà les SMS, iMessage et RCS (`lumia_message_inbox`, lecture seule). Elle peut maintenant **proposer** les demandes de rendez-vous qu'elle y trouve, puis **les enregistrer après le GO de Sébastien**.

```
Sébastien : « Ajoute à ma liste à traiter les demandes de mes messages depuis le 1er novembre »
   → analyse serveur (sans IA) → rapprochement MediumIA → liste numérotée + code
Sébastien : « GO #A1B2C3 »  (ou « GO #A1B2C3 1,3 »)
   → validation → exécution SQL journalisée → demandes « pending » dans l'espace RDV
```

## Ce que fait l'analyse

1. **Messages lus** : uniquement les messages **reçus** de la période, classés `probable` ou `incertain` par le filtre RDV du bridge. Un message classé `ignorer` (personnel, politesse, numéro court) n'est jamais lu, ni affiché, ni copié.
2. **Période** :
   - celle de la phrase (« depuis le 1er novembre 2026 », « cette semaine », « du 3 au 10 novembre »…) ;
   - sinon, les 14 derniers jours.
   - Plusieurs canaux cités (« SMS, iMessages et RCS ») : pas de filtre de canal.
3. **Rapprochement**, une ligne par conversation :

| Situation | Résultat |
|---|---|
| Message déjà importé (`booking_request_intake_events`) | déjà dans MediumIA |
| Demande ouverte (`pending` / `contacted`) pour la conversation | déjà dans MediumIA |
| Demande ouverte du même numéro (formulaire, autre canal) | déjà dans MediumIA |
| Dossier traité (planifié, archivé, refusé, annulé), sans nouveau message | déjà dans MediumIA |
| Dossier traité, puis **nouveau message** RDV | proposé (signalé) |
| Rien dans MediumIA | proposé |

4. **Signalements** (informatifs) : rendez-vous confirmé à venir pour le même numéro, réponse visible de Sébastien, dossier précédent.
5. **Plafond** : 25 dossiers par proposition (les plus probables, puis les plus récents) ; la troncature est annoncée.

## Validation et exécution

- La proposition est un **preview immuable** (`lumia_action_intents`, action `mediumia.booking_request.import`), valable 30 minutes.
  - Il ne contient que des références : identifiants de messages, canal, conversation, indices de modalité et de prestation. Aucun texte de message.
  - Une nouvelle analyse dans la même conversation remplace la proposition précédente (statut `expired`).
- « GO #CODE » : tout ; « GO #CODE 1,3 » ou « GO #CODE 2-4 » : une sélection. Sans code, seulement s'il n'y a qu'une action en attente.
- Chaîne serveur : `lumia_approve_action_intent` → `lumia_claim_action_execution` → `lumia_execute_booking_request_import`.
- **L'exécuteur, pour chaque dossier retenu**, sous les mêmes verrous que `lumia_upsert_booking_request` :
  1. relit le message en base (reçu, classé RDV, du même propriétaire), sinon `source_unavailable` ;
  2. message déjà importé : `already_imported`, rien n'est fait ;
  3. demande ouverte pour la conversation ou le numéro : `already_open`, rien n'est fait ;
  4. sinon, appelle `lumia_upsert_booking_request` : nouvelle demande `pending`, `needs_review`, avec le rapprochement client existant (téléphone, puis e-mail ; jamais le nom).
- **Rejeu** (double clic, second GO) : le résultat enregistré est renvoyé, rien n'est refait.

**Jamais** :
- modification d'une demande existante ;
- booking ou confirmation ;
- écriture Google Agenda ;
- envoi de SMS, iMessage, RCS ou e-mail ;
- paiement.

## Sécurité et journal

- **Authentification** : la commande n'est lue que dans le message de Sébastien, dans sa conversation Lumia authentifiée (`api/agent-chat.js`, avant l'appel au modèle). Un texte de client n'est jamais une commande.
- **Droits** : RPC réservées au `service_role` (`lumia_require_service_role`) ; `EXECUTE` retiré à `PUBLIC`, `anon`, `authenticated`.
- **Journal** :
  - `lumia_action_attempts` : création, GO (acteur `owner`), réclamation, résultat (sélection, nombres créés et écartés) ;
  - `booking_request_intake_events` : une ligne `created` par message importé.
  - Aucun texte client dans le journal ni dans `execution_result`.
- **Activation** :
  - liste blanche `LUMIA_ALLOWED_ACTIONS` ;
  - et `LUMIA_REQUEST_IMPORT_ENABLED=true`, ou une préversion branchée à Supabase TEST (activation automatique, jamais en Production) ;
  - `LUMIA_REQUEST_IMPORT_ENABLED=false` coupe partout.

## Fichiers

- `supabase/migrations/20261115090000_lumia_booking_request_import.sql` : canal `rcs` accepté, type d'action, `lumia_create_action_intent` mis à jour, exécuteur.
- `lib/lumiaRequestImport.js` : commandes, analyse, rapprochement, textes de Lumia.
- `lib/lumiaMessageInbox.js` : « depuis le … » et plusieurs canaux cités.
- `lib/lumiaPolicy.js` : action ajoutée à la liste blanche et à la politique (v2026-11-15.1).
- `tests/lumiaRequestImport.test.js`.
