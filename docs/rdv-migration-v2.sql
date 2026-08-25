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
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / OR REPLACE / DO blocks).
--
-- Note PostgreSQL : CREATE POLICY ne supporte pas IF NOT EXISTS.
-- Les policies sont créées dans des blocs DO qui vérifient pg_policies.

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

-- ── 4. RPC create_booking — INSERT atomique anti-double-booking ───────────────
--
-- Utilise pg_advisory_xact_lock(hashtext(practitioner_id)) pour garantir que
-- deux appels simultanés pour le même praticien ne peuvent pas créer deux
-- réservations sur le même créneau (pas de fenêtre TOCTOU entre SELECT et INSERT).
--
-- Vérifie sous le même verrou :
--   - chevauchement exact (overlap)
--   - buffers before/after lus depuis booking_practitioners
--   - max_per_day
--
-- Retourne JSON :
--   { "conflict": false, "booking_id": "uuid" }  → réservation créée
--   { "conflict": true,  "error": "message" }    → créneau refusé
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
  v_buffer_before  INTEGER;
  v_buffer_after   INTEGER;
  v_max_per_day    INTEGER;
  v_conflict       BOOLEAN;
  v_count_today    INTEGER;
  v_booking_id     UUID;
  v_buffer_before_interval INTERVAL;
  v_buffer_after_interval  INTERVAL;
BEGIN
  -- Verrou exclusif par praticien : sérialise toutes les écritures pour ce praticien.
  -- Le verrou est libéré automatiquement à la fin de la transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  -- Lecture des paramètres de buffer et max_per_day sous le verrou
  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_buffer_before, v_buffer_after, v_max_per_day
    FROM booking_practitioners
   WHERE id = p_practitioner_id;

  v_buffer_before_interval := (COALESCE(v_buffer_before, 0) || ' minutes')::INTERVAL;
  v_buffer_after_interval  := (COALESCE(v_buffer_after,  0) || ' minutes')::INTERVAL;

  -- Vérification du chevauchement avec buffers.
  -- La fenêtre occupée par une réservation existante b est :
  --   [b.starts_at - buffer_before, b.ends_at + buffer_after]
  -- La fenêtre de la nouvelle réservation est :
  --   [p_starts_at - buffer_before, p_ends_at + buffer_after]
  -- Overlap si ces fenêtres se chevauchent.
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status          = 'confirmed'
      AND (b.starts_at - v_buffer_before_interval) < (p_ends_at   + v_buffer_after_interval)
      AND (b.ends_at   + v_buffer_after_interval)  > (p_starts_at - v_buffer_before_interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN json_build_object(
      'conflict', true,
      'error', 'Ce créneau est déjà réservé (buffer inclus). Choisissez un autre horaire.'
    );
  END IF;

  -- Vérification max_per_day sous le verrou
  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_today
      FROM bookings b
     WHERE b.practitioner_id = p_practitioner_id
       AND b.status          = 'confirmed'
       AND b.starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
       AND b.starts_at <  date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
                        + INTERVAL '1 day';

    IF v_count_today >= v_max_per_day THEN
      RETURN json_build_object(
        'conflict', true,
        'error', 'Nombre maximum de rendez-vous atteint pour ce jour.'
      );
    END IF;
  END IF;

  -- Insertion atomique (dans le même verrou que les vérifications)
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

-- ── 5. RLS sur les tables (via DO blocks — CREATE POLICY n'a pas IF NOT EXISTS) ─

-- bookings : le praticien voit ses propres réservations
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bookings' AND policyname = 'practitioner_own_bookings'
  ) THEN
    CREATE POLICY "practitioner_own_bookings" ON bookings
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- booking_exceptions : le praticien gère ses exceptions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_exceptions' AND policyname = 'practitioner_own_exceptions'
  ) THEN
    CREATE POLICY "practitioner_own_exceptions" ON booking_exceptions
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- booking_practitioners : lecture + modification par le propriétaire
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_practitioners' AND policyname = 'practitioner_owner_select'
  ) THEN
    CREATE POLICY "practitioner_owner_select" ON booking_practitioners
      FOR SELECT TO authenticated USING (owner_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_practitioners' AND policyname = 'practitioner_owner_update'
  ) THEN
    CREATE POLICY "practitioner_owner_update" ON booking_practitioners
      FOR UPDATE TO authenticated USING (owner_id = auth.uid());
  END IF;
END $$;

-- booking_services : lecture publique des services actifs + gestion par le propriétaire
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_services' AND policyname = 'services_public_select'
  ) THEN
    CREATE POLICY "services_public_select" ON booking_services
      FOR SELECT USING (is_active = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_services' AND policyname = 'services_owner_all'
  ) THEN
    CREATE POLICY "services_owner_all" ON booking_services
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- booking_availability_rules : lecture publique + gestion par le propriétaire
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_availability_rules' AND policyname = 'availability_public_select'
  ) THEN
    CREATE POLICY "availability_public_select" ON booking_availability_rules
      FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_availability_rules' AND policyname = 'availability_owner_all'
  ) THEN
    CREATE POLICY "availability_owner_all" ON booking_availability_rules
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- booking_calendar_connections : jamais public, uniquement owner
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'booking_calendar_connections' AND policyname = 'calendar_conn_owner_select'
  ) THEN
    CREATE POLICY "calendar_conn_owner_select" ON booking_calendar_connections
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM booking_practitioners bp
          WHERE bp.id = practitioner_id AND bp.owner_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 6. Mise à jour owner_id (étape obligatoire post-migration) ────────────────
-- Récupérer votre UUID dans Supabase → Authentication → Users → User UID.
-- Remplacer <votre-uuid> par la valeur réelle avant d'exécuter.

-- UPDATE booking_practitioners SET owner_id = '<votre-uuid>' WHERE slug = 'sebastien-seguin';
-- UPDATE booking_practitioners SET owner_id = '<votre-uuid>' WHERE slug = 'aurelie-seguin';
