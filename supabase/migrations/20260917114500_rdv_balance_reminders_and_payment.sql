-- MediumIA RDV — règlement du solde, rappel H-72 et annulation automatique H-48.
-- Le système s'applique uniquement aux rendez-vous vidéo MediumIA ayant un solde restant.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_payment_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS balance_payment_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_reminder_email_id TEXT,
  ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_cancel_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_auto_cancelled_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_balance_payment_token_hash
  ON public.bookings(balance_payment_token_hash)
  WHERE balance_payment_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rdv_balance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  client_checkout_id UUID NOT NULL,
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  paypal_env TEXT NOT NULL CHECK (paypal_env IN ('sandbox', 'live')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'order_pending'
    CHECK (status IN ('order_pending', 'capture_in_progress', 'captured', 'failed')),
  capture_claimed_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rdv_balance_payments_order
  ON public.rdv_balance_payments(paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

ALTER TABLE public.rdv_balance_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rdv_balance_payments TO service_role;

CREATE TABLE IF NOT EXISTS public.rdv_balance_runtime_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton = true),
  sweep_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.rdv_balance_runtime_settings(singleton, sweep_url)
VALUES (true, NULL)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.rdv_balance_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_runtime_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.rdv_balance_runtime_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.rdv_balance_sweep_tokens (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rdv_balance_sweep_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_sweep_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rdv_balance_sweep_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.rdv_booking_paid_cents(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'income' THEN gross_cents
      WHEN 'refund' THEN -gross_cents
      ELSE 0
    END
  ), 0)::INTEGER
  FROM public.rdv_financial_entries
  WHERE booking_id = p_booking_id
    AND source = 'mediumia';
$$;

REVOKE ALL ON FUNCTION public.rdv_booking_paid_cents(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_booking_paid_cents(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.create_or_get_rdv_balance_payment(
  p_token_hash TEXT,
  p_client_checkout_id UUID,
  p_paypal_env TEXT
)
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
  v_due INTEGER;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_balance_token');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE balance_payment_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_token_not_found');
  END IF;

  IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_payable');
  END IF;

  IF v_booking.balance_payment_token_expires_at IS NULL
     OR now() >= v_booking.balance_payment_token_expires_at
     OR now() >= v_booking.starts_at - INTERVAL '48 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_video_only');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);
  IF v_due <= 0 OR v_booking.balance_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'booking_id', v_booking.id,
      'amount_cents', 0,
      'currency', 'EUR'
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.rdv_balance_payments
  WHERE booking_id = v_booking.id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payment.paypal_env <> p_paypal_env OR v_payment.amount_cents <> v_due OR v_payment.currency <> 'EUR' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_intent_mismatch');
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'booking_id', v_booking.id,
      'payment_id', v_payment.id,
      'paypal_order_id', v_payment.paypal_order_id,
      'payment_status', v_payment.status,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'service_title', v_service.title,
      'starts_at', v_booking.starts_at,
      'customer_first_name', v_booking.customer_first_name
    );
  END IF;

  INSERT INTO public.rdv_balance_payments(
    booking_id, client_checkout_id, paypal_env, amount_cents, currency
  ) VALUES (
    v_booking.id, p_client_checkout_id, p_paypal_env, v_due, 'EUR'
  ) RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'paypal_order_id', NULL,
    'payment_status', v_payment.status,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'service_title', v_service.title,
    'starts_at', v_booking.starts_at,
    'customer_first_name', v_booking.customer_first_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_get_rdv_balance_payment(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_get_rdv_balance_payment(TEXT, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_rdv_balance_capture(p_paypal_order_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.rdv_balance_payments;
  v_booking public.bookings;
  v_paid INTEGER;
  v_due INTEGER;
BEGIN
  SELECT * INTO v_payment
  FROM public.rdv_balance_payments
  WHERE paypal_order_id = p_paypal_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_not_found'); END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_captured', true,
      'booking_id', v_booking.id,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'paypal_capture_id', v_payment.paypal_capture_id
    );
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);

  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NOT NULL
     OR now() >= v_booking.starts_at - INTERVAL '48 hours'
     OR v_due <= 0
     OR v_due <> v_payment.amount_cents
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  END IF;

  IF v_payment.status = 'capture_in_progress'
     AND v_payment.capture_claimed_at IS NOT NULL
     AND v_payment.capture_claimed_at > now() - INTERVAL '10 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_capture_in_progress');
  END IF;

  UPDATE public.rdv_balance_payments
  SET status = 'capture_in_progress', capture_claimed_at = now(), updated_at = now(), last_error_code = NULL
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'paypal_env', v_payment.paypal_env
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rdv_balance_capture(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_capture(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.release_rdv_balance_capture(p_paypal_order_id TEXT, p_error_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.rdv_balance_payments
  SET status = 'order_pending', capture_claimed_at = NULL,
      last_error_code = left(COALESCE(p_error_code, 'balance_capture_failed'), 120),
      updated_at = now()
  WHERE paypal_order_id = p_paypal_order_id
    AND status = 'capture_in_progress';
END;
$$;

REVOKE ALL ON FUNCTION public.release_rdv_balance_capture(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rdv_balance_capture(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_capture(
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
  v_payment public.rdv_balance_payments;
  v_booking public.bookings;
  v_service public.booking_services;
  v_paid INTEGER;
  v_due INTEGER;
  v_net INTEGER;
  v_vat INTEGER;
BEGIN
  SELECT * INTO v_payment
  FROM public.rdv_balance_payments
  WHERE paypal_order_id = p_paypal_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_not_found'); END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  IF v_payment.status = 'captured' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_captured', true,
      'booking_id', v_booking.id,
      'amount_cents', v_payment.amount_cents,
      'paypal_capture_id', v_payment.paypal_capture_id
    );
  END IF;

  IF v_payment.status <> 'capture_in_progress'
     OR v_payment.paypal_env <> p_paypal_env
     OR v_payment.amount_cents <> p_amount_cents
     OR v_payment.currency <> p_currency
     OR p_currency <> 'EUR'
     OR v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_intent_mismatch');
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'service_not_found'); END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);
  IF v_due <> p_amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_amount_mismatch');
  END IF;

  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_service.vat_rate_bps))::INTEGER;
  v_vat := p_amount_cents - v_net;

  INSERT INTO public.rdv_financial_entries(
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email,
    external_payment_ref, note
  ) VALUES (
    v_booking.practitioner_id, v_booking.id, v_booking.service_id, 'mediumia', 'balance', 'income', 'paypal',
    COALESCE(p_captured_at, now()), p_amount_cents, v_net, v_vat, v_service.vat_rate_bps, 'taxable', 'EUR',
    v_booking.booked_price_cents, v_booking.starts_at,
    trim(v_booking.customer_first_name || ' ' || v_booking.customer_last_name), v_booking.customer_email,
    p_paypal_capture_id, 'Solde du rendez-vous MediumIA'
  ) ON CONFLICT DO NOTHING;

  UPDATE public.rdv_balance_payments
  SET status = 'captured', paypal_capture_id = p_paypal_capture_id,
      captured_at = COALESCE(p_captured_at, now()), capture_claimed_at = NULL,
      last_error_code = NULL, updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.bookings
  SET balance_paid_at = COALESCE(balance_paid_at, COALESCE(p_captured_at, now())),
      balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      balance_cancel_claimed_at = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_captured', false,
    'booking_id', v_booking.id,
    'amount_cents', p_amount_cents,
    'service_price_cents', v_booking.booked_price_cents,
    'balance_cents', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_rdv_balance_capture(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rdv_balance_capture(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT) TO service_role;

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
  IF FOUND AND (
    v_payment.status = 'captured'
    OR (v_payment.status = 'capture_in_progress' AND v_payment.capture_claimed_at > p_now - INTERVAL '15 minutes')
  ) THEN
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

CREATE OR REPLACE FUNCTION public.release_rdv_balance_auto_cancel(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.bookings
  SET balance_cancel_claimed_at = NULL, updated_at = now()
  WHERE id = p_booking_id AND status = 'confirmed';
END;
$$;

REVOKE ALL ON FUNCTION public.release_rdv_balance_auto_cancel(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rdv_balance_auto_cancel(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_auto_cancel(p_booking_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_paid INTEGER;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NULL
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_no_longer_due_for_balance_cancel');
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled', cancelled_at = p_now,
      cancel_reason = 'balance_unpaid_48h',
      balance_auto_cancelled_at = p_now,
      balance_cancel_claimed_at = NULL,
      balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_rdv_balance_sweep_token(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count BIGINT := 0;
BEGIN
  UPDATE public.rdv_balance_sweep_tokens
  SET used_at = now()
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rdv_balance_sweep_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_sweep_token(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_rdv_balance_sweep()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_url TEXT;
  v_token TEXT;
  v_hash TEXT;
BEGIN
  SELECT sweep_url INTO v_url
  FROM public.rdv_balance_runtime_settings
  WHERE singleton = true;

  IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.rdv_balance_sweep_tokens(token_hash, expires_at)
  VALUES (v_hash, now() + INTERVAL '15 minutes');

  DELETE FROM public.rdv_balance_sweep_tokens
  WHERE expires_at < now() - INTERVAL '1 day'
     OR used_at < now() - INTERVAL '1 day';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('sweepToken', v_token),
    timeout_milliseconds := 20000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_rdv_balance_sweep() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'mediumia-rdv-balance-hourly' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'mediumia-rdv-balance-hourly',
    '5 * * * *',
    'SELECT public.dispatch_rdv_balance_sweep();'
  );
END;
$$;
