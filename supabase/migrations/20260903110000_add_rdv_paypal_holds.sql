-- MediumIA Rendez-vous — holds PayPal visio (infrastructure seulement).
-- Cette migration ne doit être appliquée qu'après revue, jamais automatiquement.

CREATE TABLE IF NOT EXISTS public.rdv_booking_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  selected_modality TEXT NOT NULL DEFAULT 'video' CHECK (selected_modality = 'video'),
  customer_first_name TEXT NOT NULL,
  customer_last_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  customer_message TEXT,
  final_price_cents INTEGER NOT NULL CHECK (final_price_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'payment_pending' CHECK (status IN (
    'payment_pending', 'payment_capturing', 'payment_captured', 'converted', 'expired', 'failed'
  )),
  expires_at TIMESTAMPTZ,
  converted_booking_id UUID REFERENCES public.bookings(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (
    (status = 'payment_pending' AND expires_at IS NOT NULL)
    OR status <> 'payment_pending'
  )
);

CREATE INDEX IF NOT EXISTS idx_rdv_booking_holds_slot
  ON public.rdv_booking_holds (practitioner_id, starts_at, ends_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_rdv_booking_holds_active
  ON public.rdv_booking_holds (practitioner_id, status, starts_at)
  WHERE status IN ('payment_pending', 'payment_capturing', 'payment_captured');

CREATE TABLE IF NOT EXISTS public.rdv_paypal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id UUID NOT NULL UNIQUE REFERENCES public.rdv_booking_holds(id) ON DELETE CASCADE,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_env TEXT NOT NULL CHECK (paypal_env IN ('sandbox', 'live')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'order_pending' CHECK (status IN (
    'order_pending', 'capturing', 'captured', 'expired', 'failed'
  )),
  client_checkout_id UUID NOT NULL UNIQUE,
  captured_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rdv_paypal_payments_order
  ON public.rdv_paypal_payments (paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

ALTER TABLE public.rdv_booking_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rdv_paypal_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rdv_booking_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.rdv_paypal_payments FROM anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rdv_booking_holds_upd') THEN
    CREATE TRIGGER rdv_booking_holds_upd BEFORE UPDATE ON public.rdv_booking_holds
      FOR EACH ROW EXECUTE FUNCTION public.booking_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'rdv_paypal_payments_upd') THEN
    CREATE TRIGGER rdv_paypal_payments_upd BEFORE UPDATE ON public.rdv_paypal_payments
      FOR EACH ROW EXECUTE FUNCTION public.booking_set_updated_at();
  END IF;
END $$;

-- Seul le serveur crée un hold. Le prix et la devise viennent de booking_services.
CREATE OR REPLACE FUNCTION public.create_rdv_payment_hold(
  p_practitioner_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_customer_first_name TEXT,
  p_customer_last_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_message TEXT,
  p_client_checkout_id UUID,
  p_paypal_env TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_hold rdv_booking_holds;
  v_service booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ := now() + INTERVAL '15 minutes';
  v_conflict BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT h.* INTO v_existing_hold
  FROM rdv_paypal_payments p
  JOIN rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE OF h, p;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'hold_id', v_existing_hold.id,
      'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at,
      'amount_cents', v_existing_hold.final_price_cents,
      'currency', v_existing_hold.currency
    );
  END IF;

  SELECT * INTO v_service
  FROM booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;
  IF NOT FOUND OR v_service.booking_mode <> 'instant'
    OR NOT ('video' = ANY(v_service.modality))
    OR v_service.price_cents IS NULL OR v_service.price_cents <= 0
    OR v_service.currency <> 'EUR' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;
  IF p_ends_at <> p_starts_at + make_interval(mins => v_service.duration_min) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_service_duration');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_before, v_after, v_max_per_day
  FROM booking_practitioners
  WHERE id = p_practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM rdv_booking_holds h
    WHERE h.practitioner_id = p_practitioner_id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;
  IF v_conflict THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT starts_at FROM bookings
      WHERE practitioner_id = p_practitioner_id AND status = 'confirmed'
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
      UNION ALL
      SELECT starts_at FROM rdv_booking_holds
      WHERE practitioner_id = p_practitioner_id
        AND (status IN ('payment_capturing', 'payment_captured') OR (status = 'payment_pending' AND expires_at > now()))
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  INSERT INTO rdv_booking_holds (
    practitioner_id, service_id, starts_at, ends_at, selected_modality,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    final_price_cents, currency, status, expires_at
  ) VALUES (
    p_practitioner_id, p_service_id, p_starts_at, p_ends_at, 'video',
    p_customer_first_name, p_customer_last_name, lower(p_customer_email), p_customer_phone, p_customer_message,
    v_service.price_cents, v_service.currency, 'payment_pending', v_expires_at
  ) RETURNING id INTO v_hold_id;

  INSERT INTO rdv_paypal_payments (
    hold_id, paypal_env, amount_cents, currency, client_checkout_id, status
  ) VALUES (
    v_hold_id, p_paypal_env, v_service.price_cents, v_service.currency, p_client_checkout_id, 'order_pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'hold_id', v_hold_id,
    'status', 'payment_pending',
    'expires_at', v_expires_at,
    'amount_cents', v_service.price_cents,
    'currency', v_service.currency
  );
END;
$$;

-- Réclame le hold avant l'appel capture distant. Un hold capturé ne peut pas expirer.
CREATE OR REPLACE FUNCTION public.claim_rdv_payment_capture(p_paypal_order_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold rdv_booking_holds;
  v_payment rdv_paypal_payments;
  v_conflict BOOLEAN;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
BEGIN
  SELECT h.* INTO v_hold
  FROM rdv_paypal_payments p
  JOIN rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found'); END IF;
  SELECT * INTO v_payment FROM rdv_paypal_payments WHERE hold_id = v_hold.id;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_before, v_after, v_max_per_day
  FROM booking_practitioners
  WHERE id = v_hold.practitioner_id;

  IF v_hold.status = 'converted' THEN
    RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id);
  END IF;
  IF v_hold.status = 'payment_captured' THEN
    RETURN jsonb_build_object('ok', true, 'captured', true, 'hold_id', v_hold.id);
  END IF;
  IF v_hold.status = 'payment_capturing' AND v_hold.expires_at > now() THEN
    RETURN jsonb_build_object('ok', true, 'capturing', true, 'hold_id', v_hold.id);
  END IF;
  IF v_hold.status NOT IN ('payment_pending', 'payment_capturing') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_not_capturable');
  END IF;

  -- Revalidate any resumed/expired hold under the practitioner's advisory lock.
  -- This prevents a late PayPal approval from charging after another hold won the slot.
  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;
  IF v_conflict THEN
    IF v_payment.paypal_capture_id IS NOT NULL OR v_hold.status = 'payment_capturing' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
    END IF;
    UPDATE rdv_booking_holds SET status = 'expired' WHERE id = v_hold.id;
    UPDATE rdv_paypal_payments SET status = 'expired', last_error_code = 'slot_unavailable' WHERE id = v_payment.id;
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT b.starts_at FROM bookings b
      WHERE b.practitioner_id = v_hold.practitioner_id AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
      UNION ALL
      SELECT h.starts_at FROM rdv_booking_holds h
      WHERE h.practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
        AND h.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      IF v_payment.paypal_capture_id IS NOT NULL OR v_hold.status = 'payment_capturing' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
      END IF;
      UPDATE rdv_booking_holds SET status = 'expired' WHERE id = v_hold.id;
      UPDATE rdv_paypal_payments SET status = 'expired', last_error_code = 'daily_limit_reached' WHERE id = v_payment.id;
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  UPDATE rdv_booking_holds
  SET status = 'payment_capturing', expires_at = now() + INTERVAL '5 minutes'
  WHERE id = v_hold.id;
  UPDATE rdv_paypal_payments SET status = 'capturing', last_error_code = NULL WHERE id = v_payment.id;
  RETURN jsonb_build_object(
    'ok', true, 'hold_id', v_hold.id, 'amount_cents', v_hold.final_price_cents, 'currency', v_hold.currency
  );
END;
$$;

-- Enregistre la capture puis convertit le hold en booking confirmé, atomiquement.
CREATE OR REPLACE FUNCTION public.convert_rdv_payment_hold(
  p_paypal_order_id TEXT,
  p_paypal_capture_id TEXT,
  p_captured_at TIMESTAMPTZ,
  p_paypal_env TEXT,
  p_amount_cents INTEGER,
  p_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold rdv_booking_holds;
  v_payment rdv_paypal_payments;
  v_booking_id UUID;
  v_conflict BOOLEAN;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
BEGIN
  SELECT h.* INTO v_hold
  FROM rdv_paypal_payments p
  JOIN rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found'); END IF;
  SELECT * INTO v_payment FROM rdv_paypal_payments WHERE hold_id = v_hold.id;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_before, v_after, v_max_per_day
  FROM booking_practitioners
  WHERE id = v_hold.practitioner_id;

  IF v_hold.status = 'converted' THEN
    IF v_payment.paypal_capture_id IS NOT NULL AND v_payment.paypal_capture_id <> p_paypal_capture_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'capture_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id);
  END IF;
  IF v_hold.status NOT IN ('payment_capturing', 'payment_captured') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_not_convertible');
  END IF;
  IF v_hold.final_price_cents <> p_amount_cents OR v_hold.currency <> p_currency OR v_payment.paypal_env <> p_paypal_env THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_mismatch');
  END IF;
  IF v_payment.paypal_capture_id IS NOT NULL AND v_payment.paypal_capture_id <> p_paypal_capture_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'capture_mismatch');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;
  IF v_conflict THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT b.starts_at FROM bookings b
      WHERE b.practitioner_id = v_hold.practitioner_id AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
      UNION ALL
      SELECT h.starts_at FROM rdv_booking_holds h
      WHERE h.practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
        AND h.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
    END IF;
  END IF;

  UPDATE rdv_paypal_payments
  SET paypal_capture_id = p_paypal_capture_id, captured_at = p_captured_at, status = 'captured', last_error_code = NULL
  WHERE id = v_payment.id;
  UPDATE rdv_booking_holds SET status = 'payment_captured', expires_at = NULL WHERE id = v_hold.id;

  INSERT INTO bookings (
    practitioner_id, service_id, starts_at, ends_at, timezone,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message, status
  ) VALUES (
    v_hold.practitioner_id, v_hold.service_id, v_hold.starts_at, v_hold.ends_at, 'Europe/Paris',
    v_hold.customer_first_name, v_hold.customer_last_name, v_hold.customer_email, v_hold.customer_phone, v_hold.customer_message, 'confirmed'
  ) RETURNING id INTO v_booking_id;

  UPDATE rdv_booking_holds
  SET status = 'converted', converted_booking_id = v_booking_id, expires_at = NULL
  WHERE id = v_hold.id;
  RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_booking_id);
END;
$$;

-- Seuls les holds abandonnés sont libérés. Capturing/captured exigent une réconciliation explicite.
CREATE OR REPLACE FUNCTION public.expire_rdv_payment_holds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE rdv_booking_holds h
    SET status = 'expired'
    WHERE h.status = 'payment_pending'
      AND h.expires_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM rdv_paypal_payments p
        WHERE p.hold_id = h.id AND p.paypal_capture_id IS NOT NULL
      )
    RETURNING h.id
  ), payment_updates AS (
    UPDATE rdv_paypal_payments p
    SET status = 'expired', last_error_code = COALESCE(last_error_code, 'hold_expired')
    WHERE p.hold_id IN (SELECT id FROM expired)
    RETURNING p.id
  ) SELECT COUNT(*) INTO v_count FROM payment_updates;
  RETURN v_count;
END;
$$;

-- create_booking reste le chemin normal non-PayPal, mais doit respecter les holds actifs.
CREATE OR REPLACE FUNCTION public.create_booking(
  p_practitioner_id UUID, p_service_id UUID, p_starts_at TIMESTAMPTZ, p_ends_at TIMESTAMPTZ,
  p_customer_first_name TEXT, p_customer_last_name TEXT, p_customer_email TEXT,
  p_customer_phone TEXT DEFAULT NULL, p_customer_message TEXT DEFAULT NULL, p_timezone TEXT DEFAULT 'Europe/Paris'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_buffer_before INTEGER; v_buffer_after INTEGER; v_max_per_day INTEGER;
  v_conflict BOOLEAN; v_count_today INTEGER; v_booking_id UUID;
  v_before INTERVAL; v_after INTERVAL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));
  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_buffer_before, v_buffer_after, v_max_per_day
  FROM booking_practitioners WHERE id = p_practitioner_id;
  v_before := (COALESCE(v_buffer_before, 0) || ' minutes')::interval;
  v_after := (COALESCE(v_buffer_after, 0) || ' minutes')::interval;

  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = p_practitioner_id AND b.status = 'confirmed'
      AND (b.starts_at - v_before) < (p_ends_at + v_after)
      AND (b.ends_at + v_after) > (p_starts_at - v_before)
  ) OR EXISTS (
    SELECT 1 FROM rdv_booking_holds h
    WHERE h.practitioner_id = p_practitioner_id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - v_before) < (p_ends_at + v_after)
      AND (h.ends_at + v_after) > (p_starts_at - v_before)
  ) INTO v_conflict;
  IF v_conflict THEN
    RETURN json_build_object('conflict', true, 'error', 'Ce créneau est déjà réservé (booking ou paiement en cours).');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_today FROM (
      SELECT starts_at FROM bookings b
      WHERE b.practitioner_id = p_practitioner_id AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
      UNION ALL
      SELECT starts_at FROM rdv_booking_holds h
      WHERE h.practitioner_id = p_practitioner_id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
        AND h.starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' + INTERVAL '1 day'
    ) active_slots;
    IF v_count_today >= v_max_per_day THEN
      RETURN json_build_object('conflict', true, 'error', 'Nombre maximum de rendez-vous atteint pour ce jour.');
    END IF;
  END IF;

  INSERT INTO bookings (
    practitioner_id, service_id, starts_at, ends_at, timezone,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message, status
  ) VALUES (
    p_practitioner_id, p_service_id, p_starts_at, p_ends_at, p_timezone,
    p_customer_first_name, p_customer_last_name, p_customer_email, p_customer_phone, p_customer_message, 'confirmed'
  ) RETURNING id INTO v_booking_id;
  RETURN json_build_object('conflict', false, 'booking_id', v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_rdv_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_rdv_payment_capture(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_rdv_payment_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_rdv_payment_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rdv_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_rdv_payment_capture(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_rdv_payment_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_rdv_payment_holds() TO service_role;
