-- MediumIA — Migration booking_mode + booking_requests
-- Fournir au praticien, NE PAS appliquer automatiquement.
-- Appliquer via Supabase Dashboard → SQL Editor.

-- ── 1. Colonne booking_mode sur booking_services ─────────────────────────────

ALTER TABLE booking_services
  ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'instant'
  CONSTRAINT booking_services_booking_mode_check
    CHECK (booking_mode IN ('instant', 'request'));

-- ── 2. Table booking_requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_requests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id       UUID        NOT NULL REFERENCES booking_practitioners(id) ON DELETE RESTRICT,
  service_id            UUID        NOT NULL REFERENCES booking_services(id) ON DELETE RESTRICT,

  -- Client
  customer_first_name   TEXT        NOT NULL,
  customer_last_name    TEXT        NOT NULL,
  customer_email        TEXT        NOT NULL,
  customer_phone        TEXT        NOT NULL,   -- obligatoire pour les déplacements

  -- Adresse du lieu d'intervention (présentiel)
  address_line1         TEXT        NOT NULL,
  address_line2         TEXT,
  postal_code           TEXT        NOT NULL,
  city                  TEXT        NOT NULL,

  -- Informations complémentaires
  customer_message      TEXT,
  preferred_period      TEXT,                   -- texte libre : "en soirée de préférence"

  -- Cycle de vie
  status                TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT booking_requests_status_check
      CHECK (status IN ('pending', 'contacted', 'scheduled', 'rejected', 'cancelled')),

  -- Rempli par le praticien lors de la confirmation
  travel_fee_cents      INTEGER     DEFAULT 0,
  final_price_cents     INTEGER,               -- NULL = pas encore confirmé
  scheduled_at          TIMESTAMPTZ,           -- date/heure convenue avec le client
  confirmed_booking_id  UUID        REFERENCES bookings(id) ON DELETE SET NULL,
  practitioner_notes    TEXT        -- usage interne uniquement, jamais exposé publiquement
);

-- ── 3. Index ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_booking_requests_practitioner
  ON booking_requests (practitioner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_requests_email
  ON booking_requests (customer_email);

-- ── 4. Trigger updated_at ─────────────────────────────────────────────────────
-- La fonction booking_set_updated_at() est définie dans rdv-schema.sql.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'booking_requests_upd'
  ) THEN
    CREATE TRIGGER booking_requests_upd
      BEFORE UPDATE ON booking_requests
      FOR EACH ROW EXECUTE FUNCTION booking_set_updated_at();
  END IF;
END $$;

-- ── 5. RLS ────────────────────────────────────────────────────────────────────
-- Lecture/écriture réservées au praticien propriétaire (via service_role dans l'API).
-- Aucune lecture publique. Les clients ne peuvent pas lire leurs propres demandes
-- (lecture via service_role uniquement, jamais via anon/authenticated côté client).

ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'booking_requests' AND policyname = 'practitioner_own_requests'
  ) THEN
    CREATE POLICY "practitioner_own_requests" ON booking_requests
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 6. Vérification ───────────────────────────────────────────────────────────
-- Après application, vérifier :
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'booking_services' AND column_name = 'booking_mode';
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name = 'booking_requests';
