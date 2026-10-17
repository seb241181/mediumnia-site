-- Manual integration test: run ONLY after the settlement-guard TEST migration
-- has been explicitly approved and applied. Single transaction, ALWAYS ROLLBACK.
-- No Google, PayPal, Resend, phone or client mutation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

INSERT INTO public.bookings (
  id, practitioner_id, service_id, customer_first_name, customer_last_name,
  customer_email, starts_at, ends_at, booking_source,
  booked_price_cents, reservation_payment_cents, status
)
SELECT 'd9381607-d011-4dc2-8329-989ddf210031'::uuid, p.id, s.id,
       'TEST GUARDED', 'ROLLBACK', 'test-owner-guard@example.invalid',
       '2099-05-28T10:00:00Z'::timestamptz,
       '2099-05-28T11:00:00Z'::timestamptz,
       'mediumia', s.price_cents, s.reservation_payment_cents, 'confirmed'
FROM public.booking_services s
JOIN public.booking_practitioners p ON p.id=s.practitioner_id
WHERE s.booking_mode='instant' AND s.reservation_payment_kind='none'
  AND p.owner_id IS NOT NULL
ORDER BY s.id LIMIT 1;

DO $test$
DECLARE
  v_booking uuid := 'd9381607-d011-4dc2-8329-989ddf210031'::uuid;
  v_owner uuid;
  v_practitioner uuid;
  v_claim jsonb;
  v_refund_blocked boolean := false;
  v_transfer_blocked boolean := false;
  v_double_claim jsonb;
  v_finish jsonb;
  v_status text;
BEGIN
  SELECT p.id, p.owner_id INTO v_practitioner, v_owner
  FROM public.bookings b
  JOIN public.booking_practitioners p ON p.id=b.practitioner_id
  WHERE b.id=v_booking;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'fixture_missing'; END IF;

  SELECT public.claim_owner_booking_cancel(v_booking,v_practitioner,v_owner) INTO v_claim;
  IF v_claim->>'ok' <> 'true' OR v_claim->>'claim_id' IS NULL
  THEN RAISE EXCEPTION 'claim_failed: %',v_claim; END IF;

  SELECT public.claim_owner_booking_cancel(v_booking,v_practitioner,v_owner) INTO v_double_claim;
  IF v_double_claim->>'error' <> 'owner_cancel_pending_review'
  THEN RAISE EXCEPTION 'duplicate_claim_not_blocked: %',v_double_claim; END IF;

  -- Intentionally omit mandatory refund fields: the BEFORE trigger should
  -- reject the write BEFORE other table constraints with SQLSTATE 55P03.
  BEGIN
    INSERT INTO public.rdv_payment_refunds (booking_id,practitioner_id)
      VALUES (v_booking,v_practitioner);
  EXCEPTION WHEN SQLSTATE '55P03' THEN v_refund_blocked := true;
  END;
  IF NOT v_refund_blocked
  THEN RAISE EXCEPTION 'refund_guard_not_proven'; END IF;

  BEGIN
    INSERT INTO public.rdv_deposit_transfers
      (source_booking_id,target_booking_id,practitioner_id)
      VALUES (v_booking,v_booking,v_practitioner);
  EXCEPTION WHEN SQLSTATE '55P03' THEN v_transfer_blocked := true;
  END;
  IF NOT v_transfer_blocked
  THEN RAISE EXCEPTION 'transfer_guard_not_proven'; END IF;

  SELECT public.finalize_owner_booking_cancel(v_booking,v_practitioner,v_owner,
    (v_claim->>'claim_id')::uuid,true) INTO v_finish;
  IF v_finish->>'ok' <> 'true'
  THEN RAISE EXCEPTION 'finalize_failed: %',v_finish; END IF;
  SELECT status INTO v_status FROM public.bookings WHERE id=v_booking;
  IF v_status <> 'cancelled' THEN RAISE EXCEPTION 'booking_not_cancelled'; END IF;
END $test$;
ROLLBACK;
