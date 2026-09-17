-- Priorité à la sécurité du paiement : un rendez-vous n'est jamais annulé
-- automatiquement tant qu'une capture de solde est marquée en cours.

CREATE OR REPLACE FUNCTION public.claim_rdv_balance_auto_cancel(p_booking_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.claim_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) TO service_role;
