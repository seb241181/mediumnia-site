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
