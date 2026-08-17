# Schéma Supabase — `practitioner_applications`

> **À préparer avant Production.** Ne pas appliquer cette migration en Preview ni toucher aux tables existantes.

## Flux de statut

```
pending → review → approved → published
                → rejected
```

Une demande ne crée jamais automatiquement une fiche publique.
Sébastien/Aurélie valident manuellement chaque candidature.

---

## Schéma SQL

```sql
CREATE TABLE IF NOT EXISTS practitioner_applications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Statut de la candidature
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'review', 'approved', 'published', 'rejected')),

  -- 01 · Informations
  prenom           TEXT NOT NULL,
  nom              TEXT NOT NULL,
  nom_pro          TEXT,
  email            TEXT NOT NULL,
  telephone        TEXT,
  ville            TEXT NOT NULL,
  departement      TEXT NOT NULL,
  distance         BOOLEAN NOT NULL,        -- true = consultations à distance : Oui
  site             TEXT,
  instagram        TEXT,
  activite         TEXT NOT NULL,
  specialites      TEXT NOT NULL,
  annees_pratique  TEXT NOT NULL,
  siret            TEXT,

  -- 02 · Présentation
  pratique  TEXT NOT NULL,
  approche  TEXT NOT NULL,
  audience  TEXT NOT NULL,
  pourquoi  TEXT NOT NULL,

  -- Consentement
  certifie_exactitude BOOLEAN NOT NULL DEFAULT false,

  -- Traitement interne (rempli par l'équipe)
  reviewer_notes TEXT,
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT
);
```

## Trigger `updated_at`

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON practitioner_applications
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## Index suggérés

```sql
CREATE INDEX idx_pract_apps_status  ON practitioner_applications (status);
CREATE INDEX idx_pract_apps_email   ON practitioner_applications (email);
CREATE INDEX idx_pract_apps_created ON practitioner_applications (created_at DESC);
```

## Row Level Security

```sql
-- Activer RLS
ALTER TABLE practitioner_applications ENABLE ROW LEVEL SECURITY;

-- Lecture : réservée aux membres de l'équipe (role admin ou service_role)
CREATE POLICY "admin_read" ON practitioner_applications
  FOR SELECT USING (auth.role() = 'service_role');

-- Insertion publique (formulaire) : autorisée sans authentification
-- IMPORTANT : ajouter validation serveur + rate limiting dans l'API avant d'activer
CREATE POLICY "public_insert" ON practitioner_applications
  FOR INSERT WITH CHECK (true);
```

## Endpoint API à créer (prochaine passe)

`POST /api/reseau-apply`

**Responsabilités avant Production :**
- Validation serveur de tous les champs requis
- Rate limiting par IP (Upstash Redis ou Vercel KV)
- Sanitisation des entrées texte
- Protection anti-spam (honeypot ou Turnstile)
- Politique de confidentialité / mention RGPD
- Email de confirmation à l'équipe (Resend ou EmailJS)

## Notes économiques

- Présence MediumIA = fiche dans le réseau (examinée + publiée manuellement)
- MediumIA Pro = services professionnels enrichis (assistants IA, outils, badge)
- Aucun classement "meilleur praticien" basé sur le paiement
- Badges futurs : "Présent sur MediumIA" · "Membre fondateur du réseau MediumIA"
