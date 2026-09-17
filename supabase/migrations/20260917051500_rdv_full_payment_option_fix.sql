-- MediumIA RDV — correction et durcissement de l'option de paiement intégral.
-- Cette migration est volontairement additive : elle fonctionne après le socle arrhes
-- et reste compatible avec une base où payment_option aurait déjà été créé en test.

ALTER TABLE public.rdv_paypal_payments
  ADD COLUMN IF NOT EXISTS payment_option TEXT NOT NULL DEFAULT 'deposit'
    CHECK (payment_option IN ('deposit', 'full'));

CREATE OR REPLACE FUNCTION public.create_rdv_full_payment_hold(
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
  p_early_performance_requested BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- Sérialise création et retries pour un même praticien, comme le socle arrhes.
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  -- Idempotence : si ce checkout existe déjà pour un paiement intégral identique,
  -- on renvoie simplement la même intention au lieu de tenter de changer son montant.
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

  -- Nouveau checkout : réutilise les protections éprouvées du parcours arrhes,
  -- puis transforme l'intention en paiement intégral avant toute création PayPal.
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
$$;

REVOKE ALL ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
