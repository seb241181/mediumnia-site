-- SNAPSHOT of MediumIA Supabase PROD definitions, 2026-10-12
-- Project: uotkpygeqqnekpolezts
-- Before migration 20261011160000_rdv_balance_owner_review_restore.sql
-- Restore only after reverting application code; carefully review dependent objects.
-- No customer records or secret values.

-- FUNCTION claim_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone)
-- MD5(pg_get_functiondef) fdf863fb853ce1926011e3a07cbf5e0e
-- OWNER postgres
-- ACL {postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
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
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_video_only');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.booking_source <> 'mediumia'
     OR v_booking.starts_at <= p_now
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_due_for_balance_cancel');
  END IF;

  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE;
  IF FOUND AND v_payment.status IN ('captured', 'capture_in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_in_progress');
  END IF;

  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     AND v_booking.balance_cancel_claimed_at > p_now - INTERVAL '15 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;

  UPDATE public.bookings
  SET balance_cancel_claimed_at = p_now, updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$


-- FUNCTION claim_rdv_balance_capture(p_paypal_order_id text)
-- MD5(pg_get_functiondef) 5659f5e2c863bb44422bf36eca02b3d0
-- OWNER postgres
-- ACL {postgres=X/postgres,service_role=X/postgres}
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
     OR now() >= v_booking.starts_at - INTERVAL '48 hours'
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
$function$


-- FUNCTION create_or_get_rdv_balance_payment(p_token_hash text, p_client_checkout_id uuid, p_paypal_env text)
-- MD5(pg_get_functiondef) b0af5fdfd1c111d6c00032ea68458bf1
-- OWNER postgres
-- ACL {postgres=X/postgres,service_role=X/postgres}
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

  IF v_booking.balance_payment_token_expires_at IS NULL
     OR now() >= v_booking.balance_payment_token_expires_at
     OR now() >= v_booking.starts_at - INTERVAL '48 hours' THEN
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
$function$


-- FUNCTION finalize_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone)
-- MD5(pg_get_functiondef) 4e9d38bd5cc099832eaf448daeda6d4c
-- OWNER postgres
-- ACL {postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_paid INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NULL
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_no_longer_due_for_balance_cancel');
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled', cancelled_at = p_now,
      cancel_reason = 'balance_unpaid_48h',
      balance_auto_cancelled_at = p_now,
      balance_cancel_claimed_at = NULL,
      balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$
