-- Follow-up to owner_booking_cancel_claim_test — prepared, NOT applied.
-- Serializes refund/transfer mutations with cancellation claims; fail closed
-- on any existing settlement history. Apply ONLY after review and explicit GO.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_owner_cancel_settlement_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_blocked boolean;
BEGIN
  IF TG_TABLE_NAME = 'rdv_payment_refunds' THEN
    IF TG_OP <> 'INSERT' THEN v_ids := array_append(v_ids, OLD.booking_id); END IF;
    IF TG_OP <> 'DELETE' THEN v_ids := array_append(v_ids, NEW.booking_id); END IF;
  ELSIF TG_TABLE_NAME = 'rdv_deposit_transfers' THEN
    IF TG_OP <> 'INSERT' THEN
      v_ids := array_append(v_ids, OLD.source_booking_id);
      v_ids := array_append(v_ids, OLD.target_booking_id);
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_ids := array_append(v_ids, NEW.source_booking_id);
      v_ids := array_append(v_ids, NEW.target_booking_id);
    END IF;
  END IF;
  -- Lock all old and new references in a deterministic order. This prevents
  -- switching a transfer from an unlocked booking into a claimed booking.
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT b.id, b.owner_cancel_claim_id, b.status
      FROM public.bookings b
      WHERE b.id = ANY(v_ids)
      ORDER BY b.id FOR UPDATE
    ) locked
    WHERE locked.owner_cancel_claim_id IS NOT NULL
      AND locked.status='confirmed'
  ) INTO v_blocked;
  IF v_blocked THEN
    RAISE EXCEPTION 'owner_booking_cancellation_in_progress'
      USING ERRCODE = '55P03';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_owner_cancel_refunds ON public.rdv_payment_refunds;
CREATE TRIGGER guard_owner_cancel_refunds
  BEFORE INSERT OR UPDATE OR DELETE ON public.rdv_payment_refunds
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_cancel_settlement_write();
DROP TRIGGER IF EXISTS guard_owner_cancel_transfers ON public.rdv_deposit_transfers;
CREATE TRIGGER guard_owner_cancel_transfers
  BEFORE INSERT OR UPDATE OR DELETE ON public.rdv_deposit_transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_owner_cancel_settlement_write();

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
  IF v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'external_booking_requires_review');
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
  -- Historique de remboursement ou de transfert : décisions financières
  -- hors du périmètre du bouton, même si le prestataire a terminé son action.
  IF EXISTS (
    SELECT 1 FROM public.rdv_payment_refunds
    WHERE booking_id = v_booking.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_requires_manual_review');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rdv_deposit_transfers
    WHERE source_booking_id = v_booking.id OR target_booking_id = v_booking.id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transfer_requires_manual_review');
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

REVOKE ALL ON FUNCTION public.guard_owner_cancel_settlement_write()
  FROM PUBLIC, anon, authenticated;
