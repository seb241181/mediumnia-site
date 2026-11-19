-- Retour arrière de 20261108120000_rdv_offline_payments.sql, en une transaction.
-- Rétablit les trois fonctions de Production telles qu'au 08/11/2026 et retire
-- les fonctions de règlement hors PayPal. Les tables rdv_offline_payments et
-- rdv_offline_payment_events sont CONSERVÉES (historique) ; les écritures
-- comptables déjà confirmées restent valables et comptent dans le solde.
BEGIN;
-- Définition de Production du 08/11/2026, rétablie telle quelle.
CREATE OR REPLACE FUNCTION public.create_or_get_rdv_balance_payment(p_token_hash text, p_client_checkout_id uuid, p_paypal_env text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_payment public.rdv_balance_payments;
  v_paid INTEGER;
  v_due INTEGER;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_balance_token');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE balance_payment_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_token_not_found');
  END IF;

  IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_payable');
  END IF;

  IF v_booking.balance_cancel_claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;

  IF v_booking.balance_payment_token_expires_at IS NULL
     OR now() >= v_booking.balance_payment_token_expires_at
     OR now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_video_only');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);
  IF v_due <= 0 OR v_booking.balance_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'booking_id', v_booking.id,
      'amount_cents', 0,
      'currency', 'EUR'
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.rdv_balance_payments
  WHERE booking_id = v_booking.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment.paypal_env <> p_paypal_env OR v_payment.amount_cents <> v_due OR v_payment.currency <> 'EUR' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_intent_mismatch');
    END IF;
    IF v_payment.status = 'order_pending' AND v_payment.paypal_order_id IS NULL THEN
      UPDATE public.rdv_balance_payments SET updated_at = now() WHERE id = v_payment.id;
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'booking_id', v_booking.id,
      'payment_id', v_payment.id,
      'paypal_order_id', v_payment.paypal_order_id,
      'payment_status', v_payment.status,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'service_title', v_service.title,
      'starts_at', v_booking.starts_at,
      'customer_first_name', v_booking.customer_first_name
    );
  END IF;

  INSERT INTO public.rdv_balance_payments(
    booking_id, client_checkout_id, paypal_env, amount_cents, currency
  ) VALUES (
    v_booking.id, p_client_checkout_id, p_paypal_env, v_due, 'EUR'
  ) RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'paypal_order_id', NULL,
    'payment_status', v_payment.status,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'service_title', v_service.title,
    'starts_at', v_booking.starts_at,
    'customer_first_name', v_booking.customer_first_name
  );
END;
$function$;

-- Définition de Production du 08/11/2026, rétablie telle quelle.
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_capture(p_paypal_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment public.rdv_balance_payments;
  v_booking public.bookings;
  v_paid INTEGER;
  v_due INTEGER;
BEGIN
  SELECT * INTO v_payment
  FROM public.rdv_balance_payments
  WHERE paypal_order_id = p_paypal_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_not_found'); END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_captured', true,
      'booking_id', v_booking.id,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'paypal_capture_id', v_payment.paypal_capture_id
    );
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);

  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NOT NULL
     OR now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours')
     OR v_due <= 0
     OR v_due <> v_payment.amount_cents
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  END IF;

  IF v_payment.status = 'capture_in_progress'
     AND v_payment.capture_claimed_at IS NOT NULL
     AND v_payment.capture_claimed_at > now() - INTERVAL '10 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_capture_in_progress');
  END IF;

  UPDATE public.rdv_balance_payments
  SET status = 'capture_in_progress', capture_claimed_at = now(), updated_at = now(), last_error_code = NULL
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'paypal_env', v_payment.paypal_env
  );
END;
$function$;

-- ── 6. Annulation pour solde impayé : jamais pendant une annonce ──────────
-- Définition de Production du 08/11/2026, rétablie telle quelle.
CREATE OR REPLACE FUNCTION public.rdv_balance_cancel_blocker(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_settings public.rdv_balance_runtime_settings;
  v_payment public.rdv_balance_payments;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 'booking_not_found'; END IF;
  SELECT * INTO v_settings FROM public.rdv_balance_runtime_settings WHERE singleton = true;

  IF v_booking.balance_owner_decision = 'hold' THEN RETURN 'owner_hold'; END IF;
  IF v_booking.balance_late_payment_until IS NOT NULL AND p_now < v_booking.balance_late_payment_until THEN
    RETURN 'late_payment_window';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_balance_restorations r WHERE r.booking_id = v_booking.id AND r.status = 'google_pending') THEN
    RETURN 'restore_pending';
  END IF;

  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE booking_id = v_booking.id;
  IF v_payment.id IS NOT NULL AND v_payment.status IN ('captured', 'capture_in_progress') THEN RETURN 'payment_uncertain'; END IF;
  IF v_payment.id IS NOT NULL AND v_payment.status = 'order_pending' AND v_payment.updated_at > p_now - INTERVAL '30 minutes' THEN
    RETURN 'payment_in_progress';
  END IF;
  IF public.rdv_balance_external_payment_cents(v_booking.id) > 0 THEN RETURN 'external_payment_recorded'; END IF;

  IF v_booking.balance_owner_decision IS DISTINCT FROM 'cancel' THEN
    IF v_payment.id IS NOT NULL AND v_payment.status = 'order_pending' AND v_payment.paypal_order_id IS NOT NULL THEN
      RETURN 'payment_uncertain';
    END IF;
    IF COALESCE(v_settings.auto_cancel_mode, 'auto') = 'owner_review' THEN
      RETURN 'awaiting_owner_decision';
    END IF;
    IF COALESCE(v_settings.require_owner_alert, true) AND NOT EXISTS (
      SELECT 1 FROM public.rdv_balance_owner_alerts a
      WHERE a.booking_id = v_booking.id
        AND a.kind = 'pre_cancel'
        AND a.status = 'sent'
        AND a.sent_at <= p_now - make_interval(hours => COALESCE(v_settings.owner_alert_min_lead_hours, 6))
    ) THEN
      RETURN 'owner_not_alerted';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP FUNCTION IF EXISTS public.announce_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, DATE, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.withdraw_rdv_offline_payment(UUID, UUID, TEXT);
COMMIT;
