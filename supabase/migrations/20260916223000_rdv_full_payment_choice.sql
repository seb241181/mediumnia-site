-- MediumIA Rendez-vous — choix arrhes 20 € ou paiement intégral pour les rendez-vous visio.
-- Cette migration est additive et conserve le parcours d'arrhes existant.

ALTER TABLE public.rdv_paypal_payments
  ADD COLUMN IF NOT EXISTS payment_option TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_option IN ('deposit', 'full'));

-- Le montant enregistré dans bookings.reservation_payment_cents correspond au montant
-- réellement réglé au moment de la réservation : soit les arrhes, soit le prix total
-- pour un service vidéo payé intégralement.
CREATE OR REPLACE FUNCTION public.enforce_mediumia_booking_reservation_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.booking_services;
  v_is_video BOOLEAN;
BEGIN
  IF NEW.booking_source <> 'mediumia' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = NEW.service_id;
  IF FOUND
    AND v_service.booking_mode = 'instant'
    AND v_service.reservation_payment_kind = 'arrhes'
  THEN
    v_is_video := 'video' = ANY(v_service.modality);
    IF NEW.booked_price_cents IS DISTINCT FROM v_service.price_cents
      OR NOT (
        NEW.reservation_payment_cents = v_service.reservation_payment_cents
        OR (v_is_video AND NEW.reservation_payment_cents = v_service.price_cents)
      )
    THEN
      RAISE EXCEPTION 'reservation_payment_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_mediumia_booking_reservation_payment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_rdv_payment_hold(
  p_practitioner_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_selected_modality TEXT,
  p_customer_first_name TEXT,
  p_customer_last_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_message TEXT,
  p_client_checkout_id UUID,
  p_paypal_env TEXT,
  p_terms_version TEXT,
  p_early_performance_requested BOOLEAN,
  p_payment_option TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_hold public.rdv_booking_holds;
  v_existing_payment public.rdv_paypal_payments;
  v_service public.booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ := now() + INTERVAL '15 minutes';
  v_conflict BOOLEAN;
  v_payment_amount INTEGER;
BEGIN
  IF p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_paypal_env');
  END IF;
  IF p_selected_modality NOT IN ('video', 'in-person') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality');
  END IF;
  IF p_payment_option NOT IN ('deposit', 'full') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_option');
  END IF;
  IF p_payment_option = 'full' AND p_selected_modality <> 'video' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'full_payment_video_only');
  END IF;
  IF p_terms_version IS NULL OR length(trim(p_terms_version)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'terms_required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT h.*, p.* INTO v_existing_hold, v_existing_payment
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE OF h, p;

  IF FOUND THEN
    IF v_existing_payment.payment_option <> p_payment_option THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_option_mismatch');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'hold_id', v_existing_hold.id,
      'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at,
      'amount_cents', v_existing_payment.amount_cents,
      'service_price_cents', v_existing_hold.service_price_cents,
      'currency', v_existing_hold.currency,
      'payment_option', v_existing_payment.payment_option
    );
  END IF;

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;

  IF NOT FOUND
    OR v_service.booking_mode <> 'instant'
    OR v_service.reservation_payment_kind <> 'arrhes'
    OR v_service.reservation_payment_cents <= 0
    OR v_service.price_cents IS NULL
    OR v_service.reservation_payment_cents > v_service.price_cents
    OR v_service.currency <> 'EUR'
    OR NOT (p_selected_modality = ANY(v_service.modality))
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;

  IF p_payment_option = 'full' AND NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'full_payment_video_only');
  END IF;

  v_payment_amount := CASE
    WHEN p_payment_option = 'full' THEN v_service.price_cents
    ELSE v_service.reservation_payment_cents
  END;

  IF p_ends_at <> p_starts_at + make_interval(mins => v_service.duration_min) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_service_duration');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = p_practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = p_practitioner_id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT starts_at FROM public.bookings
      WHERE practitioner_id = p_practitioner_id
        AND status = 'confirmed'
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT starts_at FROM public.rdv_booking_holds
      WHERE practitioner_id = p_practitioner_id
        AND (status IN ('payment_capturing', 'payment_captured') OR (status = 'payment_pending' AND expires_at > now()))
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  INSERT INTO public.rdv_booking_holds (
    practitioner_id, service_id, starts_at, ends_at, selected_modality,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    service_price_cents, reservation_payment_cents, currency, status, expires_at,
    terms_version, terms_accepted_at, early_performance_requested_at
  ) VALUES (
    p_practitioner_id, p_service_id, p_starts_at, p_ends_at, p_selected_modality,
    trim(p_customer_first_name), trim(p_customer_last_name), lower(trim(p_customer_email)), nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_message), ''),
    v_service.price_cents, v_service.reservation_payment_cents, v_service.currency, 'payment_pending', v_expires_at,
    trim(p_terms_version), now(), CASE WHEN p_early_performance_requested THEN now() ELSE NULL END
  ) RETURNING id INTO v_hold_id;

  INSERT INTO public.rdv_paypal_payments (
    hold_id, paypal_env, amount_cents, currency, client_checkout_id, status, payment_option
  ) VALUES (
    v_hold_id, p_paypal_env, v_payment_amount, v_service.currency, p_client_checkout_id, 'order_pending', p_payment_option
  );

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'hold_id', v_hold_id,
    'status', 'payment_pending',
    'expires_at', v_expires_at,
    'amount_cents', v_payment_amount,
    'service_price_cents', v_service.price_cents,
    'currency', v_service.currency,
    'payment_option', p_payment_option
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_rdv_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rdv_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, TEXT) TO service_role;

-- Réutilise la barrière anti-course existante, mais écrit le montant réellement réglé
-- et distingue une vente intégrale d'une ligne d'arrhes.
CREATE OR REPLACE FUNCTION public.convert_rdv_deposit_hold(
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
  v_hold public.rdv_booking_holds;
  v_payment public.rdv_paypal_payments;
  v_service public.booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_conflict BOOLEAN;
  v_booking_id UUID;
  v_net INTEGER;
  v_vat INTEGER;
  v_entry_kind TEXT;
BEGIN
  SELECT h.* INTO v_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE hold_id = v_hold.id;

  IF v_hold.status = 'converted' THEN
    RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id);
  END IF;

  IF v_payment.paypal_env <> p_paypal_env
    OR v_payment.amount_cents <> p_amount_cents
    OR v_payment.currency <> p_currency
    OR v_hold.currency <> p_currency
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
  END IF;

  IF v_payment.paypal_capture_id IS NOT NULL
    AND v_payment.paypal_capture_id <> p_paypal_capture_id
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'capture_id_mismatch');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_hold.service_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_found');
  END IF;

  IF v_payment.payment_option = 'deposit' THEN
    IF p_amount_cents <> v_service.reservation_payment_cents THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
    END IF;
    v_entry_kind := 'arrhes';
  ELSIF v_payment.payment_option = 'full' THEN
    IF NOT ('video' = ANY(v_service.modality)) OR p_amount_cents <> v_service.price_cents THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
    END IF;
    v_entry_kind := 'full_payment';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_option');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = v_hold.practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF NOT v_conflict AND v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT b.starts_at
      FROM public.bookings b
      WHERE b.practitioner_id = v_hold.practitioner_id
        AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT h.starts_at
      FROM public.rdv_booking_holds h
      WHERE h.practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
        AND h.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;

    IF v_active_count >= v_max_per_day THEN
      v_conflict := true;
    END IF;
  END IF;

  IF v_conflict THEN
    UPDATE public.rdv_booking_holds
    SET status = 'payment_captured', expires_at = NULL
    WHERE id = v_hold.id;

    UPDATE public.rdv_paypal_payments
    SET status = 'captured',
        paypal_capture_id = COALESCE(paypal_capture_id, p_paypal_capture_id),
        captured_at = COALESCE(captured_at, p_captured_at, now()),
        last_error_code = 'paid_slot_reconciliation_required'
    WHERE id = v_payment.id;

    RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required', 'payment_captured', true);
  END IF;

  INSERT INTO public.bookings (
    practitioner_id, service_id,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    starts_at, ends_at, timezone, status,
    booked_price_cents, reservation_payment_cents, booking_source
  ) VALUES (
    v_hold.practitioner_id, v_hold.service_id,
    v_hold.customer_first_name, v_hold.customer_last_name, v_hold.customer_email, v_hold.customer_phone, v_hold.customer_message,
    v_hold.starts_at, v_hold.ends_at, 'Europe/Paris', 'confirmed',
    v_hold.service_price_cents, p_amount_cents, 'mediumia'
  ) RETURNING id INTO v_booking_id;

  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_service.vat_rate_bps))::INTEGER;
  v_vat := p_amount_cents - v_net;

  INSERT INTO public.rdv_financial_entries (
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email,
    external_payment_ref, note
  ) VALUES (
    v_hold.practitioner_id, v_booking_id, v_hold.service_id, 'mediumia', v_entry_kind, 'income', 'paypal',
    COALESCE(p_captured_at, now()), p_amount_cents, v_net, v_vat, v_service.vat_rate_bps, 'taxable', p_currency,
    v_hold.service_price_cents, v_hold.starts_at,
    trim(v_hold.customer_first_name || ' ' || v_hold.customer_last_name), v_hold.customer_email,
    p_paypal_capture_id,
    CASE WHEN v_entry_kind = 'full_payment' THEN 'Paiement intégral de réservation MediumIA' ELSE 'Arrhes de réservation MediumIA' END
  );

  UPDATE public.rdv_booking_holds
  SET status = 'converted', converted_booking_id = v_booking_id, expires_at = NULL
  WHERE id = v_hold.id;

  UPDATE public.rdv_paypal_payments
  SET status = 'captured', paypal_capture_id = p_paypal_capture_id,
      captured_at = COALESCE(p_captured_at, now()), last_error_code = NULL
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'converted', false,
    'booking_id', v_booking_id,
    'service_price_cents', v_hold.service_price_cents,
    'reservation_payment_cents', p_amount_cents,
    'payment_option', v_payment.payment_option
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_rdv_deposit_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_rdv_deposit_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) TO service_role;
