-- MediumIA Rendez-vous — schéma Supabase
-- À préparer avant Production. Ne pas appliquer sans review.
-- Appliquer via Supabase Dashboard → SQL Editor, jamais automatiquement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Praticiens ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_practitioners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  slug          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT '',
  photo_url     TEXT,
  tagline       TEXT        NOT NULL DEFAULT '',
  intro         TEXT        NOT NULL DEFAULT '',
  timezone      TEXT        NOT NULL DEFAULT 'Europe/Paris',
  is_active     BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_booking_practitioners_slug ON booking_practitioners (slug);
ALTER TABLE booking_practitioners ENABLE ROW LEVEL SECURITY;

-- ── Services (prestations) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_services (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id UUID        NOT NULL REFERENCES booking_practitioners(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT        NOT NULL DEFAULT '',
  duration_min    INTEGER     NOT NULL CHECK (duration_min > 0),
  price_cents     INTEGER,                             -- NULL = tarif à confirmer
  currency        TEXT        NOT NULL DEFAULT 'EUR',
  modality        TEXT[]      NOT NULL DEFAULT '{}',   -- ['video','phone','in-person']
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_booking_services_practitioner ON booking_services (practitioner_id);
ALTER TABLE booking_services ENABLE ROW LEVEL SECURITY;

-- ── Connexions Google Agenda ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_calendar_connections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id  UUID        NOT NULL UNIQUE REFERENCES booking_practitioners(id) ON DELETE CASCADE,
  google_email     TEXT        NOT NULL,
  google_calendar_id TEXT      NOT NULL DEFAULT 'primary',
  -- Tokens chiffrés AES-256 côté serveur — JAMAIS en clair
  access_token_enc TEXT        NOT NULL,
  refresh_token_enc TEXT       NOT NULL,
  token_expiry     TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true
);

ALTER TABLE booking_calendar_connections ENABLE ROW LEVEL SECURITY;

-- ── Règles de disponibilité hebdomadaires ───────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_availability_rules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id  UUID        NOT NULL REFERENCES booking_practitioners(id) ON DELETE CASCADE,
  day_of_week      INTEGER     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Lun
  start_time       TIME        NOT NULL,
  end_time         TIME        NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_booking_avail_practitioner ON booking_availability_rules (practitioner_id, day_of_week);
ALTER TABLE booking_availability_rules ENABLE ROW LEVEL SECURITY;

-- ── Réservations ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id      UUID        NOT NULL REFERENCES booking_practitioners(id),
  service_id           UUID        NOT NULL REFERENCES booking_services(id),

  -- Client
  customer_first_name  TEXT        NOT NULL,
  customer_last_name   TEXT        NOT NULL,
  customer_email       TEXT        NOT NULL,
  customer_phone       TEXT,
  customer_message     TEXT,

  -- Créneau
  starts_at            TIMESTAMPTZ NOT NULL,
  ends_at              TIMESTAMPTZ NOT NULL,
  timezone             TEXT        NOT NULL DEFAULT 'Europe/Paris',

  -- Statut
  status               TEXT        NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'rescheduled')),
  cancelled_at         TIMESTAMPTZ,
  cancel_reason        TEXT,

  -- Google Calendar
  google_event_id      TEXT,
  google_meet_link     TEXT,

  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_practitioner_starts ON bookings (practitioner_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_email      ON bookings (customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_status             ON bookings (status);
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ── Trigger updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION booking_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'booking_practitioners_upd') THEN
    CREATE TRIGGER booking_practitioners_upd BEFORE UPDATE ON booking_practitioners
    FOR EACH ROW EXECUTE FUNCTION booking_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'booking_services_upd') THEN
    CREATE TRIGGER booking_services_upd BEFORE UPDATE ON booking_services
    FOR EACH ROW EXECUTE FUNCTION booking_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_upd') THEN
    CREATE TRIGGER bookings_upd BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION booking_set_updated_at();
  END IF;
END $$;

-- ── RLS policies (exemples — à affiner) ─────────────────────────────────────
-- Les praticiens lisent leurs propres données.
-- Les clients ne peuvent que créer une réservation (via service_role dans l'API).
-- Aucune lecture publique des bookings côté client.

CREATE POLICY "practitioner_own_bookings" ON bookings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- ── States OAuth (consommation unique — Production uniquement) ──────────────
-- En Preview, la signature HMAC + expiry 5 min suffisent.
-- En Production, stocker chaque state en DB garantit qu'il ne peut être rejoué.
--
-- Activer en Production :
--   1. Appliquer cette table
--   2. Dans api/google-calendar/connect.js : INSERT le state avant redirection
--   3. Dans api/google-calendar/callback.js : SELECT + DELETE le state (consommation unique)
--   4. Cron de purge : DELETE FROM oauth_states WHERE expires_at < now()

CREATE TABLE IF NOT EXISTS oauth_states (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  state        TEXT        NOT NULL UNIQUE,
  practitioner_slug TEXT   NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
-- Accessible uniquement via service_role (API serverless) — aucune policy authenticated.

-- ── Données initiales — praticiens ──────────────────────────────────────────
-- À appliquer après la création des tables.
-- owner_id est NULL en Preview (aucun compte auth.users requis pour tester le flux).

INSERT INTO booking_practitioners (slug, name, role, tagline, timezone, is_active)
VALUES
  ('sebastien-seguin', 'Sébastien Seguin', 'Médium & Accompagnant', 'Médium, fondateur de MediumIA', 'Europe/Paris', false),
  ('aurelie-seguin',   'Aurélie Seguin',   'Thérapeute & Accompagnante', 'Thérapeute, co-fondatrice MediumIA', 'Europe/Paris', false)
ON CONFLICT (slug) DO NOTHING;

-- ── Notes sécurité avant Production ─────────────────────────────────────────
-- 1. OAuth tokens Google : chiffrement AES-256 obligatoire au repos
-- 2. /api/rdv-book : rate limiting 5 req/min/IP via Upstash Redis
-- 3. Formulaire public : honeypot + validation email format+MX côté serveur
-- 4. Anti-double-booking : verrou transactionnel avant INSERT dans bookings
-- 5. RGPD : purge automatique des bookings + données client après 2 ans (cron)
-- 6. Accès praticien : chaque praticien via auth.uid() → ne voit que ses propres réservations
-- 7. Données client : ne jamais exposer dans les logs Vercel
