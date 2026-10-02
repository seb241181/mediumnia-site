# Lumia Intake — importer une demande de rendez-vous détectée dans un message

MediumIA est la source de vérité des rendez-vous. Un agent (Lumia aujourd'hui,
Dots, WhatsApp, ChatGPT… demain) **n'écrit jamais dans Google Agenda** : il
dépose une demande dans MediumIA, que Sébastien confirme depuis l'espace RDV
(flux existant : `confirm_booking_request` → booking → `syncBookingToGoogleCalendar`).

## Authentification

- `Authorization: Bearer <LUMIA_INTAKE_TOKEN>` : variable d'environnement serveur, 32 caractères minimum, jamais dans Git.
- Le jeton n'ouvre que les deux opérations ci-dessous, pour le seul praticien `LUMIA_INTAKE_PRACTITIONER_SLUG` (par défaut `sebastien-seguin`).
- Aucune clé Supabase, PayPal, Google ou Resend n'est transmise à l'agent.
- Sans jeton configuré, l'API répond `503 lumia_not_configured`.

## Lister les prestations (pour choisir un vrai identifiant)

`GET /api/rdv-admin?action=lumia-services` → `{ services: [{ id, slug, title, modality, duration_min, price_cents }] }`

Les disponibilités se lisent avec l'API publique existante `/api/rdv-availability`.

## Importer une demande

`POST /api/rdv-admin?action=lumia-rdv-intake` (JSON) :

| Champ | Obligatoire | Exemple |
|---|---|---|
| `source_channel` | oui | `sms`, `imessage`, `whatsapp`, `dots`, `chatgpt`, `email`, `form`, `other` |
| `source_message_id` | oui | identifiant **stable** du message (jamais son texte) |
| `source_conversation_id` | non | identifiant du fil : les messages suivants mettent à jour la même demande ouverte |
| `message_sent_at`, `detected_at` | non | ISO 8601 |
| `agent` | non | `lumia` (par défaut) |
| `first_name`, `last_name`, `phone`, `email` | non | `Sylvie`, `06 12 34 56 78` |
| `message_text` | non | texte original (2000 caractères max) |
| `service_id` | non | identifiant issu de `lumia-services` |
| `service_hint` | non | `guidance`, `désenvoûtement`… |
| `modality` | non | `video`, `in-person`, `phone`, `unknown` |
| `requested_date` + `requested_time` | non | `2026-10-13` + `14:00` (heure de Paris) |
| `requested_period` | non | `lundi matin` |
| `confidence` | non | 0 à 1 |

Réponse :

```json
{ "request_id": "…", "outcome": "created | updated | duplicate", "status": "pending",
  "service": { "id": "…", "title": "…" } | null, "service_resolution": "id | hint | ambiguous | unknown_id | none",
  "customer_match": "phone | email | none | ambiguous", "needs_review": true,
  "proposed_starts_at": "…" | null, "booking_created": false, "calendar_written": false }
```

**Règles :**
- Le même message (canal + identifiant) renvoie toujours la même demande, même en cas d'appels simultanés.
- Une prestation n'est jamais inventée : un identifiant inconnu est ignoré, et un indice ambigu laisse la prestation vide, à vérifier.
- Client : rapprochement par téléphone exact normalisé, puis par e-mail exact, jamais par le nom. En cas de doute (« ambiguous »), rien n'est fusionné.
- Phase 1 : aucune confirmation automatique, aucun booking, aucun événement Google.

## Référentiel clients (`mediumia_customers`)

Un client n'est pas une demande : `mediumia_customers` est distinct de `booking_requests` et de `bookings`. La migration `20261002085000_mediumia_customers.sql` le crée vide. Il pourra recevoir l'export clients Reservio (3 651 fiches) ; **aucun import n'est fait à ce stade**.

| Colonne | Rôle |
|---|---|
| `first_name`, `last_name`, `email` (normalisé), `phone_e164` (normalisé) | Données utiles à la gestion des rendez-vous |
| `source` | Provenance de la fiche : `mediumia`, `reservio`, `manual` |
| `external_id` | Identifiant externe s'il existe (l'export Reservio n'en a pas) |
| `field_sources` | Provenance et date de chaque champ : `{ "email": { "source": "reservio", "at": "…" } }` |
| `identity_status` | `ok` ou `ambiguous` (téléphone ou e-mail partagé par des noms différents) |
| `imported_at`, `source_updated_at`, `updated_at` | Dates d'import, de mise à jour à la source et en base |

**Écriture** : uniquement par `upsert_mediumia_customer` (service_role).
- **Rapprochement**, dans cet ordre :
  1. identifiant externe ;
  2. téléphone exact ;
  3. e-mail exact.

  Le nom ne sert qu'à vérifier la compatibilité. Téléphone et e-mail concordants donnent une confiance « strong ».
- **Doublons du fichier** : même téléphone ou e-mail avec un nom compatible donne la même fiche. Même téléphone ou e-mail avec un autre nom donne une nouvelle fiche, et toutes les fiches concernées passent en `ambiguous`, sans fusion.
- **Écrasement** : un champ n'est remplacé que par une valeur plus récente. Une valeur sans date ne remplace jamais rien, et un vide n'efface rien. Une donnée MediumIA récente n'est donc jamais remplacée par une ancienne valeur Reservio.

**Consentements** : table séparée `mediumia_customer_consents`, alimentée par `record_mediumia_customer_consent`.
- `privacyPolicyAcceptedAt` devient `privacy_policy`. Ce n'est **pas** un consentement marketing.
- `marketingNotificationsAcceptedAt` devient `marketing` : c'est seulement la trace de l'ancien consentement Reservio.
- Aucun usage automatique en phase 1 : aucune communication commerciale.

**Colonnes Reservio écartées** : `address`, `note` et `birthday` ne sont pas importées.

**Préparation de l'import** : `lib/reservioCustomers.js` (fonctions pures, sans base) fournit :
- `mapReservioCustomer`, qui convertit une ligne d'export en fiche et en consentements ;
- `analyzeReservioExport`, une analyse à blanc qui ne renvoie que des compteurs : importables, sans contact, doublons, téléphones ou e-mails ambigus, consentements, colonnes écartées remplies.

**Lumia** :
- **Parcours** : SMS entrant → téléphone → `mediumia_customers` → fiche → historique MediumIA (`customer_history` : nombre de rendez-vous, dernier rendez-vous) → nouvelle `booking_request`.
- **Lien** : `customer_id` n'est posé que pour une fiche unique, non ambiguë, trouvée par téléphone ou e-mail exacts.
- **Nom et prénom seuls** : simple suggestion (`customer_suggestion_id`), jamais un lien ni une complétion. Avec des homonymes, il n'y a aucune suggestion.
