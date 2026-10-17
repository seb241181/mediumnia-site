-- PR #158 — transaction-safe owner cancellation claim (PREPARED ONLY).
-- Do not deploy to PROD without a dedicated reviewed GO.
-- PayPal provider calls are never performed in SQL.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS owner_cancel_claim_id uuid,
  ADD COLUMN IF NOT EXISTS owner_cancel_claimed_at timestamptz;

COMMENT ON COLUMN public.bookings.owner_cancel_claim_id IS
  'Fail-closed owner cancellation claim; do not clear without checking Google and payment evidence.';

-- All financial writers serialize on their booking row, including the existing
-- payment-claim/finalize RPCs and manual ledger inserts. Critically, the row is
-- locked even before a cancellation claim exists; that closes the TOCTOU gap.
CREATE OR REPLACE FUNCTION public.guard_owner_booking_cancellation_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_booking_id uuid;
  v_claim uuid;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'rdv_paypal_payments' THEN
    SELECT h.converted_booking_id INTO v_booking_id
      FROM public.rdv_booking_holds h
      WHERE h.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.hold_id ELSE NEW.hold_id END;
  ELSE
    v_booking_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.booking_id ELSE NEW.booking_id END;
  END IF;
  IF v_booking_id IS NOT NULL THEN
    SELECT b.owner_cancel_claim_id, b.status INTO v_claim, v_status
      FROM public.bookings b WHERE b.id = v_booking_id FOR UPDATE;
    IF v_claim IS NOT NULL AND v_status = 'confirmed' THEN
      RAISE EXCEPTION 'owner_booking_cancellation_in_progress'
        USING ERRCODE = '55P03';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- Keep automatic cancellation and other booking editors from changing the
-- identity/date/status of a booking while its owner cancel is unresolved.
-- The owner finalize RPC is the sole allowed confirmed -> cancelled transition.
CREATE OR REPLACE FUNCTION public.guard_owner_booking_cancel_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
BEGIN
  IF OLD.owner_cancel_claim_id IS NOT NULL AND OLD.status = 'confirmed'
     AND (
       NEW.owner_cancel_claim_id IS DISTINCT FROM OLD.owner_cancel_claim_id
       OR NEW.status IS DISTINCT FROM OLD.status
          AND (NEW.status IS DISTINCT FROM 'cancelled'
            OR NEW.cancel_reason IS DISTINCT FROM 'practitioner_manual')
       OR NEW.balance_cancel_claimed_at IS DISTINCT FROM OLD.balance_cancel_claimed_at
       OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id
       OR NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
       OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
       OR NEW.google_event_id IS DISTINCT FROM OLD.google_event_id
     )
  THEN
    RAISE EXCEPTION 'owner_booking_cancellation_in_progress'
      USING ERRCODE = '55P03';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS guard_owner_cancel_booking_status ON public.bookings;
CREATE TRIGGER guard_owner_cancel_booking_status BEFORE UPDATE
  ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_booking_cancel_status();

DROP TRIGGER IF EXISTS guard_owner_cancel_balance_payments ON public.rdv_balance_payments;
CREATE TRIGGER guard_owner_cancel_balance_payments BEFORE INSERT OR UPDATE OR DELETE
  ON public.rdv_balance_payments FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_booking_cancellation_write();

DROP TRIGGER IF EXISTS guard_owner_cancel_financial_entries ON public.rdv_financial_entries;
CREATE TRIGGER guard_owner_cancel_financial_entries BEFORE INSERT OR UPDATE OR DELETE
  ON public.rdv_financial_entries FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_booking_cancellation_write();

DROP TRIGGER IF EXISTS guard_owner_cancel_gift_card_redemptions ON public.gift_card_redemptions;
CREATE TRIGGER guard_owner_cancel_gift_card_redemptions BEFORE INSERT OR UPDATE OR DELETE
  ON public.gift_card_redemptions FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_booking_cancellation_write();

DROP TRIGGER IF EXISTS guard_owner_cancel_paypal_deposits ON public.rdv_paypal_payments;
CREATE TRIGGER guard_owner_cancel_paypal_deposits BEFORE INSERT OR UPDATE OR DELETE
  ON public.rdv_paypal_payments FOR EACH ROW
  EXECUTE FUNCTION public.guard_owner_booking_cancellation_write();

CREATE OR REPLACE FUNCTION public.claim_owner_booking_cancel(
  p_booking_id uuid, p_practitioner_id uuid, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_booking public.bookings;
  v_paid integer;
  v_paypal_ledger integer;
  v_paypal_proven integer;
  v_claim uuid;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.booking_practitioners
    WHERE id = p_practitioner_id AND owner_id = p_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  SELECT * INTO v_booking FROM public.bookings
    WHERE id = p_booking_id AND practitioner_id = p_practitioner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;
  IF v_booking.status <> 'confirmed' OR v_booking.starts_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_confirmed');
  END IF;
  IF v_booking.owner_cancel_claim_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_cancel_pending_review');
  END IF;
  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     OR v_booking.balance_google_resync_claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_in_progress_requires_review');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gift_card_redemptions
    WHERE booking_id = v_booking.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'gift_card_requires_manual_review');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rdv_balance_payments
    WHERE booking_id = v_booking.id
      AND (status <> 'captured' OR paypal_capture_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_paypal_payments p
      JOIN public.rdv_booking_holds h ON h.id = p.hold_id
    WHERE h.converted_booking_id = v_booking.id
      AND (p.status <> 'captured' OR p.paypal_capture_id IS NULL)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_in_progress_requires_review');
  END IF;
  SELECT COALESCE(SUM(CASE WHEN direction = 'refund' THEN -gross_cents ELSE gross_cents END), 0)::integer,
         COALESCE(SUM(CASE WHEN payment_method='paypal'
           THEN CASE WHEN direction='refund' THEN -gross_cents ELSE gross_cents END
           ELSE 0 END), 0)::integer
    INTO v_paid, v_paypal_ledger
    FROM public.rdv_financial_entries
    WHERE booking_id = v_booking.id AND practitioner_id = p_practitioner_id;
  SELECT COALESCE(SUM(amount_cents), 0)::integer INTO v_paypal_proven
    FROM (
      SELECT p.amount_cents
        FROM public.rdv_paypal_payments p
        JOIN public.rdv_booking_holds h ON h.id = p.hold_id
        WHERE h.converted_booking_id = v_booking.id AND p.status = 'captured'
      UNION ALL
      SELECT p.amount_cents FROM public.rdv_balance_payments p
        WHERE p.booking_id = v_booking.id AND p.status = 'captured'
    ) AS provider_captures;
  -- Fail closed if PayPal evidence and local finance differ. Refunds and
  -- external settlements must be reconciled manually before cancellation.
  IF v_paypal_proven <> v_paypal_ledger
     OR (v_booking.reservation_payment_cents > 0 AND v_paid <= 0)
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_reconciliation_required');
  END IF;
  v_claim := gen_random_uuid();
  UPDATE public.bookings SET owner_cancel_claim_id = v_claim,
    owner_cancel_claimed_at = clock_timestamp()
  WHERE id = v_booking.id;
  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim,
    'paid_cents', GREATEST(v_paid, 0),
    'financial_review_required', v_paid > 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_owner_booking_cancel(
  p_booking_id uuid, p_practitioner_id uuid, p_actor uuid,
  p_claim_id uuid, p_google_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_booking public.bookings;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.booking_practitioners WHERE id = p_practitioner_id AND owner_id = p_actor
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  SELECT * INTO v_booking FROM public.bookings
    WHERE id=p_booking_id AND practitioner_id=p_practitioner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF p_claim_id IS NULL OR v_booking.owner_cancel_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_mismatch');
  END IF;
  IF v_booking.status='cancelled' AND v_booking.cancel_reason='practitioner_manual' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;
  IF v_booking.status <> 'confirmed' OR p_google_confirmed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_finalize_blocked');
  END IF;
  IF v_booking.starts_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'past_booking_cannot_cancel');
  END IF;
  UPDATE public.bookings
    SET status='cancelled', cancel_reason='practitioner_manual',
        cancelled_at=clock_timestamp(), updated_at=clock_timestamp(),
        balance_payment_token_hash = NULL,
        balance_payment_token_expires_at = NULL
    WHERE id=v_booking.id AND status='confirmed'
      AND owner_cancel_claim_id=p_claim_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cancel_finalize_blocked'); END IF;
  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'booking_id', v_booking.id);
END;
$function$;

-- The claim deliberately remains set on uncertain Google/DB failures.
-- Never auto-expire it: an operator must reconcile Google first.
REVOKE ALL ON FUNCTION public.claim_owner_booking_cancel(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_owner_booking_cancel(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_booking_cancel(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_owner_booking_cancel(uuid, uuid, uuid, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.guard_owner_booking_cancellation_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_owner_booking_cancel_status() FROM PUBLIC, anon, authenticated;
