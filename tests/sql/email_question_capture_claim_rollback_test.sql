-- TEST ONLY. Isolated fictional guidance; no PayPal network call, no email.
-- Requires email_question_capture_claim_test already applied on TEST.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
INSERT INTO public.mediumia_email_questions (
  id, paypal_env, paypal_order_id, pack, question_count, amount_cents, currency,
  first_name, email, questions, status, terms_version,
  terms_accepted_at, immediate_service_accepted_at
) VALUES (
  '632f086e-946a-481e-9bee-7e2959b1c101'::uuid, 'sandbox',
  'TEST-FAKE-CLAIM-ONLY-20261016', 'q1', 1, 1990, 'EUR',
  'FICTIF', 'test-claim@example.invalid',
  '[{"q":"Question fictive de test ?","context":"Contexte fictif volontairement sans client."}]'::jsonb,
  'payment_pending', 'test-only', clock_timestamp(), clock_timestamp()
);
DO $test$
DECLARE v_claims integer;
BEGIN
  UPDATE public.mediumia_email_questions SET capture_started_at=clock_timestamp()
  WHERE id='632f086e-946a-481e-9bee-7e2959b1c101'::uuid
    AND status='payment_pending' AND capture_started_at IS NULL;
  GET DIAGNOSTICS v_claims=ROW_COUNT;
  IF v_claims <> 1 THEN RAISE EXCEPTION 'first_claim_failed'; END IF;

  UPDATE public.mediumia_email_questions SET capture_started_at=clock_timestamp()
  WHERE id='632f086e-946a-481e-9bee-7e2959b1c101'::uuid
    AND status='payment_pending' AND capture_started_at IS NULL;
  GET DIAGNOSTICS v_claims=ROW_COUNT;
  IF v_claims <> 0 THEN RAISE EXCEPTION 'duplicate_claim_not_blocked'; END IF;
END $test$;
ROLLBACK;
