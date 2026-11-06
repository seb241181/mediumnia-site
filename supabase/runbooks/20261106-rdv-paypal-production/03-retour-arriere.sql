-- 03 — Retour arrière (une seule transaction). Copies exactes des définitions Production
-- relevées le 06/11/2026 (empreintes 123f4c27… et aa738e5c…).
-- Ordre INVERSE de 01 : on referme d'abord le paiement intégral en présentiel, puis on
-- restaure la protection — jamais de moment où l'on capture sans pouvoir convertir.
-- Les objets de fiabilité (20261106120000) sont de purs ajouts : ils restent en place, la
-- version précédente du site ne les utilise pas.
-- AVANT d'exécuter : vérifier qu'aucun paiement intégral en présentiel n'est en cours
--   select count(*) from rdv_paypal_payments p join rdv_booking_holds h on h.id = p.hold_id
--    where p.payment_option = 'full' and h.selected_modality = 'in-person'
--      and p.status in ('order_pending', 'capturing');   -- attendu : 0
-- sinon, il pourrait être encaissé puis refusé par la protection restaurée.

-- 1/2 · Paiement intégral : retour à la visio seule
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
  IF p_selected_modality <> 'video' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'full_payment_video_only');
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
    OR NOT ('video' = ANY(v_service.modality))
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
      OR v_existing_hold.selected_modality <> 'video'
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
revoke execute on function public.create_rdv_full_payment_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_rdv_full_payment_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) to service_role;

-- 2/2 · Protection des rendez-vous : version précédente
CREATE OR REPLACE FUNCTION public.enforce_mediumia_booking_reservation_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_service public.booking_services;
  v_valid BOOLEAN := false;
BEGIN
  IF NEW.booking_source <> 'mediumia' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = NEW.service_id;
  IF FOUND
    AND v_service.booking_mode = 'instant'
    AND v_service.reservation_payment_kind = 'arrhes'
  THEN
    v_valid := NEW.booked_price_cents IS NOT DISTINCT FROM v_service.price_cents
      AND (
        NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.reservation_payment_cents
        OR (
          'video' = ANY(v_service.modality)
          AND NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.price_cents
        )
      );

    IF NOT v_valid THEN
      RAISE EXCEPTION 'reservation_payment_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
