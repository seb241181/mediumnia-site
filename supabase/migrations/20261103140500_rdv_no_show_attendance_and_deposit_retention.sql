-- Recorded no-shows are different from cancellations or completed sessions.
-- A no-show never creates income: previously captured arrhes stay in the ledger.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed','cancelled','rescheduled','no_show'));

CREATE TABLE IF NOT EXISTS public.rdv_booking_no_show_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  practitioner_id uuid NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.rdv_paypal_payments(id) ON DELETE RESTRICT,
  retained_cents integer NOT NULL DEFAULT 0 CHECK (retained_cents >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rdv_booking_no_show_events_practitioner_idx
  ON public.rdv_booking_no_show_events (practitioner_id, occurred_at DESC);
ALTER TABLE public.rdv_booking_no_show_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_booking_no_show_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rdv_booking_no_show_events TO service_role;

CREATE OR REPLACE FUNCTION public.mark_rdv_booking_no_show(
  p_booking_id uuid, p_practitioner_id uuid, p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_booking public.bookings;
  v_payment public.rdv_paypal_payments;
  v_owner_id uuid;
  v_payment_id uuid;
  v_retained integer := 0;
  v_saved integer;
BEGIN
  IF p_booking_id IS NULL OR p_practitioner_id IS NULL OR p_actor IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  SELECT owner_id INTO v_owner_id FROM public.booking_practitioners
    WHERE id=p_practitioner_id;
  IF v_owner_id IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('ok',false,'error','forbidden');
  END IF;

  SELECT * INTO v_booking FROM public.bookings
    WHERE id=p_booking_id AND practitioner_id=p_practitioner_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','booking_not_found'); END IF;
  IF v_booking.status = 'no_show' THEN
    SELECT retained_cents INTO v_saved FROM public.rdv_booking_no_show_events WHERE booking_id=v_booking.id;
    RETURN jsonb_build_object('ok',true,'already',true,'retained_cents',COALESCE(v_saved,0));
  END IF;
  IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok',false,'error','booking_not_markable');
  END IF;
  IF v_booking.ends_at > now() THEN
    RETURN jsonb_build_object('ok',false,'error','appointment_not_finished');
  END IF;

  -- Never treat an ongoing or potentially captured balance PayPal order as unpaid.
  IF EXISTS (
    SELECT 1 FROM public.rdv_balance_payments rb
    WHERE rb.booking_id=v_booking.id
      AND (rb.paypal_order_id IS NOT NULL OR rb.status IN ('capture_in_progress','captured'))
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','balance_payment_review_required');
  END IF;

  -- Only a genuine, captured *partial* deposit may be marked as retained.
  IF COALESCE(v_booking.reservation_payment_cents,0) > 0
     AND v_booking.reservation_payment_cents < COALESCE(v_booking.booked_price_cents,0) THEN
    v_payment_id := public.rdv_booking_deposit_payment_id(v_booking.id);
    IF v_payment_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','captured_deposit_not_found'); END IF;
    SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE id=v_payment_id FOR UPDATE;
    IF v_payment.id IS NULL OR v_payment.status <> 'captured'
       OR v_payment.paypal_capture_id IS NULL OR v_payment.captured_at IS NULL
       OR v_payment.amount_cents <> v_booking.reservation_payment_cents
       OR v_payment.settlement_status <> 'open'
       OR COALESCE(v_payment.refunded_cents,0) <> 0 THEN
      RETURN jsonb_build_object('ok',false,'error','deposit_payment_review_required');
    END IF;
    IF EXISTS (SELECT 1 FROM public.rdv_payment_refunds rf WHERE rf.payment_id=v_payment_id) THEN
      RETURN jsonb_build_object('ok',false,'error','deposit_refund_review_required');
    END IF;
    IF public.rdv_booking_paid_cents(v_booking.id) <> v_payment.amount_cents THEN
      RETURN jsonb_build_object('ok',false,'error','other_payment_review_required');
    END IF;

    UPDATE public.rdv_paypal_payments SET
      settlement_status='retained', settlement_updated_at=now()
      WHERE id=v_payment.id AND settlement_status='open';
    v_retained := v_payment.amount_cents;
    INSERT INTO public.rdv_payment_settlement_events(payment_id,event,actor,detail)
    VALUES (v_payment.id,'retained',p_actor,
      jsonb_build_object('amount_cents',v_retained,'reason','no_show','booking_id',v_booking.id));
  END IF;

  UPDATE public.bookings SET status='no_show',updated_at=now()
    WHERE id=v_booking.id AND status='confirmed';

  INSERT INTO public.rdv_booking_no_show_events
    (booking_id,practitioner_id,actor_id,payment_id,retained_cents)
  VALUES (v_booking.id,p_practitioner_id,p_actor,v_payment_id,v_retained);

  RETURN jsonb_build_object('ok',true,'already',false,
    'status','no_show','retained_cents',v_retained);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_rdv_booking_no_show(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_rdv_booking_no_show(uuid,uuid,uuid) TO service_role;
