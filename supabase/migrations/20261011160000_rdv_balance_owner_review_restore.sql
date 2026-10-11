-- MediumIA RDV — solde des visios : alerte et décision du propriétaire avant
-- toute annulation automatique (P0), puis procédure « Rétablir » avec un
-- nouveau lien de solde exact (P1). Issue GitHub #147.
--
-- Principes :
--   * Les garde-fous sont en base : le cron Vercel ET l'action « sweep » passent
--     par claim_rdv_balance_auto_cancel, qui refuse désormais d'annuler sous
--     incertitude (paiement PayPal engagé, paiement externe enregistré),
--     sans alerte préalable du propriétaire, ou contre sa décision.
--   * Politique commerciale inchangée par défaut (auto_cancel_mode = 'auto') :
--     un impayé confirmé, signalé au propriétaire au moins 6 h avant, reste
--     annulé par le cron sauf décision « Maintenir ».
--   * Aucune réservation n'est modifiée par cette migration.

-- ── 1. Colonnes de suivi sur les réservations ─────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS balance_owner_decision TEXT,
  ADD COLUMN IF NOT EXISTS balance_owner_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_owner_decision_by UUID,
  ADD COLUMN IF NOT EXISTS balance_owner_decision_note TEXT,
  ADD COLUMN IF NOT EXISTS balance_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS balance_review_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_late_payment_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_restored_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_balance_owner_decision_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_balance_owner_decision_check
      CHECK (balance_owner_decision IS NULL OR balance_owner_decision IN ('hold', 'cancel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_balance_late_payment_before_start_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_balance_late_payment_before_start_check
      CHECK (balance_late_payment_until IS NULL OR balance_late_payment_until < starts_at);
  END IF;
END $$;

-- ── 2. Réglages (politique inchangée par défaut) ──────────────────────────
ALTER TABLE public.rdv_balance_runtime_settings
  ADD COLUMN IF NOT EXISTS auto_cancel_mode TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS require_owner_alert BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_alert_min_lead_hours INTEGER NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rdv_balance_runtime_settings_mode_check') THEN
    ALTER TABLE public.rdv_balance_runtime_settings ADD CONSTRAINT rdv_balance_runtime_settings_mode_check
      CHECK (auto_cancel_mode IN ('auto', 'owner_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rdv_balance_runtime_settings_lead_check') THEN
    ALTER TABLE public.rdv_balance_runtime_settings ADD CONSTRAINT rdv_balance_runtime_settings_lead_check
      CHECK (owner_alert_min_lead_hours BETWEEN 0 AND 72);
  END IF;
END $$;

-- ── 3. Alertes propriétaire (une par réservation et par type) ─────────────
CREATE TABLE IF NOT EXISTS public.rdv_balance_owner_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pre_cancel', 'review')),
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'failed')),
  reason TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  email_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, kind),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
ALTER TABLE public.rdv_balance_owner_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_owner_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rdv_balance_owner_alerts TO service_role;
-- Type « restore » : rétablissement interrompu ou abandonné (une alerte par visio).
ALTER TABLE public.rdv_balance_owner_alerts DROP CONSTRAINT IF EXISTS rdv_balance_owner_alerts_kind_check;
ALTER TABLE public.rdv_balance_owner_alerts ADD CONSTRAINT rdv_balance_owner_alerts_kind_check
  CHECK (kind IN ('pre_cancel', 'review', 'restore'));

-- ── 4. Journal des décisions et contrôles ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rdv_balance_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  event TEXT NOT NULL,
  actor UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rdv_balance_review_events_booking
  ON public.rdv_balance_review_events(booking_id, created_at DESC);
ALTER TABLE public.rdv_balance_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_review_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.rdv_balance_review_events TO service_role;

-- ── 5. Restaurations (idempotentes, compensables) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.rdv_balance_restorations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'google_pending'
    CHECK (status IN ('google_pending', 'completed', 'compensated')),
  previous JSONB NOT NULL,
  late_until TIMESTAMPTZ NOT NULL,
  due_cents INTEGER NOT NULL CHECK (due_cents > 0),
  google_status TEXT,
  email_status TEXT,
  actor UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rdv_balance_restorations_pending
  ON public.rdv_balance_restorations(booking_id) WHERE status = 'google_pending';
ALTER TABLE public.rdv_balance_restorations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_balance_restorations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rdv_balance_restorations TO service_role;
-- Reprise après interruption (coupure, délai dépassé, Google incertain).
ALTER TABLE public.rdv_balance_restorations
  ADD COLUMN IF NOT EXISTS resume_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

-- ── 6. Paiement externe déjà enregistré pour ce rendez-vous ───────────────
-- Un paiement manuel non rattaché (facture PayPal, virement) saisi pour le
-- même client et la même heure : on ne peut ni annuler ni rétablir sans revue.
CREATE OR REPLACE FUNCTION public.rdv_balance_external_payment_cents(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(CASE e.direction WHEN 'income' THEN e.gross_cents ELSE -e.gross_cents END), 0)::INTEGER
  FROM public.rdv_financial_entries e
  JOIN public.bookings b ON b.id = p_booking_id
  WHERE e.booking_id IS NULL
    AND e.appointment_starts_at = b.starts_at
    AND b.customer_email IS NOT NULL
    AND lower(e.customer_email) = lower(b.customer_email);
$$;
REVOKE ALL ON FUNCTION public.rdv_balance_external_payment_cents(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_balance_external_payment_cents(UUID) TO service_role;

-- ── 7. Garde d'annulation : NULL = annulation permise, sinon motif ────────
CREATE OR REPLACE FUNCTION public.rdv_balance_cancel_blocker(p_booking_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_settings public.rdv_balance_runtime_settings;
  v_payment public.rdv_balance_payments;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 'booking_not_found'; END IF;
  SELECT * INTO v_settings FROM public.rdv_balance_runtime_settings WHERE singleton = true;

  IF v_booking.balance_owner_decision = 'hold' THEN RETURN 'owner_hold'; END IF;
  IF v_booking.balance_late_payment_until IS NOT NULL AND p_now < v_booking.balance_late_payment_until THEN
    RETURN 'late_payment_window';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_balance_restorations r WHERE r.booking_id = v_booking.id AND r.status = 'google_pending') THEN
    RETURN 'restore_pending';
  END IF;

  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE booking_id = v_booking.id;
  IF v_payment.id IS NOT NULL AND v_payment.status IN ('captured', 'capture_in_progress') THEN RETURN 'payment_uncertain'; END IF;
  IF v_payment.id IS NOT NULL AND v_payment.status = 'order_pending' AND v_payment.updated_at > p_now - INTERVAL '30 minutes' THEN
    RETURN 'payment_in_progress';
  END IF;
  IF public.rdv_balance_external_payment_cents(v_booking.id) > 0 THEN RETURN 'external_payment_recorded'; END IF;

  IF v_booking.balance_owner_decision IS DISTINCT FROM 'cancel' THEN
    IF v_payment.id IS NOT NULL AND v_payment.status = 'order_pending' AND v_payment.paypal_order_id IS NOT NULL THEN
      RETURN 'payment_uncertain';
    END IF;
    IF COALESCE(v_settings.auto_cancel_mode, 'auto') = 'owner_review' THEN
      RETURN 'awaiting_owner_decision';
    END IF;
    IF COALESCE(v_settings.require_owner_alert, true) AND NOT EXISTS (
      SELECT 1 FROM public.rdv_balance_owner_alerts a
      WHERE a.booking_id = v_booking.id
        AND a.kind = 'pre_cancel'
        AND a.status = 'sent'
        AND a.sent_at <= p_now - make_interval(hours => COALESCE(v_settings.owner_alert_min_lead_hours, 6))
    ) THEN
      RETURN 'owner_not_alerted';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rdv_balance_cancel_blocker(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_balance_cancel_blocker(UUID, TIMESTAMPTZ) TO service_role;

-- ── 8. Annulation automatique : mêmes contrôles qu'avant + garde ──────────
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
  v_blocker TEXT;
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

  v_blocker := public.rdv_balance_cancel_blocker(v_booking.id, p_now);
  IF v_blocker IS NOT NULL THEN
    IF v_booking.balance_review_reason IS DISTINCT FROM v_blocker THEN
      UPDATE public.bookings
      SET balance_review_reason = v_blocker, balance_review_flagged_at = p_now, updated_at = now()
      WHERE id = v_booking.id;
      INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
      VALUES (v_booking.id, 'auto_cancel_blocked', jsonb_build_object('reason', v_blocker, 'at', p_now));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_blocked', 'reason', v_blocker);
  END IF;

  UPDATE public.bookings
  SET balance_cancel_claimed_at = p_now, updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_auto_cancel(p_booking_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_paid INTEGER;
  v_blocker TEXT;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  PERFORM 1 FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.balance_cancel_claimed_at IS NULL
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_no_longer_due_for_balance_cancel');
  END IF;

  v_blocker := public.rdv_balance_cancel_blocker(v_booking.id, p_now);
  IF v_blocker IS NOT NULL THEN
    INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
    VALUES (v_booking.id, 'auto_cancel_aborted', jsonb_build_object('reason', v_blocker, 'at', p_now));
    RETURN jsonb_build_object('ok', false, 'error', 'booking_no_longer_due_for_balance_cancel', 'reason', v_blocker);
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

  INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
  VALUES (v_booking.id, 'auto_cancelled', jsonb_build_object('at', p_now, 'decision', v_booking.balance_owner_decision));

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rdv_balance_auto_cancel(UUID, TIMESTAMPTZ) TO service_role;

-- ── 9. Alertes propriétaire : réservation et clôture idempotentes ─────────
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_owner_alert(p_booking_id UUID, p_kind TEXT, p_reason TEXT, p_now TIMESTAMPTZ DEFAULT now())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.rdv_balance_owner_alerts(booking_id, kind, reason, claimed_at)
  VALUES (p_booking_id, p_kind, p_reason, p_now)
  ON CONFLICT (booking_id, kind) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN true; END IF;

  UPDATE public.rdv_balance_owner_alerts
  SET status = 'claimed', reason = p_reason, claimed_at = p_now, updated_at = now()
  WHERE booking_id = p_booking_id AND kind = p_kind
    AND status = 'failed' AND updated_at < p_now - INTERVAL '1 hour'
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_owner_alert(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_owner_alert(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_rdv_balance_owner_alert(p_booking_id UUID, p_kind TEXT, p_status TEXT, p_email_id TEXT, p_now TIMESTAMPTZ DEFAULT now())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('sent', 'failed') THEN RETURN false; END IF;
  UPDATE public.rdv_balance_owner_alerts
  SET status = p_status,
      sent_at = CASE WHEN p_status = 'sent' THEN p_now ELSE sent_at END,
      email_id = COALESCE(p_email_id, email_id),
      updated_at = now()
  WHERE booking_id = p_booking_id AND kind = p_kind AND status = 'claimed';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_rdv_balance_owner_alert(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_rdv_balance_owner_alert(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── 10. Décision du propriétaire (Maintenir / Approuver l'annulation / Lever) ─
CREATE OR REPLACE FUNCTION public.set_rdv_balance_owner_decision(
  p_booking_id UUID, p_practitioner_id UUID, p_actor UUID, p_decision TEXT, p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  IF p_actor IS NULL OR (p_decision IS NOT NULL AND p_decision NOT IN ('hold', 'cancel')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND practitioner_id = p_practitioner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR v_booking.booking_source <> 'mediumia' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_confirmed');
  END IF;
  IF v_booking.balance_cancel_claimed_at IS NOT NULL AND v_booking.balance_cancel_claimed_at > now() - INTERVAL '15 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;
  IF v_booking.balance_owner_decision IS NOT DISTINCT FROM p_decision THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'decision', p_decision);
  END IF;

  UPDATE public.bookings
  SET balance_owner_decision = p_decision,
      balance_owner_decision_at = now(),
      balance_owner_decision_by = p_actor,
      balance_owner_decision_note = left(p_note, 500),
      updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO public.rdv_balance_review_events(booking_id, event, actor, detail)
  VALUES (v_booking.id, 'owner_decision', p_actor,
          jsonb_build_object('from', v_booking.balance_owner_decision, 'to', p_decision, 'note', left(p_note, 500)));

  RETURN jsonb_build_object('ok', true, 'replay', false, 'decision', p_decision);
END;
$$;
REVOKE ALL ON FUNCTION public.set_rdv_balance_owner_decision(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_rdv_balance_owner_decision(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- ── 11. Paiement du solde : fenêtre tardive après restauration ────────────
-- Seule la borne horaire change : COALESCE(fenêtre tardive, H-48).
CREATE OR REPLACE FUNCTION public.create_or_get_rdv_balance_payment(p_token_hash TEXT, p_client_checkout_id UUID, p_paypal_env TEXT)
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

  IF v_booking.balance_cancel_claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;

  IF v_booking.balance_payment_token_expires_at IS NULL
     OR now() >= v_booking.balance_payment_token_expires_at
     OR now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours') THEN
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
    IF v_payment.status = 'order_pending' AND v_payment.paypal_order_id IS NULL THEN
      UPDATE public.rdv_balance_payments SET updated_at = now() WHERE id = v_payment.id;
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
     OR now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours')
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

-- ── 12. Restauration : contrôle commun (vue admin + procédure) ────────────
CREATE OR REPLACE FUNCTION public.rdv_balance_restore_blocker(p_booking_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_pract public.booking_practitioners;
  v_deposit public.rdv_paypal_payments;
  v_deposit_id UUID;
  v_balance public.rdv_balance_payments;
  v_paid INTEGER;
  v_before INTERVAL;
  v_after INTERVAL;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 'booking_not_found'; END IF;
  IF v_booking.status <> 'cancelled' OR v_booking.cancel_reason IS DISTINCT FROM 'balance_unpaid_48h'
     OR v_booking.balance_auto_cancelled_at IS NULL THEN
    RETURN 'not_balance_auto_cancelled';
  END IF;
  IF v_booking.booking_source <> 'mediumia' THEN RETURN 'not_mediumia_booking'; END IF;
  IF v_booking.starts_at <= p_now + INTERVAL '90 minutes' THEN RETURN 'too_close_to_start'; END IF;
  IF v_booking.booked_price_cents IS NULL THEN RETURN 'booking_without_price'; END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN RETURN 'balance_video_only'; END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_paid <= 0 THEN RETURN 'no_deposit_recorded'; END IF;
  IF v_booking.booked_price_cents - v_paid <= 0 THEN RETURN 'nothing_due'; END IF;

  v_deposit_id := public.rdv_booking_deposit_payment_id(v_booking.id);
  IF v_deposit_id IS NULL THEN RETURN 'no_paypal_deposit'; END IF;
  SELECT * INTO v_deposit FROM public.rdv_paypal_payments WHERE id = v_deposit_id;
  IF v_deposit.settlement_status <> 'open' OR v_deposit.refunded_cents <> 0 THEN RETURN 'deposit_settled'; END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_deposit_transfers t WHERE t.source_booking_id = v_booking.id OR t.payment_id = v_deposit_id) THEN
    RETURN 'deposit_transferred';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_payment_refunds r WHERE r.booking_id = v_booking.id OR r.payment_id = v_deposit_id) THEN
    RETURN 'refund_exists';
  END IF;
  IF public.rdv_balance_external_payment_cents(v_booking.id) <> 0 THEN RETURN 'external_payment_recorded'; END IF;

  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = v_booking.id;
  IF v_balance.id IS NOT NULL AND v_balance.status IN ('captured', 'capture_in_progress') THEN RETURN 'balance_payment_in_progress'; END IF;

  SELECT * INTO v_pract FROM public.booking_practitioners WHERE id = v_booking.practitioner_id;
  v_before := COALESCE(v_pract.buffer_before_min, 0) * INTERVAL '1 minute';
  v_after := COALESCE(v_pract.buffer_after_min, 0) * INTERVAL '1 minute';

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = v_booking.practitioner_id AND b.id <> v_booking.id
      AND b.status = 'confirmed'
      AND b.starts_at < v_booking.ends_at + v_after
      AND b.ends_at > v_booking.starts_at - v_before
  ) THEN RETURN 'slot_booked'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = v_booking.practitioner_id
      AND (h.status IN ('payment_capturing', 'payment_captured')
           OR (h.status = 'payment_pending' AND h.expires_at > p_now))
      AND h.starts_at < v_booking.ends_at + v_after
      AND h.ends_at > v_booking.starts_at - v_before
  ) THEN RETURN 'slot_held'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_slot_offers o
    WHERE o.practitioner_id = v_booking.practitioner_id
      AND o.status = 'open' AND o.expires_at > p_now
      AND o.starts_at < v_booking.ends_at + v_after
      AND o.ends_at > v_booking.starts_at - v_before
  ) THEN RETURN 'slot_offered'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_exceptions x
    WHERE x.practitioner_id = v_booking.practitioner_id
      AND x.exception_date = (v_booking.starts_at AT TIME ZONE 'Europe/Paris')::date
  ) THEN RETURN 'calendar_exception_on_date'; END IF;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.rdv_balance_restore_blocker(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_balance_restore_blocker(UUID, TIMESTAMPTZ) TO service_role;

-- ── 13. Restauration (verrou praticien, idempotence, audit) ───────────────
CREATE OR REPLACE FUNCTION public.restore_rdv_balance_cancelled_booking(
  p_booking_id UUID,
  p_practitioner_id UUID,
  p_actor UUID,
  p_idempotency_key UUID,
  p_token_hash TEXT,
  p_late_until TIMESTAMPTZ,
  p_paypal_env TEXT,
  p_no_external_payment_confirmed BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_existing public.rdv_balance_restorations;
  v_deposit public.rdv_paypal_payments;
  v_balance public.rdv_balance_payments;
  v_blocker TEXT;
  v_paid INTEGER;
  v_due INTEGER;
  v_restoration_id UUID;
BEGIN
  IF p_actor IS NULL OR p_idempotency_key IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_paypal_env NOT IN ('sandbox', 'live') OR p_late_until IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_restore_request');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT * INTO v_existing FROM public.rdv_balance_restorations WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.booking_id <> p_booking_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_reused');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'restoration_id', v_existing.id, 'status', v_existing.status);
  END IF;

  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND practitioner_id = p_practitioner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_blocker := public.rdv_balance_restore_blocker(v_booking.id, now());
  IF v_blocker IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_blocker); END IF;
  IF NOT COALESCE(p_no_external_payment_confirmed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'external_payment_confirmation_required');
  END IF;
  IF p_late_until <= now() + INTERVAL '10 minutes' OR p_late_until > v_booking.starts_at - INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_late_window');
  END IF;

  SELECT * INTO v_deposit FROM public.rdv_paypal_payments WHERE id = public.rdv_booking_deposit_payment_id(v_booking.id);
  IF v_deposit.paypal_env <> p_paypal_env THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paypal_env_mismatch');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := v_booking.booked_price_cents - v_paid;

  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE;
  IF v_balance.id IS NOT NULL THEN
    UPDATE public.rdv_balance_payments
    SET status = 'order_pending', paypal_order_id = NULL, capture_claimed_at = NULL,
        client_checkout_id = gen_random_uuid(), paypal_env = p_paypal_env,
        amount_cents = v_due, last_error_code = 'reset_by_restore', updated_at = now()
    WHERE id = v_balance.id;
  END IF;

  INSERT INTO public.rdv_balance_restorations(booking_id, idempotency_key, previous, late_until, due_cents, actor)
  VALUES (
    v_booking.id, p_idempotency_key,
    jsonb_build_object(
      'cancelled_at', v_booking.cancelled_at,
      'cancel_reason', v_booking.cancel_reason,
      'balance_auto_cancelled_at', v_booking.balance_auto_cancelled_at,
      'balance_owner_decision', v_booking.balance_owner_decision,
      'previous_balance_order', CASE WHEN v_balance.id IS NULL THEN NULL ELSE jsonb_build_object('status', v_balance.status, 'paypal_order_id', v_balance.paypal_order_id) END
    ),
    p_late_until, v_due, p_actor
  ) RETURNING id INTO v_restoration_id;

  UPDATE public.bookings
  SET status = 'confirmed',
      cancelled_at = NULL,
      cancel_reason = NULL,
      balance_cancel_claimed_at = NULL,
      balance_payment_token_hash = p_token_hash,
      balance_payment_token_expires_at = p_late_until,
      balance_late_payment_until = p_late_until,
      balance_restored_at = now(),
      balance_owner_decision = 'hold',
      balance_owner_decision_at = now(),
      balance_owner_decision_by = p_actor,
      balance_owner_decision_note = 'restored',
      balance_review_reason = NULL,
      balance_review_flagged_at = NULL,
      updated_at = now()
  WHERE id = v_booking.id;

  INSERT INTO public.rdv_balance_review_events(booking_id, event, actor, detail)
  VALUES (v_booking.id, 'restore_started', p_actor,
          jsonb_build_object('restoration_id', v_restoration_id, 'due_cents', v_due, 'late_until', p_late_until));

  RETURN jsonb_build_object(
    'ok', true, 'replay', false, 'restoration_id', v_restoration_id,
    'due_cents', v_due, 'paid_cents', v_paid, 'price_cents', v_booking.booked_price_cents,
    'starts_at', v_booking.starts_at, 'ends_at', v_booking.ends_at, 'late_until', p_late_until,
    'google_event_id', v_booking.google_event_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.restore_rdv_balance_cancelled_booking(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_rdv_balance_cancelled_booking(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_rdv_balance_restore(p_restoration_id UUID, p_google_status TEXT, p_google_event_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.rdv_balance_restorations;
BEGIN
  SELECT * INTO v_row FROM public.rdv_balance_restorations WHERE id = p_restoration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_found'); END IF;
  IF v_row.status = 'completed' THEN RETURN jsonb_build_object('ok', true, 'replay', true); END IF;
  IF v_row.status <> 'google_pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_pending'); END IF;

  UPDATE public.rdv_balance_restorations
  SET status = 'completed', google_status = left(p_google_status, 40), google_event_id = p_google_event_id,
      resume_claimed_at = NULL, last_error = NULL, updated_at = now()
  WHERE id = v_row.id;
  IF p_google_event_id IS NOT NULL THEN
    UPDATE public.bookings SET google_event_id = p_google_event_id, updated_at = now() WHERE id = v_row.booking_id;
  END IF;
  INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
  VALUES (v_row.booking_id, 'restore_completed', jsonb_build_object('restoration_id', v_row.id, 'google_status', p_google_status, 'attempts', v_row.attempts));
  RETURN jsonb_build_object('ok', true, 'replay', false);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_rdv_balance_restore(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rdv_balance_restore(UUID, TEXT, TEXT) TO service_role;

-- Échec Google : retour à l'état annulé tant qu'aucun paiement n'a commencé
-- (le lien n'a jamais été montré : il n'est rendu qu'après succès).
CREATE OR REPLACE FUNCTION public.compensate_rdv_balance_restore(p_restoration_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.rdv_balance_restorations;
  v_balance public.rdv_balance_payments;
BEGIN
  SELECT * INTO v_row FROM public.rdv_balance_restorations WHERE id = p_restoration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_found'); END IF;
  IF v_row.status = 'compensated' THEN RETURN jsonb_build_object('ok', true, 'replay', true); END IF;
  IF v_row.status <> 'google_pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_pending'); END IF;

  PERFORM 1 FROM public.bookings WHERE id = v_row.booking_id FOR UPDATE;
  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = v_row.booking_id;
  IF v_balance.id IS NOT NULL AND (v_balance.paypal_order_id IS NOT NULL OR v_balance.status <> 'order_pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_started_manual_review');
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_at = (v_row.previous->>'cancelled_at')::timestamptz,
      cancel_reason = v_row.previous->>'cancel_reason',
      balance_auto_cancelled_at = (v_row.previous->>'balance_auto_cancelled_at')::timestamptz,
      balance_payment_token_hash = NULL,
      balance_payment_token_expires_at = NULL,
      balance_late_payment_until = NULL,
      balance_restored_at = NULL,
      balance_owner_decision = v_row.previous->>'balance_owner_decision',
      balance_owner_decision_note = 'restore_compensated',
      balance_owner_decision_at = now(),
      updated_at = now()
  WHERE id = v_row.booking_id;

  UPDATE public.rdv_balance_restorations
  SET status = 'compensated', google_status = left(p_reason, 40), updated_at = now()
  WHERE id = v_row.id;
  INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
  VALUES (v_row.booking_id, 'restore_compensated', jsonb_build_object('restoration_id', v_row.id, 'reason', left(p_reason, 80)));
  RETURN jsonb_build_object('ok', true, 'replay', false);
END;
$$;
REVOKE ALL ON FUNCTION public.compensate_rdv_balance_restore(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compensate_rdv_balance_restore(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_rdv_balance_restore_email(p_restoration_id UUID, p_email_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.rdv_balance_restorations
  SET email_status = left(p_email_status, 40), updated_at = now()
  WHERE id = p_restoration_id
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.record_rdv_balance_restore_email(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rdv_balance_restore_email(UUID, TEXT) TO service_role;

-- Nouveau lien (jeton unique) pour un rendez-vous rétabli encore dû.
CREATE OR REPLACE FUNCTION public.rotate_rdv_balance_restore_token(
  p_booking_id UUID, p_practitioner_id UUID, p_actor UUID, p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_balance public.rdv_balance_payments;
  v_paid INTEGER;
  v_due INTEGER;
BEGIN
  IF p_actor IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rotate_request');
  END IF;
  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND practitioner_id = p_practitioner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR v_booking.balance_restored_at IS NULL
     OR v_booking.balance_late_payment_until IS NULL OR now() >= v_booking.balance_late_payment_until THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_restored_or_window_closed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_balance_restorations r WHERE r.booking_id = v_booking.id AND r.status = 'google_pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'restoration_pending');
  END IF;
  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := GREATEST(COALESCE(v_booking.booked_price_cents, 0) - v_paid, 0);
  IF v_due <= 0 OR v_booking.balance_paid_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_due'); END IF;
  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = v_booking.id;
  IF v_balance.id IS NOT NULL AND v_balance.status IN ('captured', 'capture_in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_in_progress');
  END IF;

  UPDATE public.bookings
  SET balance_payment_token_hash = p_token_hash,
      balance_payment_token_expires_at = v_booking.balance_late_payment_until,
      updated_at = now()
  WHERE id = v_booking.id;
  INSERT INTO public.rdv_balance_review_events(booking_id, event, actor, detail)
  VALUES (v_booking.id, 'restore_link_rotated', p_actor, jsonb_build_object('due_cents', v_due));
  RETURN jsonb_build_object('ok', true, 'due_cents', v_due, 'late_until', v_booking.balance_late_payment_until,
                            'starts_at', v_booking.starts_at);
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_rdv_balance_restore_token(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_rdv_balance_restore_token(UUID, UUID, UUID, TEXT) TO service_role;

-- ── 14. Vue « soldes à surveiller » pour le tableau de bord (lecture seule) ─
CREATE OR REPLACE FUNCTION public.rdv_balance_watch(p_practitioner_id UUID, p_now TIMESTAMPTZ DEFAULT now(), p_horizon_days INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT b.*, s.title AS service_title,
           public.rdv_booking_paid_cents(b.id) AS paid_cents
    FROM public.bookings b
    JOIN public.booking_services s ON s.id = b.service_id
    WHERE b.practitioner_id = p_practitioner_id
      AND b.booking_source = 'mediumia'
      AND 'video' = ANY(s.modality)
      AND b.starts_at > p_now
      AND b.starts_at <= p_now + make_interval(days => LEAST(GREATEST(p_horizon_days, 1), 30))
      AND (
        (b.status = 'confirmed' AND b.balance_paid_at IS NULL AND COALESCE(b.booked_price_cents, 0) > 0
          AND COALESCE(b.reservation_payment_cents, 0) > 0)
        OR (b.status = 'cancelled' AND b.cancel_reason = 'balance_unpaid_48h')
      )
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'booking_id', base.id,
    'status', base.status,
    'customer_name', trim(coalesce(base.customer_first_name, '') || ' ' || coalesce(base.customer_last_name, '')),
    'service_title', base.service_title,
    'starts_at', base.starts_at,
    'cancel_deadline_at', base.starts_at - INTERVAL '48 hours',
    'price_cents', base.booked_price_cents,
    'paid_cents', base.paid_cents,
    'due_cents', GREATEST(COALESCE(base.booked_price_cents, 0) - base.paid_cents, 0),
    'external_payment_cents', public.rdv_balance_external_payment_cents(base.id),
    'balance_reminder_sent_at', base.balance_reminder_sent_at,
    'balance_link_valid', (base.balance_payment_token_hash IS NOT NULL AND base.balance_payment_token_expires_at > p_now),
    'balance_link_expires_at', base.balance_payment_token_expires_at,
    'late_payment_until', base.balance_late_payment_until,
    'restored_at', base.balance_restored_at,
    'owner_decision', base.balance_owner_decision,
    'owner_decision_at', base.balance_owner_decision_at,
    'review_reason', base.balance_review_reason,
    'review_flagged_at', base.balance_review_flagged_at,
    'auto_cancelled_at', base.balance_auto_cancelled_at,
    'balance_payment', (SELECT jsonb_build_object('status', p.status, 'has_order', p.paypal_order_id IS NOT NULL, 'updated_at', p.updated_at, 'env', p.paypal_env)
                        FROM public.rdv_balance_payments p WHERE p.booking_id = base.id),
    'pre_cancel_alert', (SELECT jsonb_build_object('status', a.status, 'sent_at', a.sent_at)
                         FROM public.rdv_balance_owner_alerts a WHERE a.booking_id = base.id AND a.kind = 'pre_cancel'),
    'cancel_blocker', CASE WHEN base.status = 'confirmed' THEN public.rdv_balance_cancel_blocker(base.id, p_now) END,
    'restore_blocker', CASE WHEN base.status = 'cancelled' THEN public.rdv_balance_restore_blocker(base.id, p_now) END,
    'restoration', (SELECT jsonb_build_object('id', r.id, 'status', r.status, 'attempts', r.attempts, 'last_error', r.last_error, 'created_at', r.created_at)
                    FROM public.rdv_balance_restorations r WHERE r.booking_id = base.id ORDER BY r.created_at DESC LIMIT 1)
  ) ORDER BY base.starts_at), '[]'::jsonb)
  FROM base;
$$;
REVOKE ALL ON FUNCTION public.rdv_balance_watch(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_balance_watch(UUID, TIMESTAMPTZ, INTEGER) TO service_role;

-- ── 15. Sérialisation paiement / annulation et reprise des restaurations ───
-- Une annulation revendiquée bloque toute création ou rattachement de commande
-- PayPal ; une restauration interrompue est reprise (verrou de reprise, journal).
CREATE OR REPLACE FUNCTION public.release_stale_rdv_balance_cancel_claims(p_now TIMESTAMPTZ DEFAULT now())
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.bookings
  SET balance_cancel_claimed_at = NULL, updated_at = now()
  WHERE status = 'confirmed'
    AND balance_cancel_claimed_at IS NOT NULL
    AND balance_cancel_claimed_at < p_now - INTERVAL '30 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.release_stale_rdv_balance_cancel_claims(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_rdv_balance_cancel_claims(TIMESTAMPTZ) TO service_role;
CREATE OR REPLACE FUNCTION public.attach_rdv_balance_paypal_order(p_payment_id UUID, p_paypal_order_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id UUID;
  v_booking public.bookings;
  v_payment public.rdv_balance_payments;
BEGIN
  IF p_payment_id IS NULL OR p_paypal_order_id IS NULL OR p_paypal_order_id !~ '^[A-Za-z0-9_-]{5,80}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_paypal_order');
  END IF;
  SELECT booking_id INTO v_booking_id FROM public.rdv_balance_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_not_found'); END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE id = p_payment_id FOR UPDATE;

  IF v_payment.paypal_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'paypal_order_id', v_payment.paypal_order_id, 'reused', true);
  END IF;
  IF v_booking.status <> 'confirmed' OR v_booking.balance_cancel_claimed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;
  IF v_payment.status <> 'order_pending'
     OR now() >= COALESCE(v_booking.balance_late_payment_until, v_booking.starts_at - INTERVAL '48 hours') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  END IF;

  UPDATE public.rdv_balance_payments
  SET paypal_order_id = p_paypal_order_id, last_error_code = NULL, updated_at = now()
  WHERE id = v_payment.id;
  RETURN jsonb_build_object('ok', true, 'paypal_order_id', p_paypal_order_id, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.attach_rdv_balance_paypal_order(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_rdv_balance_paypal_order(UUID, TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_restore_resume(p_restoration_id UUID, p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.rdv_balance_restorations;
BEGIN
  SELECT * INTO v_row FROM public.rdv_balance_restorations WHERE id = p_restoration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_found'); END IF;
  IF v_row.status <> 'google_pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'restoration_not_pending', 'status', v_row.status); END IF;
  IF v_row.resume_claimed_at IS NOT NULL AND v_row.resume_claimed_at > p_now - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'resume_in_progress');
  END IF;
  UPDATE public.rdv_balance_restorations
  SET resume_claimed_at = p_now, attempts = attempts + 1, updated_at = now()
  WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'restoration_id', v_row.id, 'booking_id', v_row.booking_id,
                            'attempts', v_row.attempts + 1, 'due_cents', v_row.due_cents, 'created_at', v_row.created_at);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_restore_resume(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_restore_resume(UUID, TIMESTAMPTZ) TO service_role;
CREATE OR REPLACE FUNCTION public.record_rdv_balance_restore_failure(p_restoration_id UUID, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.rdv_balance_restorations
  SET last_error = left(p_error, 80), resume_claimed_at = NULL, updated_at = now()
  WHERE id = p_restoration_id AND status = 'google_pending'
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.record_rdv_balance_restore_failure(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rdv_balance_restore_failure(UUID, TEXT) TO service_role;
