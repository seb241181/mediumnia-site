-- MediumIA Rendez-vous — Migration v2 (idempotente)
-- État réel de la base avant cette migration :
--   ✓ booking_practitioners (sans buffer_*, min_advance_hours, max_per_day, booking_enabled)
--   ✓ booking_services (avec slug, modality TEXT[])
--   ✓ booking_availability_rules
--   ✓ booking_calendar_connections
--   ✓ oauth_states (avec practitioner_id et user_id déjà présents)
--   ✗ bookings (à créer)
--   ✗ booking_exceptions (à créer)
--   ✗ create_booking RPC (à créer)
--
-- À appliquer via Supabase Dashboard → SQL Editor.
-- NE PAS appliquer automatiquement.
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / OR REPLACE).

-- ── 1. Colonnes manquantes dans booking_practitioners ─────────────────────────

ALTER TABLE booking_practitioners
  ADD COLUMN IF NOT EXISTS buffer_before_min  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_min   INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_advance_hours  INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS max_per_day        INTEGER,
  ADD COLUMN IF NOT EXISTS booking_enabled    BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Table bookings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id      UUID        NOT NULL REFERENCES booking_practitioners(id) ON DELETE RESTRICT,
  service_id           UUID        NOT NULL REFERENCES booking_services(id)      ON DELETE RESTRICT,

  -- Client
  customer_first_name  TEXT        NOT NULL,
  customer_last_name   TEXT        NOT NULL,
  customer_email       TEXT        NOT NULL,
  customer_phone       TEXT,
  customer_message     TEXT,

  -- Créneau (UTC, fuseau stocké séparément)
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

-- Trigger updated_at pour bookings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_upd') THEN
    CREATE TRIGGER bookings_upd BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION booking_set_updated_at();
  END IF;
END $$;

-- RLS : le praticien voit ses propres réservations
CREATE POLICY IF NOT EXISTS "practitioner_own_bookings" ON bookings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- ── 3. Table booking_exceptions (congés, fermetures exceptionnelles) ──────────

CREATE TABLE IF NOT EXISTS booking_exceptions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  practitioner_id UUID        NOT NULL REFERENCES booking_practitioners(id) ON DELETE CASCADE,
  exception_date  DATE        NOT NULL,
  -- 'closed'   : journée fermée (aucun créneau)
  -- 'modified' : horaires modifiés (utiliser le champ slots)
  exception_type  TEXT        NOT NULL DEFAULT 'closed'
                  CHECK (exception_type IN ('closed', 'modified')),
  -- Pour type='modified' : [{start_time: "HH:MM", end_time: "HH:MM"}, ...]
  -- Pour type='closed'   : NULL
  slots           JSONB,
  note            TEXT,
  UNIQUE (practitioner_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_booking_exceptions_practitioner_date
  ON booking_exceptions (practitioner_id, exception_date);

ALTER TABLE booking_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "practitioner_own_exceptions" ON booking_exceptions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- ── 4. RPC create_booking — INSERT atomique anti-double-booking ───────────────
--
-- Utilise pg_advisory_xact_lock(hashtext(practitioner_id)) pour garantir que
-- deux appels simultanés pour le même praticien ne peuvent pas créer deux
-- réservations sur le même créneau (pas de fenêtre TOCTOU entre SELECT et INSERT).
--
-- Retourne JSON :
--   { "conflict": false, "booking_id": "uuid" }  → réservation créée
--   { "conflict": true,  "error": "message" }    → créneau déjà pris
--
-- Appelé depuis api/rdv-book.js via :
--   supabase.rpc('create_booking', { p_practitioner_id, p_service_id, ... })

CREATE OR REPLACE FUNCTION create_booking(
  p_practitioner_id      UUID,
  p_service_id           UUID,
  p_starts_at            TIMESTAMPTZ,
  p_ends_at              TIMESTAMPTZ,
  p_customer_first_name  TEXT,
  p_customer_last_name   TEXT,
  p_customer_email       TEXT,
  p_customer_phone       TEXT    DEFAULT NULL,
  p_customer_message     TEXT    DEFAULT NULL,
  p_timezone             TEXT    DEFAULT 'Europe/Paris'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conflict  BOOLEAN;
  v_booking_id UUID;
BEGIN
  -- Verrou exclusif par praticien : une seule réservation à la fois par praticien.
  -- Le verrou est libéré automatiquement à la fin de la transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  -- Vérification du chevauchement avec les réservations existantes confirmées.
  -- La condition (starts_at < p_ends_at AND ends_at > p_starts_at) couvre
  -- tous les cas de chevauchement (partiel, englobant, identique).
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status          = 'confirmed'
      AND b.starts_at       < p_ends_at
      AND b.ends_at         > p_starts_at
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN json_build_object(
      'conflict', true,
      'error', 'Ce créneau est déjà réservé. Choisissez un autre horaire.'
    );
  END IF;

  -- Insertion atomique (dans le même verrou que la vérification)
  INSERT INTO bookings (
    practitioner_id, service_id,
    starts_at, ends_at, timezone,
    customer_first_name, customer_last_name, customer_email,
    customer_phone, customer_message,
    status
  ) VALUES (
    p_practitioner_id, p_service_id,
    p_starts_at, p_ends_at, p_timezone,
    p_customer_first_name, p_customer_last_name, p_customer_email,
    p_customer_phone, p_customer_message,
    'confirmed'
  )
  RETURNING id INTO v_booking_id;

  RETURN json_build_object(
    'conflict',    false,
    'booking_id',  v_booking_id
  );
END;
$$;

-- Restriction d'accès : seul service_role peut appeler create_booking.
-- Le client ne peut jamais déclencher une réservation directement.
REVOKE EXECUTE ON FUNCTION public.create_booking(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_booking(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_booking(UUID,UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ── 5. RLS sur les tables existantes (si absentes) ────────────────────────────
-- Le Supabase Advisor signale que plusieurs tables ont RLS activé mais sans policy.
-- Les mutations passent par des APIs service_role avec vérification owner_id serveur :
-- les policies authenticated ci-dessous sont un filet de sécurité pour les accès directs.

-- booking_practitioners : lecture par le propriétaire
CREATE POLICY IF NOT EXISTS "practitioner_owner_select" ON booking_practitioners
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY IF NOT EXISTS "practitioner_owner_update" ON booking_practitioners
  FOR UPDATE TO authenticated USING (owner_id = auth.uid());

-- booking_services : lecture publique des services actifs
CREATE POLICY IF NOT EXISTS "services_public_select" ON booking_services
  FOR SELECT USING (is_active = true);
CREATE POLICY IF NOT EXISTS "services_owner_all" ON booking_services
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- booking_availability_rules : lecture publique (nécessaire pour rdv-config)
CREATE POLICY IF NOT EXISTS "availability_public_select" ON booking_availability_rules
  FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "availability_owner_all" ON booking_availability_rules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- booking_calendar_connections : jamais public, uniquement owner
CREATE POLICY IF NOT EXISTS "calendar_conn_owner_select" ON booking_calendar_connections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM booking_practitioners bp
      WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
    )
  );

-- ── 6. Mise à jour owner_id (étape obligatoire post-migration) ────────────────
-- Récupérer votre UUID dans Supabase → Authentication → Users → User UID.
-- Remplacer <votre-uuid> par la valeur réelle avant d'exécuter.

-- UPDATE booking_practitioners SET owner_id = '<votre-uuid>' WHERE slug = 'sebastien-seguin';
-- UPDATE booking_practitioners SET owner_id = '<votre-uuid>' WHERE slug = 'aurelie-seguin';
