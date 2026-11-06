-- Copies des fonctions actuellement en Production (lues le 06/11/2026), pour
-- tester leur interaction avec la migration 20261106120000. Ne pas appliquer.

CREATE OR REPLACE FUNCTION public.create_rdv_deposit_hold(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_selected_modality text, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text, p_customer_message text, p_client_checkout_id uuid, p_paypal_env text, p_terms_version text, p_early_performance_requested boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
  IF p_paypal_env NOT IN ('sandbox', 'live') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_paypal_env'); END IF;
  IF p_selected_modality NOT IN ('video', 'in-person') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality'); END IF;
  IF p_terms_version IS NULL OR length(trim(p_terms_version)) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'terms_required'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));
  SELECT h.* INTO v_existing_hold FROM public.rdv_paypal_payments p JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.client_checkout_id = p_client_checkout_id FOR UPDATE OF h, p;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'existing', true, 'hold_id', v_existing_hold.id, 'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at, 'amount_cents', v_existing_hold.reservation_payment_cents,
      'service_price_cents', v_existing_hold.service_price_cents, 'currency', v_existing_hold.currency);
  END IF;
  SELECT * INTO v_service FROM public.booking_services WHERE id = p_service_id AND practitioner_id = p_practitioner_id AND is_active = true;
  IF NOT FOUND OR v_service.booking_mode <> 'instant' OR v_service.reservation_payment_kind <> 'arrhes' OR v_service.reservation_payment_cents <= 0
    OR v_service.price_cents IS NULL OR v_service.reservation_payment_cents > v_service.price_cents OR v_service.currency <> 'EUR'
    OR NOT (p_selected_modality = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;
  IF p_ends_at <> p_starts_at + make_interval(mins => v_service.duration_min) THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_service_duration'); END IF;
  SELECT buffer_before_min, buffer_after_min, max_per_day INTO v_before, v_after, v_max_per_day FROM public.booking_practitioners WHERE id = p_practitioner_id;
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.practitioner_id = p_practitioner_id AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h WHERE h.practitioner_id = p_practitioner_id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;
  IF v_conflict THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable'); END IF;
  INSERT INTO public.rdv_booking_holds (practitioner_id, service_id, starts_at, ends_at, selected_modality,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    service_price_cents, reservation_payment_cents, currency, status, expires_at, terms_version, terms_accepted_at, early_performance_requested_at)
  VALUES (p_practitioner_id, p_service_id, p_starts_at, p_ends_at, p_selected_modality,
    trim(p_customer_first_name), trim(p_customer_last_name), lower(trim(p_customer_email)), nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_message), ''),
    v_service.price_cents, v_service.reservation_payment_cents, v_service.currency, 'payment_pending', v_expires_at, trim(p_terms_version), now(),
    CASE WHEN p_early_performance_requested THEN now() ELSE NULL END) RETURNING id INTO v_hold_id;
  INSERT INTO public.rdv_paypal_payments (hold_id, paypal_env, amount_cents, currency, client_checkout_id, status)
  VALUES (v_hold_id, p_paypal_env, v_service.reservation_payment_cents, v_service.currency, p_client_checkout_id, 'order_pending');
  RETURN jsonb_build_object('ok', true, 'existing', false, 'hold_id', v_hold_id, 'status', 'payment_pending', 'expires_at', v_expires_at,
    'amount_cents', v_service.reservation_payment_cents, 'service_price_cents', v_service.price_cents, 'currency', v_service.currency);
END;
$function$;

-- Réclamation de capture (sans la partie max_per_day, inutile ici).
CREATE OR REPLACE FUNCTION public.claim_rdv_deposit_capture(p_paypal_order_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_hold public.rdv_booking_holds; v_payment public.rdv_paypal_payments; v_before INTEGER; v_after INTEGER; v_max_per_day INTEGER; v_conflict BOOLEAN;
BEGIN
  SELECT h.* INTO v_hold FROM public.rdv_paypal_payments p JOIN public.rdv_booking_holds h ON h.id = p.hold_id WHERE p.paypal_order_id = p_paypal_order_id FOR UPDATE OF h, p;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found'); END IF;
  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE hold_id = v_hold.id;
  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));
  IF v_hold.status = 'converted' THEN RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id); END IF;
  IF v_hold.status = 'payment_captured' THEN RETURN jsonb_build_object('ok', true, 'captured', true, 'hold_id', v_hold.id); END IF;
  IF v_hold.status = 'payment_capturing' AND v_hold.expires_at > now() THEN RETURN jsonb_build_object('ok', true, 'capturing', true, 'hold_id', v_hold.id); END IF;
  IF v_hold.status NOT IN ('payment_pending', 'payment_capturing') THEN RETURN jsonb_build_object('ok', false, 'error', 'hold_not_capturable'); END IF;
  SELECT buffer_before_min, buffer_after_min, max_per_day INTO v_before, v_after, v_max_per_day FROM public.booking_practitioners WHERE id = v_hold.practitioner_id;
  SELECT EXISTS ( SELECT 1 FROM public.bookings b WHERE b.practitioner_id = v_hold.practitioner_id AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) )
    OR EXISTS ( SELECT 1 FROM public.rdv_booking_holds h WHERE h.practitioner_id = v_hold.practitioner_id AND h.id <> v_hold.id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) ) INTO v_conflict;
  IF v_conflict THEN
    IF v_hold.status = 'payment_capturing' OR v_payment.paypal_capture_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required'); END IF;
    UPDATE public.rdv_booking_holds SET status = 'expired' WHERE id = v_hold.id;
    UPDATE public.rdv_paypal_payments SET status = 'expired', last_error_code = 'slot_unavailable' WHERE id = v_payment.id;
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;
  UPDATE public.rdv_booking_holds SET status = 'payment_capturing', expires_at = now() + INTERVAL '5 minutes' WHERE id = v_hold.id;
  UPDATE public.rdv_paypal_payments SET status = 'capturing' WHERE id = v_payment.id;
  RETURN jsonb_build_object('ok', true, 'hold_id', v_hold.id);
END; $function$;
