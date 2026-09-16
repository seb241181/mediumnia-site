-- Dernière barrière anti-course : après la capture PayPal distante, le créneau
-- est revérifié sous verrou avant la création du RDV. Si un conflit exceptionnel
-- est apparu entre-temps, le paiement reste capturé et le hold reste bloqué pour
-- réconciliation manuelle ; le créneau n'est jamais double-réservé.

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

  IF v_hold.status = 'converted' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'converted', true,
      'booking_id', v_hold.converted_booking_id
    );
  END IF;

  IF v_payment.paypal_env <> p_paypal_env
    OR v_payment.amount_cents <> p_amount_cents
    OR v_payment.currency <> p_currency
    OR v_hold.reservation_payment_cents <> p_amount_cents
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

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = v_hold.service_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_found');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = v_hold.practitioner_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1
    FROM public.rdv_booking_holds h
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

  IF NOT v_conflict AND v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count
    FROM (
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
        AND (
          h.status IN ('payment_capturing', 'payment_captured')
          OR (h.status = 'payment_pending' AND h.expires_at > now())
        )
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

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'paid_slot_reconciliation_required',
      'payment_captured', true
    );
  END IF;

  INSERT INTO public.bookings (
    practitioner_id,
    service_id,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    customer_message,
    starts_at,
    ends_at,
    timezone,
    status,
    booked_price_cents,
    reservation_payment_cents,
    booking_source
  ) VALUES (
    v_hold.practitioner_id,
    v_hold.service_id,
    v_hold.customer_first_name,
    v_hold.customer_last_name,
    v_hold.customer_email,
    v_hold.customer_phone,
    v_hold.customer_message,
    v_hold.starts_at,
    v_hold.ends_at,
    'Europe/Paris',
    'confirmed',
    v_hold.service_price_cents,
    v_hold.reservation_payment_cents,
    'mediumia'
  ) RETURNING id INTO v_booking_id;

  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_service.vat_rate_bps))::INTEGER;
  v_vat := p_amount_cents - v_net;

  INSERT INTO public.rdv_financial_entries (
    practitioner_id,
    booking_id,
    service_id,
    source,
    entry_kind,
    direction,
    payment_method,
    occurred_at,
    gross_cents,
    net_cents,
    vat_cents,
    vat_rate_bps,
    vat_status,
    currency,
    service_price_cents,
    appointment_starts_at,
    customer_name,
    customer_email,
    external_payment_ref,
    note
  ) VALUES (
    v_hold.practitioner_id,
    v_booking_id,
    v_hold.service_id,
    'mediumia',
    'arrhes',
    'income',
    'paypal',
    COALESCE(p_captured_at, now()),
    p_amount_cents,
    v_net,
    v_vat,
    v_service.vat_rate_bps,
    'taxable',
    p_currency,
    v_hold.service_price_cents,
    v_hold.starts_at,
    trim(v_hold.customer_first_name || ' ' || v_hold.customer_last_name),
    v_hold.customer_email,
    p_paypal_capture_id,
    'Arrhes de réservation MediumIA'
  );

  UPDATE public.rdv_booking_holds
  SET status = 'converted',
      converted_booking_id = v_booking_id,
      expires_at = NULL
  WHERE id = v_hold.id;

  UPDATE public.rdv_paypal_payments
  SET status = 'captured',
      paypal_capture_id = p_paypal_capture_id,
      captured_at = COALESCE(p_captured_at, now()),
      last_error_code = NULL
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'converted', false,
    'booking_id', v_booking_id,
    'service_price_cents', v_hold.service_price_cents,
    'reservation_payment_cents', v_hold.reservation_payment_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_rdv_deposit_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_rdv_deposit_hold(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) TO service_role;
