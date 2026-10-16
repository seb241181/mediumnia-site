-- One-shot, atomic reconciliation of exactly five user-approved historical PayPal Live orders.
-- No PayPal calls, refunds, charges, or customer emails are issued by this function.
-- The caller (authenticated site owner via service_role backend) must independently verify
-- all five PayPal order + capture GET responses immediately before invoking this RPC.
-- After successful execution, DROP this RPC in a follow-up maintenance migration.
CREATE OR REPLACE FUNCTION public.finalize_email_question_history_20261016(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_expected text[] := ARRAY[
    '3SW145854V1505605', '69X93374DH161533N', '80K4011618869881S',
    '35D011264B880141D', '8UD57551GX7357418'
  ]::text[];
  v_orders text[];
  v_item jsonb;
  v_id text;
  v_capture text;
  v_status text;
  v_row public.mediumia_email_questions%ROWTYPE;
  v_paid timestamptz;
  v_refunded timestamptz;
  v_due timestamptz;
  v_count integer := 0;
  v_distinct_capture integer;
BEGIN
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) <> 5 THEN
    RAISE EXCEPTION 'historical_reconciliation_must_have_exactly_five';
  END IF;
  SELECT pg_catalog.array_agg(e.value->>'orderId' ORDER BY e.value->>'orderId')
    INTO v_orders FROM pg_catalog.jsonb_array_elements(p_items) AS e(value);
  IF v_orders IS DISTINCT FROM (SELECT pg_catalog.array_agg(x ORDER BY x)
                                FROM pg_catalog.unnest(v_expected) x) THEN
    RAISE EXCEPTION 'historical_reconciliation_scope_mismatch';
  END IF;
  SELECT count(DISTINCT e.value->>'captureId') INTO v_distinct_capture
    FROM pg_catalog.jsonb_array_elements(p_items) AS e(value);
  IF v_distinct_capture <> 5 THEN
    RAISE EXCEPTION 'historical_reconciliation_duplicate_captures';
  END IF;

  -- Lock all 5 rows before changing any. Transaction rolls back on any error.
  FOR v_row IN
    SELECT * FROM public.mediumia_email_questions
    WHERE paypal_order_id = ANY(v_expected)
    ORDER BY paypal_order_id FOR UPDATE
  LOOP
    v_count := v_count + 1;
    IF v_row.status <> 'payment_pending'
       OR v_row.paypal_env <> 'live'
       OR v_row.pack <> 'q2' OR v_row.question_count <> 2
       OR v_row.amount_cents <> 2990 OR v_row.currency <> 'EUR'
       OR v_row.paypal_capture_id IS NOT NULL
       OR v_row.paypal_refund_id IS NOT NULL
       OR v_row.paid_at IS NOT NULL OR v_row.refunded_at IS NOT NULL
       OR v_row.confirmation_email_status IS NOT NULL THEN
      RAISE EXCEPTION 'historical_reconciliation_row_preconditions_changed';
    END IF;
  END LOOP;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'historical_reconciliation_missing_row';
  END IF;
  v_count := 0;

  FOR v_item IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_items) AS e(value)
  LOOP
    v_id := v_item->>'orderId';
    v_capture := v_item->>'captureId';
    v_status := v_item->>'status';
    IF v_capture IS NULL OR v_capture !~ '^[A-Za-z0-9-]{8,128}$' THEN
      RAISE EXCEPTION 'historical_reconciliation_invalid_capture';
    END IF;
    IF (v_id IN ('80K4011618869881S','8UD57551GX7357418') AND v_status <> 'paid')
       OR (v_id IN ('3SW145854V1505605','69X93374DH161533N','35D011264B880141D') AND v_status <> 'refunded') THEN
      RAISE EXCEPTION 'historical_reconciliation_status_mismatch';
    END IF;

    v_paid := NULLIF(v_item->>'paidAt','')::timestamptz;
    v_refunded := NULLIF(v_item->>'refundedAt','')::timestamptz;
    v_due := NULLIF(v_item->>'dueAt','')::timestamptz;
    IF v_paid IS NULL OR v_paid < '2026-10-10'::timestamptz
       OR v_paid > pg_catalog.now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'historical_reconciliation_invalid_payment_date';
    END IF;
    IF v_status = 'refunded' AND
       (v_refunded IS NULL OR v_refunded < v_paid OR
        v_refunded > pg_catalog.now() + interval '5 minutes' OR v_due IS NOT NULL) THEN
      RAISE EXCEPTION 'historical_reconciliation_invalid_refund_date';
    END IF;
    IF v_status = 'paid' AND
       (v_refunded IS NOT NULL OR v_due IS NULL OR v_due < v_paid OR
        v_due > v_paid + interval '7 days') THEN
      RAISE EXCEPTION 'historical_reconciliation_invalid_due_date';
    END IF;

    UPDATE public.mediumia_email_questions
    SET status = v_status,
        paypal_capture_id = v_capture,
        paid_at = v_paid,
        refunded_at = CASE WHEN v_status = 'refunded' THEN v_refunded ELSE NULL END,
        due_at = CASE WHEN v_status = 'paid' THEN v_due ELSE NULL END,
        confirmation_email_status = 'historical_reconciliation_no_email',
        refusal_reason = CASE WHEN v_status = 'refunded'
          THEN 'Remboursement PayPal Live effectué manuellement puis confirmé via GET, sans nouveau remboursement. Référence refund non recoupée.'
          ELSE NULL END,
        updated_at = pg_catalog.now()
    WHERE paypal_order_id = v_id AND status = 'payment_pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'historical_reconciliation_conflict'; END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('reconciled',v_count,'paid',2,'refunded',3,'emails_sent',0,'payments_changed',0);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_email_question_history_20261016(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_email_question_history_20261016(jsonb) TO service_role;
