-- TEST UNIQUEMENT. Retour arrière de B2-20 / B2-30.
-- 1) Rétablit les 25 fonctions TEST telles que relues le 08/11/2026 avant alignement.
-- 2) Retire les objets ajoutés par B2-20 (structures vides, aucune donnée réelle).
-- Les migrations du dépôt rejouées en B2-10 sont additives ; leur retrait éventuel se fait
-- objet par objet (liste dans PLAN-B-E.md), jamais sur la Production.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     OR NOT EXISTS (SELECT 1 FROM public.booking_practitioners WHERE slug = 'seb-test') THEN
    RAISE EXCEPTION 'pas_la_base_test : script refusé';
  END IF;
END $$;
-- claim_rdv_balance_auto_cancel(uuid,timestamp with time zone) (version TEST)
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
  v_blocker TEXT;
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
  IF v_booking.balance_google_resync_claimed_at IS NOT NULL
     AND v_booking.balance_google_resync_claimed_at > p_now - INTERVAL '5 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'google_resync_in_progress');
  END IF;

  v_blocker := public.rdv_balance_cancel_blocker(v_booking.id, p_now);
  IF v_blocker IS NOT NULL THEN
    IF v_booking.balance_review_reason IS DISTINCT FROM v_blocker THEN
      UPDATE public.bookings
      SET balance_review_reason = v_blocker, balance_review_flagged_at = p_now, updated_at = now()
      WHERE id = v_booking.id;
      INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
      VALUES (v_booking.id, 'auto_cancel_blocked', jsonb_build_object('reason', v_blocker, 'at', p_now));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_blocked', 'reason', v_blocker);
  END IF;

  UPDATE public.bookings
  SET balance_cancel_claimed_at = p_now,
      balance_google_resync_at = COALESCE(balance_google_resync_at, p_now),
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_auto_cancel(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_auto_cancel(uuid,timestamp with time zone) TO service_role;
-- claim_rdv_balance_google_resync(uuid,timestamp with time zone) (version TEST)
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_google_resync(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.balance_google_resync_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_needed');
  END IF;
  IF v_booking.status <> 'confirmed' THEN
    UPDATE public.bookings
    SET balance_google_resync_at = NULL, balance_google_resync_claimed_at = NULL,
        balance_google_resync_review_at = NULL, updated_at = now()
    WHERE id = v_booking.id;
    RETURN jsonb_build_object('ok', false, 'error', 'not_needed');
  END IF;
  IF v_booking.starts_at <= p_now THEN
    UPDATE public.bookings
    SET balance_google_resync_review_at = COALESCE(balance_google_resync_review_at, p_now),
        balance_google_resync_error = 'appointment_started',
        balance_google_resync_claimed_at = NULL,
        updated_at = now()
    WHERE id = v_booking.id;
    IF v_booking.balance_google_resync_review_at IS NULL THEN
      INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
      VALUES (v_booking.id, 'google_resync_overdue', jsonb_build_object('since', v_booking.balance_google_resync_at, 'starts_at', v_booking.starts_at));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_started',
                              'first', v_booking.balance_google_resync_review_at IS NULL);
  END IF;
  IF v_booking.balance_google_resync_review_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_review');
  END IF;
  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     AND v_booking.balance_cancel_claimed_at > p_now - INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_in_progress');
  END IF;
  IF v_booking.balance_google_resync_claimed_at IS NOT NULL
     AND v_booking.balance_google_resync_claimed_at > p_now - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'resync_in_progress');
  END IF;
  UPDATE public.bookings
  SET balance_google_resync_claimed_at = p_now, updated_at = now()
  WHERE id = v_booking.id;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id,
                            'google_event_id', v_booking.google_event_id,
                            'since', v_booking.balance_google_resync_at,
                            'starts_at', v_booking.starts_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_google_resync(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_google_resync(uuid,timestamp with time zone) TO service_role;
-- claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone) (version TEST)
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_reminder(p_booking_id uuid, p_token_hash text, p_token_expires_at timestamp with time zone, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.bookings;
BEGIN
 IF p_now IS NULL OR p_token_hash IS NULL OR length(p_token_hash)<>64 OR p_token_expires_at IS NULL OR p_token_expires_at<=p_now THEN RETURN false; END IF;
 -- Même verrou de réservation que la finalisation des paiements.
 SELECT * INTO b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.balance_reminder_claimed_at IS NOT NULL
    OR p_token_expires_at > b.starts_at-interval '48 hours'
    OR public.rdv_balance_reminder_due(b.id,p_now) IS NULL THEN RETURN false; END IF;
 UPDATE public.bookings SET balance_payment_token_hash=p_token_hash,balance_payment_token_expires_at=p_token_expires_at,balance_reminder_claimed_at=p_now,updated_at=now() WHERE id=b.id;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone) TO service_role;
-- claim_rdv_deposit_capture(text) (version TEST)
CREATE OR REPLACE FUNCTION public.claim_rdv_deposit_capture(p_paypal_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hold public.rdv_booking_holds;
  v_payment public.rdv_paypal_payments;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_conflict BOOLEAN;
  v_active_count INTEGER;
BEGIN
  SELECT h.* INTO v_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  SELECT * INTO v_payment
  FROM public.rdv_paypal_payments
  WHERE hold_id = v_hold.id;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

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

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = v_hold.practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    IF v_hold.status = 'payment_capturing' OR v_payment.paypal_capture_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
    END IF;
    UPDATE public.rdv_booking_holds
      SET status = 'expired'
      WHERE id = v_hold.id;
    UPDATE public.rdv_paypal_payments
      SET status = 'expired', last_error_code = 'slot_unavailable'
      WHERE id = v_payment.id;
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count
    FROM (
      SELECT starts_at FROM public.bookings
      WHERE practitioner_id = v_hold.practitioner_id
        AND status = 'confirmed'
        AND starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT starts_at FROM public.rdv_booking_holds h
      WHERE practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (
          status IN ('payment_capturing', 'payment_captured')
          OR (status = 'payment_pending' AND expires_at > now())
        )
        AND starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;

    IF v_active_count >= v_max_per_day THEN
      IF v_hold.status = 'payment_capturing' OR v_payment.paypal_capture_id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
      END IF;
      UPDATE public.rdv_booking_holds
        SET status = 'expired'
        WHERE id = v_hold.id;
      UPDATE public.rdv_paypal_payments
        SET status = 'expired', last_error_code = 'daily_limit_reached'
        WHERE id = v_payment.id;
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  UPDATE public.rdv_booking_holds
  SET status = 'payment_capturing', expires_at = now() + INTERVAL '5 minutes'
  WHERE id = v_hold.id;

  UPDATE public.rdv_paypal_payments
  SET status = 'capturing'
  WHERE id = v_payment.id;

  RETURN jsonb_build_object('ok', true, 'hold_id', v_hold.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_deposit_capture(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_deposit_capture(text) TO service_role;
-- complete_rdv_balance_google_resync(uuid,text,text) (version TEST)
CREATE OR REPLACE FUNCTION public.complete_rdv_balance_google_resync(p_booking_id uuid, p_google_status text, p_google_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.balance_google_resync_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'replay', true); END IF;
  IF v_booking.balance_cancel_claimed_at IS NOT NULL OR v_booking.status <> 'confirmed' THEN
    UPDATE public.bookings SET balance_google_resync_claimed_at = NULL, updated_at = now() WHERE id = v_booking.id;
    RETURN jsonb_build_object('ok', false, 'error', 'superseded');
  END IF;
  UPDATE public.bookings
  SET balance_google_resync_at = NULL,
      balance_google_resync_claimed_at = NULL,
      balance_google_resync_error = NULL,
      balance_google_resync_review_at = NULL,
      google_event_id = COALESCE(p_google_event_id, google_event_id),
      updated_at = now()
  WHERE id = v_booking.id;
  INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
  VALUES (v_booking.id, 'google_resynced', jsonb_build_object('google_status', left(p_google_status, 40), 'since', v_booking.balance_google_resync_at));
  RETURN jsonb_build_object('ok', true, 'replay', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_rdv_balance_google_resync(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rdv_balance_google_resync(uuid,text,text) TO service_role;
-- consume_api_rate_limit(text,text,integer,integer) (version TEST)
-- Les valeurs par défaut des paramètres diffèrent : suppression préalable nécessaire (aucun objet ne dépend de cette fonction).
DROP FUNCTION IF EXISTS public.consume_api_rate_limit(text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_ip_hash text, p_endpoint text, p_hourly_limit integer, p_daily_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_hour_count integer;
  v_day_count integer;
begin
  insert into public.api_rate_limits(ip_hash, endpoint, window_type, window_start, request_count)
  values (p_ip_hash, p_endpoint, 'hour', v_hour, 1)
  on conflict (ip_hash, endpoint, window_type, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_hour_count;

  insert into public.api_rate_limits(ip_hash, endpoint, window_type, window_start, request_count)
  values (p_ip_hash, p_endpoint, 'day', v_day, 1)
  on conflict (ip_hash, endpoint, window_type, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1, updated_at = now()
  returning request_count into v_day_count;

  return jsonb_build_object('allowed', v_hour_count <= p_hourly_limit and v_day_count <= p_daily_limit,
                            'hour_count', v_hour_count,
                            'day_count', v_day_count);
end;
$function$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) TO service_role;
-- consume_oauth_state(text) (version TEST)
CREATE OR REPLACE FUNCTION public.consume_oauth_state(p_state text)
 RETURNS TABLE(practitioner_slug text, practitioner_id uuid, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  DELETE FROM oauth_states
  WHERE state = p_state AND expires_at > now()
  RETURNING
    oauth_states.practitioner_slug,
    oauth_states.practitioner_id,
    oauth_states.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_oauth_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state(text) TO service_role;
-- convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text) (version TEST)
CREATE OR REPLACE FUNCTION public.convert_rdv_deposit_hold(p_paypal_order_id text, p_paypal_capture_id text, p_captured_at timestamp with time zone, p_paypal_env text, p_amount_cents integer, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found'); END IF;

  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE hold_id = v_hold.id;
  IF v_hold.status = 'converted' THEN RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id); END IF;

  IF v_payment.paypal_env <> p_paypal_env
    OR v_payment.amount_cents <> p_amount_cents
    OR v_payment.currency <> p_currency
    OR v_hold.currency <> p_currency
  THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch'); END IF;

  IF v_payment.paypal_capture_id IS NOT NULL AND v_payment.paypal_capture_id <> p_paypal_capture_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'capture_id_mismatch');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));
  SELECT * INTO v_service FROM public.booking_services WHERE id = v_hold.service_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'service_not_found'); END IF;

  IF v_payment.payment_option = 'deposit' THEN
    IF p_amount_cents <> v_service.reservation_payment_cents THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch'); END IF;
    v_entry_kind := 'arrhes';
  ELSIF v_payment.payment_option = 'full' THEN
    IF p_amount_cents <> v_service.price_cents THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch'); END IF;
    v_entry_kind := 'full_payment';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_option');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners WHERE id = v_hold.practitioner_id;

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
      SELECT b.starts_at FROM public.bookings b
      WHERE b.practitioner_id = v_hold.practitioner_id
        AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT h.starts_at FROM public.rdv_booking_holds h
      WHERE h.practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
        AND h.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN v_conflict := true; END IF;
  END IF;

  IF v_conflict THEN
    UPDATE public.rdv_booking_holds SET status = 'payment_captured', expires_at = NULL WHERE id = v_hold.id;
    UPDATE public.rdv_paypal_payments
    SET status = 'captured', paypal_capture_id = COALESCE(paypal_capture_id, p_paypal_capture_id),
        captured_at = COALESCE(captured_at, p_captured_at, now()), last_error_code = 'paid_slot_reconciliation_required'
    WHERE id = v_payment.id;
    RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required', 'payment_captured', true);
  END IF;

  INSERT INTO public.bookings (
    practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    starts_at, ends_at, timezone, status, booked_price_cents, reservation_payment_cents, booking_source
  ) VALUES (
    v_hold.practitioner_id, v_hold.service_id, v_hold.customer_first_name, v_hold.customer_last_name, v_hold.customer_email,
    v_hold.customer_phone, v_hold.customer_message, v_hold.starts_at, v_hold.ends_at, 'Europe/Paris', 'confirmed',
    v_hold.service_price_cents, p_amount_cents, 'mediumia'
  ) RETURNING id INTO v_booking_id;

  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_service.vat_rate_bps))::INTEGER;
  v_vat := p_amount_cents - v_net;

  INSERT INTO public.rdv_financial_entries (
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email, external_payment_ref, note
  ) VALUES (
    v_hold.practitioner_id, v_booking_id, v_hold.service_id, 'mediumia', v_entry_kind, 'income', 'paypal',
    COALESCE(p_captured_at, now()), p_amount_cents, v_net, v_vat, v_service.vat_rate_bps, 'taxable', p_currency,
    v_hold.service_price_cents, v_hold.starts_at, trim(v_hold.customer_first_name || ' ' || v_hold.customer_last_name),
    v_hold.customer_email, p_paypal_capture_id,
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
$function$;
REVOKE ALL ON FUNCTION public.convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text) TO service_role;
-- create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) (version TEST)
CREATE OR REPLACE FUNCTION public.create_booking(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text DEFAULT NULL::text, p_customer_message text DEFAULT NULL::text, p_timezone text DEFAULT 'Europe/Paris'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) TO service_role;
-- create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) (version TEST)
CREATE OR REPLACE FUNCTION public.create_rdv_deposit_hold(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_selected_modality text, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text, p_customer_message text, p_client_checkout_id uuid, p_paypal_env text, p_terms_version text, p_early_performance_requested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_hold public.rdv_booking_holds;
  v_service public.booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ := now() + INTERVAL '15 minutes';
  v_conflict BOOLEAN;
BEGIN
  IF p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_paypal_env');
  END IF;
  IF p_selected_modality NOT IN ('video', 'in-person') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality');
  END IF;
  IF p_terms_version IS NULL OR length(trim(p_terms_version)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'terms_required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT h.* INTO v_existing_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE OF h, p;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'hold_id', v_existing_hold.id,
      'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at,
      'amount_cents', v_existing_hold.reservation_payment_cents,
      'service_price_cents', v_existing_hold.service_price_cents,
      'currency', v_existing_hold.currency
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
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = p_practitioner_id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count
    FROM (
      SELECT starts_at FROM public.bookings
      WHERE practitioner_id = p_practitioner_id
        AND status = 'confirmed'
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT starts_at FROM public.rdv_booking_holds
      WHERE practitioner_id = p_practitioner_id
        AND (
          status IN ('payment_capturing', 'payment_captured')
          OR (status = 'payment_pending' AND expires_at > now())
        )
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
    trim(p_customer_first_name), trim(p_customer_last_name), lower(trim(p_customer_email)),
    nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_message), ''),
    v_service.price_cents, v_service.reservation_payment_cents, v_service.currency,
    'payment_pending', v_expires_at,
    trim(p_terms_version), now(),
    CASE WHEN p_early_performance_requested THEN now() ELSE NULL END
  ) RETURNING id INTO v_hold_id;

  INSERT INTO public.rdv_paypal_payments (
    hold_id, paypal_env, amount_cents, currency, client_checkout_id, status
  ) VALUES (
    v_hold_id, p_paypal_env, v_service.reservation_payment_cents,
    v_service.currency, p_client_checkout_id, 'order_pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'hold_id', v_hold_id,
    'status', 'payment_pending',
    'expires_at', v_expires_at,
    'amount_cents', v_service.reservation_payment_cents,
    'service_price_cents', v_service.price_cents,
    'currency', v_service.currency
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) TO service_role;
-- create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) (version TEST)
CREATE OR REPLACE FUNCTION public.create_rdv_full_payment_hold(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_selected_modality text, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text, p_customer_message text, p_client_checkout_id uuid, p_paypal_env text, p_terms_version text, p_early_performance_requested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_service public.booking_services;
  v_hold_id UUID;
  v_existing_hold public.rdv_booking_holds;
  v_existing_payment public.rdv_paypal_payments;
BEGIN
  IF p_selected_modality NOT IN ('video', 'in-person') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality');
  END IF;

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;

  IF NOT FOUND
    OR v_service.booking_mode <> 'instant'
    OR v_service.reservation_payment_kind <> 'arrhes'
    OR v_service.price_cents IS NULL
    OR v_service.price_cents <= 0
    OR v_service.currency <> 'EUR'
    OR NOT (p_selected_modality = ANY(v_service.modality))
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT p.* INTO v_existing_payment
  FROM public.rdv_paypal_payments p
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO v_existing_hold
    FROM public.rdv_booking_holds
    WHERE id = v_existing_payment.hold_id
    FOR UPDATE;

    IF v_existing_hold.id IS NULL
      OR v_existing_hold.practitioner_id <> p_practitioner_id
      OR v_existing_hold.service_id <> p_service_id
      OR v_existing_hold.starts_at <> p_starts_at
      OR v_existing_hold.ends_at <> p_ends_at
      OR v_existing_hold.selected_modality <> p_selected_modality
      OR v_existing_payment.payment_option <> 'full'
      OR v_existing_hold.payment_choice <> 'full_payment'
      OR v_existing_payment.amount_cents <> v_service.price_cents
      OR v_existing_hold.reservation_payment_cents <> v_service.price_cents
      OR v_existing_hold.service_price_cents <> v_service.price_cents
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_choice_locked');
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
      'payment_choice', 'full_payment',
      'payment_option', 'full'
    );
  END IF;

  v_result := public.create_rdv_deposit_hold(
    p_practitioner_id,
    p_service_id,
    p_starts_at,
    p_ends_at,
    p_selected_modality,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_email,
    p_customer_phone,
    p_customer_message,
    p_client_checkout_id,
    p_paypal_env,
    p_terms_version,
    p_early_performance_requested
  );

  IF NOT COALESCE((v_result->>'ok')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_hold_id := NULLIF(v_result->>'hold_id', '')::UUID;
  IF v_hold_id IS NULL THEN
    RETURN v_result;
  END IF;

  UPDATE public.rdv_booking_holds
  SET reservation_payment_cents = v_service.price_cents,
      payment_choice = 'full_payment'
  WHERE id = v_hold_id;

  UPDATE public.rdv_paypal_payments
  SET amount_cents = v_service.price_cents,
      payment_option = 'full'
  WHERE hold_id = v_hold_id
    AND paypal_order_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_choice_locked');
  END IF;

  RETURN v_result || jsonb_build_object(
    'amount_cents', v_service.price_cents,
    'service_price_cents', v_service.price_cents,
    'payment_choice', 'full_payment',
    'payment_option', 'full'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) TO service_role;
-- draw_conference_raffle(uuid) (version TEST)
CREATE OR REPLACE FUNCTION public.draw_conference_raffle(p_raffle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_raffle public.conference_raffles%rowtype;
  v_winner uuid;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;
  if v_raffle.winner_registration_id is not null then return jsonb_build_object('ok', true, 'alreadyDrawn', true, 'winnerRegistrationId', v_raffle.winner_registration_id); end if;
  if v_raffle.closes_at is not null and now() < v_raffle.closes_at and v_raffle.status <> 'closed' then return jsonb_build_object('ok', false, 'reason', 'raffle_not_closed'); end if;
  select e.registration_id into v_winner
  from public.conference_raffle_entries e
  join public.conference_registrations r on r.id = e.registration_id
  where e.raffle_id = p_raffle_id and r.event_id = v_raffle.event_id and r.attended_at is not null and r.status <> 'cancelled'
  order by gen_random_uuid() limit 1;
  if v_winner is null then return jsonb_build_object('ok', false, 'reason', 'no_eligible_entries'); end if;
  update public.conference_raffles set winner_registration_id = v_winner, drawn_at = now(), status = 'drawn', updated_at = now() where id = p_raffle_id;
  return jsonb_build_object('ok', true, 'winnerRegistrationId', v_winner);
end;
$function$;
REVOKE ALL ON FUNCTION public.draw_conference_raffle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_conference_raffle(uuid) TO service_role;
-- enter_conference_raffle(uuid,uuid) (version TEST)
CREATE OR REPLACE FUNCTION public.enter_conference_raffle(p_raffle_id uuid, p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_raffle public.conference_raffles%rowtype;
  v_registration public.conference_registrations%rowtype;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;
  if v_raffle.status not in ('scheduled','open') then return jsonb_build_object('ok', false, 'reason', 'raffle_not_open'); end if;
  if v_raffle.opens_at is not null and now() < v_raffle.opens_at then return jsonb_build_object('ok', false, 'reason', 'raffle_not_open'); end if;
  if v_raffle.closes_at is not null and now() > v_raffle.closes_at then return jsonb_build_object('ok', false, 'reason', 'raffle_closed'); end if;
  select * into v_registration from public.conference_registrations where id = p_registration_id;
  if not found or v_registration.event_id <> v_raffle.event_id then return jsonb_build_object('ok', false, 'reason', 'registration_invalid'); end if;
  if v_registration.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'registration_cancelled'); end if;
  if v_registration.attended_at is null then return jsonb_build_object('ok', false, 'reason', 'attendance_required'); end if;
  if v_registration.live_last_seen_at is null or v_registration.live_last_seen_at < now() - interval '10 minutes' then return jsonb_build_object('ok', false, 'reason', 'live_presence_required'); end if;
  insert into public.conference_raffle_entries (raffle_id, registration_id) values (p_raffle_id, p_registration_id) on conflict (raffle_id, registration_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$function$;
REVOKE ALL ON FUNCTION public.enter_conference_raffle(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enter_conference_raffle(uuid,uuid) TO service_role;
-- mediumia_find_user_id_by_email(text) (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_find_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id
  from auth.users as u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at asc
  limit 1;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_find_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_find_user_id_by_email(text) TO service_role;
-- mediumia_grant_purchase_atomic(uuid,text,integer) (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_grant_purchase_atomic(p_user_id uuid, p_origin_ref text, p_duration_days integer DEFAULT 365)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.mediumia_entitlements%rowtype;
  v_created public.mediumia_entitlements%rowtype;
  v_start timestamptz;
begin
  if p_user_id is null or p_origin_ref is null or length(trim(p_origin_ref)) < 8 then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  if p_duration_days < 1 or p_duration_days > 3650 then
    return jsonb_build_object('status', 'invalid_duration');
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  select * into v_existing
  from public.mediumia_entitlements
  where type = 'purchase' and origin_ref = trim(p_origin_ref)
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at
    );
  end if;

  insert into public.mediumia_students (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select greatest(
    now(),
    coalesce(max(access_expires_at), now())
  ) into v_start
  from public.mediumia_entitlements
  where user_id = p_user_id
    and status = 'active'
    and access_level = 'full'
    and access_expires_at > now();

  begin
    insert into public.mediumia_entitlements (
      user_id, type, origin_ref,
      access_started_at, access_expires_at, status
    ) values (
      p_user_id,
      'purchase',
      trim(p_origin_ref),
      v_start,
      v_start + (p_duration_days || ' days')::interval,
      'active'
    )
    returning * into v_created;
  exception when unique_violation then
    select * into v_existing
    from public.mediumia_entitlements
    where type = 'purchase' and origin_ref = trim(p_origin_ref)
    limit 1;

    return jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at
    );
  end;

  return jsonb_build_object(
    'status', 'granted',
    'entitlement_id', v_created.id,
    'access_expires_at', v_created.access_expires_at
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_grant_purchase_atomic(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_grant_purchase_atomic(uuid,text,integer) TO service_role;
-- mediumia_mark_pdf_download(text) (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_mark_pdf_download(p_token_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 UPDATE public.mediumia_paypal_purchases SET pdf_downloaded_at=now(),pdf_download_count=pdf_download_count+1,updated_at=now()
 WHERE pdf_download_token_hash=p_token_hash AND status='provisioned' AND pdf_download_expires_at>now();
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_mark_pdf_download(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO service_role;
-- mediumia_next_license_number() (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_next_license_number()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
 SELECT 'MID-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.mediumia_license_seq')::text,6,'0');
$function$;
REVOKE ALL ON FUNCTION public.mediumia_next_license_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_next_license_number() TO service_role;
-- mediumia_paypal_purchase_set_updated_at() (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_paypal_purchase_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() TO service_role;
-- mediumia_pdf_token_is_valid(text) (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_pdf_token_is_valid(p_token_hash text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT exists(SELECT 1 FROM public.mediumia_paypal_purchases p
 WHERE p.pdf_download_token_hash=p_token_hash
 AND p.status='provisioned' AND p.user_id IS NOT NULL AND p.pdf_download_expires_at>now());
$function$;
REVOKE ALL ON FUNCTION public.mediumia_pdf_token_is_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO service_role;
-- mediumia_resolve_pdf_download(text) (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_resolve_pdf_download(p_token_hash text)
 RETURNS TABLE(purchase_id uuid, user_id uuid, display_name text, license_number text, expires_at timestamp with time zone, download_count integer, product_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT p.id,p.user_id,coalesce(nullif(s.display_name,''),nullif(p.payer_name,'')),
 s.license_number,p.pdf_download_expires_at,p.pdf_download_count,p.product_code
 FROM public.mediumia_paypal_purchases p
 JOIN public.mediumia_students s ON s.user_id=p.user_id
 WHERE p.pdf_download_token_hash=p_token_hash AND p.status='provisioned'
 AND p.pdf_download_expires_at>now() LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_resolve_pdf_download(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO service_role;
-- mediumia_set_updated_at() (version TEST)
CREATE OR REPLACE FUNCTION public.mediumia_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO service_role;
-- rdv_amount_breakdown(integer,integer) (version TEST)
CREATE OR REPLACE FUNCTION public.rdv_amount_breakdown(p_gross_cents integer, p_vat_rate_bps integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
  v_net INTEGER;
  v_vat INTEGER;
BEGIN
  IF p_gross_cents <= 0 OR p_vat_rate_bps < 0 OR p_vat_rate_bps > 10000 THEN
    RAISE EXCEPTION 'invalid_amount_breakdown';
  END IF;
  v_net := ROUND((p_gross_cents::NUMERIC * 10000) / (10000 + p_vat_rate_bps))::INTEGER;
  v_vat := p_gross_cents - v_net;
  RETURN jsonb_build_object(
    'gross_cents', p_gross_cents,
    'net_cents', v_net,
    'vat_cents', v_vat,
    'vat_rate_bps', p_vat_rate_bps
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rdv_amount_breakdown(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO service_role;
-- set_updated_at() (version TEST)
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
-- supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid) (version TEST)
CREATE OR REPLACE FUNCTION public.supersede_rdv_own_pending_holds(p_practitioner_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_customer_email text, p_client_checkout_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_before integer;
  v_after integer;
  v_ids uuid[];
begin
  if p_customer_email is null or length(trim(p_customer_email)) < 3 then return 0; end if;
  perform pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  select buffer_before_min, buffer_after_min into v_before, v_after
    from public.booking_practitioners where id = p_practitioner_id;

  with mine as (
    select h.id
      from public.rdv_booking_holds h
      join public.rdv_paypal_payments p on p.hold_id = h.id
     where h.practitioner_id = p_practitioner_id
       and h.status = 'payment_pending'
       and lower(trim(h.customer_email)) = lower(trim(p_customer_email))
       and p.client_checkout_id is distinct from p_client_checkout_id
       and p.paypal_capture_id is null
       and p.status = 'order_pending'
       and (h.starts_at - (coalesce(v_before, 0) || ' minutes')::interval) < (p_ends_at + (coalesce(v_after, 0) || ' minutes')::interval)
       and (h.ends_at + (coalesce(v_after, 0) || ' minutes')::interval) > (p_starts_at - (coalesce(v_before, 0) || ' minutes')::interval)
     for update of h, p
  ), expired_holds as (
    update public.rdv_booking_holds h
       set status = 'expired', updated_at = now()
      from mine
     where h.id = mine.id
    returning h.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from expired_holds;

  update public.rdv_paypal_payments
     set status = 'expired', last_error_code = 'superseded_by_retry', updated_at = now()
   where hold_id = any(v_ids);

  return coalesce(array_length(v_ids, 1), 0);
end;
$function$;
REVOKE ALL ON FUNCTION public.supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid) TO service_role;
-- sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) (version TEST)
CREATE OR REPLACE FUNCTION public.sync_student_state(p_expected_revision bigint, p_progression jsonb DEFAULT '{}'::jsonb, p_exercices jsonb DEFAULT '{}'::jsonb, p_journal jsonb DEFAULT '[]'::jsonb, p_chat jsonb DEFAULT '[]'::jsonb, p_prefs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current  public.mediumia_student_state%ROWTYPE;
  v_new_rev  bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mediumia_students WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'student_not_found';
  END IF;

  SELECT * INTO v_current
  FROM public.mediumia_student_state
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.mediumia_student_state
      (user_id, schema_version, progression, exercices, journal, chat, prefs, revision)
    VALUES
      (auth.uid(), 1, p_progression, p_exercices, p_journal, p_chat, p_prefs, 1);

    RETURN jsonb_build_object('status', 'created', 'revision', 1);
  END IF;

  IF v_current.revision != p_expected_revision THEN
    RETURN jsonb_build_object(
      'status',   'conflict',
      'revision', v_current.revision,
      'cloud',    jsonb_build_object(
        'progression', v_current.progression,
        'exercices',   v_current.exercices,
        'journal',     v_current.journal,
        'chat',        v_current.chat,
        'prefs',       v_current.prefs,
        'updated_at',  v_current.updated_at
      )
    );
  END IF;

  v_new_rev := v_current.revision + 1;

  UPDATE public.mediumia_student_state
  SET progression = p_progression,
      exercices   = p_exercices,
      journal     = p_journal,
      chat        = p_chat,
      prefs       = p_prefs,
      revision    = v_new_rev
  WHERE user_id = auth.uid();

  RETURN jsonb_build_object('status', 'ok', 'revision', v_new_rev);
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.mediumia_handle_new_user();
DROP FUNCTION IF EXISTS public.mediumia_available_upgrade_credit(uuid);
DROP FUNCTION IF EXISTS public.mediumia_claim_access_code(text);
DROP FUNCTION IF EXISTS public.mediumia_claim_code_atomic(uuid, text, text);
DROP FUNCTION IF EXISTS public.mediumia_grant_founder(text);
DROP FUNCTION IF EXISTS public.mediumia_grant_purchase_access_atomic(uuid, text, integer, text, integer);
DROP FUNCTION IF EXISTS public.mediumia_parcours_opening_transition(timestamp with time zone, boolean);
DROP FUNCTION IF EXISTS public.oracle_consume_follow_return(uuid, text);
DROP TABLE IF EXISTS public.mediumia_access_codes_v2;
DROP TABLE IF EXISTS public.mediumia_valid_codes;
DROP TABLE IF EXISTS public.oracle_timeline_follow_plans;
-- Compartiment conference-preparation : conservé s'il contient des fichiers ; sinon :
DELETE FROM storage.buckets WHERE id = 'conference-preparation' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'conference-preparation');
COMMIT;
