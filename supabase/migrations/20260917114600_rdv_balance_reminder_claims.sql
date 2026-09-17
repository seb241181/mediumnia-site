-- MediumIA RDV — durcissement idempotent des rappels de solde.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_reminder_claimed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_rdv_balance_reminder(
  p_booking_id UUID,
  p_token_hash TEXT,
  p_token_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count BIGINT := 0;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR p_token_expires_at <= p_now THEN
    RETURN false;
  END IF;

  UPDATE public.bookings
  SET balance_payment_token_hash = p_token_hash,
      balance_payment_token_expires_at = p_token_expires_at,
      balance_reminder_claimed_at = p_now,
      updated_at = now()
  WHERE id = p_booking_id
    AND status = 'confirmed'
    AND booking_source = 'mediumia'
    AND balance_reminder_sent_at IS NULL
    AND (
      balance_reminder_claimed_at IS NULL
      OR balance_reminder_claimed_at <= p_now - INTERVAL '15 minutes'
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_rdv_balance_reminder(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_reminder(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_reminder(
  p_booking_id UUID,
  p_token_hash TEXT,
  p_email_id TEXT,
  p_sent_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count BIGINT := 0;
BEGIN
  UPDATE public.bookings
  SET balance_reminder_sent_at = COALESCE(balance_reminder_sent_at, p_sent_at),
      balance_reminder_email_id = COALESCE(balance_reminder_email_id, p_email_id),
      balance_reminder_claimed_at = NULL,
      updated_at = now()
  WHERE id = p_booking_id
    AND balance_payment_token_hash = p_token_hash
    AND balance_reminder_sent_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_rdv_balance_reminder(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rdv_balance_reminder(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.release_rdv_balance_reminder(
  p_booking_id UUID,
  p_token_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.bookings
  SET balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      balance_reminder_claimed_at = NULL,
      updated_at = now()
  WHERE id = p_booking_id
    AND balance_payment_token_hash = p_token_hash
    AND balance_reminder_sent_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.release_rdv_balance_reminder(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_rdv_balance_reminder(UUID, TEXT) TO service_role;

-- Remplace la première version par une variante avec un compteur du bon type.
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
