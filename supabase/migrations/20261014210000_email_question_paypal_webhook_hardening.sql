-- PayPal Guidance webhook delivery ledger.
-- Technical identifiers only: no question, email address or payment secret.

CREATE TABLE IF NOT EXISTS public.mediumia_email_question_paypal_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type = 'PAYMENT.CAPTURE.COMPLETED'),
  capture_id TEXT NOT NULL UNIQUE,
  paypal_order_id TEXT NOT NULL,
  question_id UUID NOT NULL REFERENCES public.mediumia_email_questions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','retryable','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mediumia_email_question_paypal_events_retry_idx
  ON public.mediumia_email_question_paypal_events(status, lease_until);

ALTER TABLE public.mediumia_email_question_paypal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediumia_email_question_paypal_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mediumia_email_question_paypal_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mediumia_email_question_paypal_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_email_question_paypal_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_capture_id TEXT,
  p_paypal_order_id TEXT,
  p_question_id UUID,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(claimed BOOLEAN, event_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.mediumia_email_question_paypal_events%ROWTYPE;
  v_inserted INTEGER := 0;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^WH-[A-Za-z0-9-]{10,128}$'
    OR p_event_type <> 'PAYMENT.CAPTURE.COMPLETED'
    OR p_capture_id IS NULL OR p_capture_id !~ '^[A-Za-z0-9-]{8,128}$'
    OR p_paypal_order_id IS NULL OR p_paypal_order_id !~ '^[A-Za-z0-9-]{8,128}$'
    OR p_question_id IS NULL THEN
    RAISE EXCEPTION 'invalid_paypal_event_claim';
  END IF;

  INSERT INTO public.mediumia_email_question_paypal_events (
    event_id, event_type, capture_id, paypal_order_id, question_id,
    status, attempt_count, lease_until, updated_at
  ) VALUES (
    p_event_id, p_event_type, p_capture_id, p_paypal_order_id, p_question_id,
    'processing', 1, p_now + interval '5 minutes', p_now
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_event
  FROM public.mediumia_email_question_paypal_events
  WHERE event_id = p_event_id OR capture_id = p_capture_id
  ORDER BY CASE WHEN event_id = p_event_id THEN 0 ELSE 1 END
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'unknown'::TEXT;
    RETURN;
  END IF;

  IF v_event.event_id <> p_event_id
    OR v_event.event_type <> p_event_type
    OR v_event.capture_id <> p_capture_id
    OR v_event.paypal_order_id <> p_paypal_order_id
    OR v_event.question_id <> p_question_id THEN
    RETURN QUERY SELECT FALSE, 'capture_claimed'::TEXT;
    RETURN;
  END IF;

  IF v_inserted = 1 THEN
    RETURN QUERY SELECT TRUE, 'processing'::TEXT;
    RETURN;
  END IF;

  IF v_event.status = 'retryable'
    OR (v_event.status = 'processing' AND v_event.lease_until < p_now) THEN
    UPDATE public.mediumia_email_question_paypal_events
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        lease_until = p_now + interval '5 minutes',
        last_error = NULL,
        updated_at = p_now
    WHERE event_id = p_event_id;
    RETURN QUERY SELECT TRUE, 'processing'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, v_event.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_email_question_paypal_event(
  p_event_id TEXT,
  p_status TEXT,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_status NOT IN ('completed','retryable','failed') THEN
    RAISE EXCEPTION 'invalid_paypal_event_status';
  END IF;

  UPDATE public.mediumia_email_question_paypal_events
  SET status = p_status,
      lease_until = NULL,
      last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE left(coalesce(p_error, 'unknown'), 120) END,
      processed_at = CASE WHEN p_status IN ('completed','failed') THEN p_now ELSE NULL END,
      updated_at = p_now
  WHERE event_id = p_event_id
    AND status = 'processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_question_paypal_event(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_question_paypal_event(TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.finish_email_question_paypal_event(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_email_question_paypal_event(TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
