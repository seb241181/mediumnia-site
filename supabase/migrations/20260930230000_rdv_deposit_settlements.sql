-- Arrhes des rendez-vous annulés : traitement explicite par l'administrateur.
--
-- Jusqu'ici, l'annulation d'un rendez-vous payé (lien client, annulation
-- automatique H-48) ne touchait ni au paiement PayPal ni à la comptabilité :
-- les arrhes restaient comptées en recette, sans aucun état « à traiter ».
--
-- Cette migration ajoute, sans jamais modifier une capture existante :
-- - un état de traitement par paiement (rdv_paypal_payments.settlement_status) :
--   open (encaissées, à traiter si le RDV est annulé), retained (conservées),
--   transferred (transférées), refund_pending (remboursement en cours ou à
--   vérifier), partially_refunded, refunded ;
-- - rdv_payment_refunds : une ligne par demande de remboursement PayPal
--   (pending / unknown / completed / failed), clé d'idempotence PayPal fixe ;
-- - rdv_deposit_transfers : transfert des arrhes vers un autre rendez-vous du
--   même client, sans nouvelle recette (deux écritures « deposit_transfer » qui
--   s'annulent : -X sur le RDV d'origine, +X sur le RDV cible) ;
-- - rdv_payment_settlement_events : journal d'audit (aucune donnée personnelle).
--
-- Annulation et remboursement restent deux opérations distinctes : rien ici
-- n'est déclenché par une annulation. Toutes les fonctions sont réservées au
-- service_role (appelées par l'API admin après vérification des droits).
-- Idempotente : peut être rejouée.

-- ── État de traitement par paiement ─────────────────────────────────────────

ALTER TABLE public.rdv_paypal_payments
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_updated_at TIMESTAMPTZ;

ALTER TABLE public.rdv_paypal_payments DROP CONSTRAINT IF EXISTS rdv_paypal_payments_settlement_status_check;
ALTER TABLE public.rdv_paypal_payments ADD CONSTRAINT rdv_paypal_payments_settlement_status_check
  CHECK (settlement_status IN ('open', 'retained', 'transferred', 'refund_pending', 'partially_refunded', 'refunded'));

ALTER TABLE public.rdv_paypal_payments DROP CONSTRAINT IF EXISTS rdv_paypal_payments_refunded_cents_check;
ALTER TABLE public.rdv_paypal_payments ADD CONSTRAINT rdv_paypal_payments_refunded_cents_check
  CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents);

-- Un état de traitement autre que « open » n'a de sens que sur une capture réelle.
ALTER TABLE public.rdv_paypal_payments DROP CONSTRAINT IF EXISTS rdv_paypal_payments_settlement_captured_check;
ALTER TABLE public.rdv_paypal_payments ADD CONSTRAINT rdv_paypal_payments_settlement_captured_check
  CHECK (settlement_status = 'open' OR (status = 'captured' AND paypal_capture_id IS NOT NULL));

-- Cohérence état / montant remboursé.
ALTER TABLE public.rdv_paypal_payments DROP CONSTRAINT IF EXISTS rdv_paypal_payments_settlement_amount_check;
ALTER TABLE public.rdv_paypal_payments ADD CONSTRAINT rdv_paypal_payments_settlement_amount_check
  CHECK (
    (settlement_status = 'refunded' AND refunded_cents = amount_cents)
    OR (settlement_status = 'partially_refunded' AND refunded_cents > 0 AND refunded_cents < amount_cents)
    OR (settlement_status IN ('open', 'retained', 'transferred') AND refunded_cents = 0)
    OR (settlement_status = 'refund_pending' AND refunded_cents < amount_cents)
  );

-- Grand livre : type d'écriture dédié aux transferts d'arrhes (paire -X/+X).
ALTER TABLE public.rdv_financial_entries DROP CONSTRAINT IF EXISTS rdv_financial_entries_entry_kind_check;
ALTER TABLE public.rdv_financial_entries ADD CONSTRAINT rdv_financial_entries_entry_kind_check
  CHECK (entry_kind IN ('arrhes', 'balance', 'full_payment', 'refund', 'arrhes_retained', 'adjustment', 'gift_card_sale', 'deposit_transfer'));

-- ── Remboursements ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rdv_payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.rdv_paypal_payments(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  paypal_env TEXT NOT NULL CHECK (paypal_env IN ('sandbox', 'live')),
  paypal_capture_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'unknown', 'completed', 'failed')),
  -- Clé d'idempotence envoyée à PayPal (PayPal-Request-Id) : fixée à la création,
  -- réutilisée telle quelle pour toute reprise : jamais de second remboursement.
  paypal_request_id TEXT NOT NULL UNIQUE,
  -- Clé d'idempotence de la demande admin (double clic, rejeu HTTP).
  idempotency_key UUID NOT NULL UNIQUE,
  paypal_refund_id TEXT UNIQUE,
  paypal_status TEXT,
  error_code TEXT,
  adopted_external BOOLEAN NOT NULL DEFAULT false,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ledger_entry_id UUID REFERENCES public.rdv_financial_entries(id) ON DELETE RESTRICT,
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'completed' OR (paypal_refund_id IS NOT NULL AND completed_at IS NOT NULL AND ledger_entry_id IS NOT NULL)),
  CHECK (status <> 'failed' OR failed_at IS NOT NULL)
);

-- Un seul remboursement actif (en cours ou à vérifier) par paiement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rdv_payment_refunds_one_active
  ON public.rdv_payment_refunds(payment_id)
  WHERE status IN ('pending', 'unknown');

CREATE INDEX IF NOT EXISTS idx_rdv_payment_refunds_booking
  ON public.rdv_payment_refunds(booking_id);

ALTER TABLE public.rdv_payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_payment_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rdv_payment_refunds TO service_role;

-- ── Transferts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rdv_deposit_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Un paiement ne peut être transféré qu'une fois, en totalité.
  payment_id UUID NOT NULL UNIQUE REFERENCES public.rdv_paypal_payments(id) ON DELETE RESTRICT,
  source_booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  target_booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  paypal_env TEXT NOT NULL CHECK (paypal_env IN ('sandbox', 'live')),
  paypal_capture_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
  idempotency_key UUID NOT NULL UNIQUE,
  source_ledger_entry_id UUID NOT NULL REFERENCES public.rdv_financial_entries(id) ON DELETE RESTRICT,
  target_ledger_entry_id UUID NOT NULL REFERENCES public.rdv_financial_entries(id) ON DELETE RESTRICT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_booking_id <> target_booking_id)
);

CREATE INDEX IF NOT EXISTS idx_rdv_deposit_transfers_target
  ON public.rdv_deposit_transfers(target_booking_id);

ALTER TABLE public.rdv_deposit_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_deposit_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rdv_deposit_transfers TO service_role;

-- ── Journal d'audit ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rdv_payment_settlement_events (
  id BIGSERIAL PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.rdv_paypal_payments(id) ON DELETE RESTRICT,
  refund_id UUID REFERENCES public.rdv_payment_refunds(id) ON DELETE RESTRICT,
  transfer_id UUID REFERENCES public.rdv_deposit_transfers(id) ON DELETE RESTRICT,
  event TEXT NOT NULL,
  actor UUID,
  -- Codes et montants uniquement : ni e-mail, ni nom, ni IP.
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rdv_payment_settlement_events_payment
  ON public.rdv_payment_settlement_events(payment_id, created_at);

ALTER TABLE public.rdv_payment_settlement_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_payment_settlement_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rdv_payment_settlement_events TO service_role;

-- ── Fonctions internes ──────────────────────────────────────────────────────

-- Paiement PayPal d'un rendez-vous (arrhes ou paiement intégral), via le hold.
CREATE OR REPLACE FUNCTION public.rdv_booking_deposit_payment_id(p_booking_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE h.converted_booking_id = p_booking_id
    AND p.status = 'captured'
    AND p.paypal_capture_id IS NOT NULL
  ORDER BY p.captured_at NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.rdv_booking_deposit_payment_id(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_booking_deposit_payment_id(UUID) TO service_role;

-- ── Conserver les arrhes (décision définitive, aucun mouvement d'argent) ────

CREATE OR REPLACE FUNCTION public.retain_rdv_deposit(
  p_booking_id UUID,
  p_practitioner_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_id UUID;
  v_payment public.rdv_paypal_payments;
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND practitioner_id = p_practitioner_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_payment_id := public.rdv_booking_deposit_payment_id(p_booking_id);
  IF v_payment_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_paypal_deposit'); END IF;

  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE id = v_payment_id FOR UPDATE;
  IF v_payment.settlement_status = 'retained' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'settlement_status', 'retained');
  END IF;
  IF v_booking.status <> 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_cancelled'); END IF;
  IF v_payment.settlement_status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'settlement_not_open', 'settlement_status', v_payment.settlement_status);
  END IF;

  UPDATE public.rdv_paypal_payments
  SET settlement_status = 'retained', settlement_updated_at = now()
  WHERE id = v_payment.id;

  INSERT INTO public.rdv_payment_settlement_events(payment_id, event, actor, detail)
  VALUES (v_payment.id, 'retained', p_actor, jsonb_build_object('amount_cents', v_payment.amount_cents));

  RETURN jsonb_build_object('ok', true, 'settlement_status', 'retained');
END;
$$;

REVOKE ALL ON FUNCTION public.retain_rdv_deposit(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retain_rdv_deposit(UUID, UUID, UUID) TO service_role;

-- ── Demande de remboursement (réservation atomique, avant tout appel PayPal) ─
--
-- Retours :
-- - {ok:true, refund:{…}, replay:false}  → l'API peut appeler PayPal avec
--   refund.paypal_request_id (et uniquement celui-ci) ;
-- - {ok:true, refund:{…}, replay:true}   → même idempotency_key déjà vue :
--   on renvoie la demande existante, sans nouvelle tentative ;
-- - {ok:false, error:'refund_in_progress', refund:{…}} → un remboursement est
--   déjà en cours ou à vérifier : réconciliation obligatoire avant toute reprise.

CREATE OR REPLACE FUNCTION public.begin_rdv_payment_refund(
  p_booking_id UUID,
  p_practitioner_id UUID,
  p_amount_cents INTEGER,
  p_paypal_env TEXT,
  p_idempotency_key UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_id UUID;
  v_payment public.rdv_paypal_payments;
  v_booking public.bookings;
  v_order_id TEXT;
  v_refund public.rdv_payment_refunds;
  v_amount INTEGER;
  v_remaining INTEGER;
  v_id UUID := gen_random_uuid();
BEGIN
  IF p_idempotency_key IS NULL OR p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_refund_request');
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id AND practitioner_id = p_practitioner_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_payment_id := public.rdv_booking_deposit_payment_id(p_booking_id);
  IF v_payment_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_paypal_deposit'); END IF;

  -- Verrou du paiement : sérialise double clic, rejeu et transfert concurrent.
  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE id = v_payment_id FOR UPDATE;
  v_order_id := v_payment.paypal_order_id;

  -- Rejeu de la même demande (double clic, requête renvoyée) : même réponse.
  SELECT * INTO v_refund FROM public.rdv_payment_refunds WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_refund.payment_id <> v_payment.id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_reused');
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'refund', to_jsonb(v_refund) || jsonb_build_object('paypal_order_id', v_order_id));
  END IF;

  -- Séparation stricte sandbox / live : jamais d'appel vers l'autre environnement.
  IF v_payment.paypal_env <> p_paypal_env THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paypal_environment_mismatch');
  END IF;

  SELECT * INTO v_refund FROM public.rdv_payment_refunds
  WHERE payment_id = v_payment.id AND status IN ('pending', 'unknown');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_in_progress', 'refund', to_jsonb(v_refund) || jsonb_build_object('paypal_order_id', v_order_id));
  END IF;

  IF v_booking.status <> 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_cancelled'); END IF;
  IF v_payment.settlement_status = 'refunded' THEN RETURN jsonb_build_object('ok', false, 'error', 'already_refunded'); END IF;
  IF v_payment.settlement_status NOT IN ('open', 'partially_refunded') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'settlement_not_open', 'settlement_status', v_payment.settlement_status);
  END IF;

  v_remaining := v_payment.amount_cents - v_payment.refunded_cents;
  v_amount := COALESCE(p_amount_cents, v_remaining);
  IF v_amount <= 0 OR v_amount > v_remaining THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_amount_invalid', 'remaining_cents', v_remaining);
  END IF;

  INSERT INTO public.rdv_payment_refunds(
    id, payment_id, booking_id, practitioner_id, paypal_env, paypal_capture_id,
    amount_cents, currency, status, paypal_request_id, idempotency_key, requested_by
  ) VALUES (
    v_id, v_payment.id, v_booking.id, v_booking.practitioner_id, v_payment.paypal_env, v_payment.paypal_capture_id,
    v_amount, 'EUR', 'pending', 'rdv-refund-' || v_id::text, p_idempotency_key, p_actor
  ) RETURNING * INTO v_refund;

  UPDATE public.rdv_paypal_payments
  SET settlement_status = 'refund_pending', settlement_updated_at = now()
  WHERE id = v_payment.id;

  INSERT INTO public.rdv_payment_settlement_events(payment_id, refund_id, event, actor, detail)
  VALUES (v_payment.id, v_refund.id, 'refund_requested', p_actor,
          jsonb_build_object('amount_cents', v_amount, 'paypal_env', v_payment.paypal_env));

  RETURN jsonb_build_object('ok', true, 'replay', false, 'refund', to_jsonb(v_refund) || jsonb_build_object('paypal_order_id', v_order_id));
END;
$$;

REVOKE ALL ON FUNCTION public.begin_rdv_payment_refund(UUID, UUID, INTEGER, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_rdv_payment_refund(UUID, UUID, INTEGER, TEXT, UUID, UUID) TO service_role;

-- Marque une tentative d'appel PayPal (avant l'envoi), pour l'audit et pour
-- savoir depuis quand une réponse est attendue.
CREATE OR REPLACE FUNCTION public.mark_rdv_payment_refund_attempt(p_refund_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.rdv_payment_refunds;
BEGIN
  UPDATE public.rdv_payment_refunds
  SET attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
  WHERE id = p_refund_id AND status IN ('pending', 'unknown')
  RETURNING * INTO v_refund;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'refund_not_active'); END IF;
  INSERT INTO public.rdv_payment_settlement_events(payment_id, refund_id, event, detail)
  VALUES (v_refund.payment_id, v_refund.id, 'refund_paypal_call', jsonb_build_object('attempt', v_refund.attempt_count));
  RETURN jsonb_build_object('ok', true, 'attempt_count', v_refund.attempt_count);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_rdv_payment_refund_attempt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_rdv_payment_refund_attempt(UUID) TO service_role;

-- ── Résultat d'un remboursement (réponse PayPal ou réconciliation) ──────────
--
-- p_outcome :
-- - completed : PayPal confirme (COMPLETED). Écriture comptable de
--   remboursement (contre-passation, l'encaissement d'origine reste intact) ;
-- - pending   : PayPal a accepté, remboursement pas encore finalisé ;
-- - unknown   : réponse ambiguë (délai réseau, 5xx…) : on ne sait pas si
--   PayPal a remboursé. Aucune nouvelle tentative sans réconciliation ;
-- - failed    : refus certain de PayPal (ou rien n'a été envoyé).
-- Transitions terminales : completed et failed ne changent plus.

CREATE OR REPLACE FUNCTION public.record_rdv_payment_refund_result(
  p_refund_id UUID,
  p_outcome TEXT,
  p_paypal_refund_id TEXT,
  p_paypal_status TEXT,
  p_error_code TEXT,
  p_adopted_external BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_refund public.rdv_payment_refunds;
  v_payment public.rdv_paypal_payments;
  v_booking public.bookings;
  v_origin public.rdv_financial_entries;
  v_entry_id UUID;
  v_vat_bps INTEGER;
  v_vat_status TEXT;
  v_net INTEGER;
  v_new_refunded INTEGER;
BEGIN
  IF p_outcome NOT IN ('completed', 'pending', 'unknown', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_outcome');
  END IF;

  SELECT * INTO v_refund FROM public.rdv_payment_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'refund_not_found'); END IF;

  -- Même ordre de verrouillage que begin_* : paiement puis remboursement.
  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE id = v_refund.payment_id FOR UPDATE;
  SELECT * INTO v_refund FROM public.rdv_payment_refunds WHERE id = p_refund_id FOR UPDATE;

  IF v_refund.status = 'completed' THEN
    IF p_outcome = 'completed' AND (p_paypal_refund_id IS NULL OR p_paypal_refund_id = v_refund.paypal_refund_id) THEN
      RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'completed');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'refund_already_final', 'status', v_refund.status);
  END IF;
  IF v_refund.status = 'failed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_already_final', 'status', v_refund.status);
  END IF;

  IF p_paypal_refund_id IS NOT NULL AND v_refund.paypal_refund_id IS NOT NULL
     AND p_paypal_refund_id <> v_refund.paypal_refund_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paypal_refund_id_mismatch');
  END IF;

  IF p_outcome IN ('pending', 'unknown') THEN
    UPDATE public.rdv_payment_refunds
    SET status = p_outcome,
        paypal_refund_id = COALESCE(paypal_refund_id, p_paypal_refund_id),
        paypal_status = COALESCE(p_paypal_status, paypal_status),
        error_code = p_error_code,
        last_checked_at = now(), updated_at = now()
    WHERE id = v_refund.id;
    INSERT INTO public.rdv_payment_settlement_events(payment_id, refund_id, event, detail)
    VALUES (v_payment.id, v_refund.id, 'refund_' || p_outcome,
            jsonb_strip_nulls(jsonb_build_object('paypal_status', p_paypal_status, 'error_code', p_error_code)));
    RETURN jsonb_build_object('ok', true, 'status', p_outcome);
  END IF;

  IF p_outcome = 'failed' THEN
    UPDATE public.rdv_payment_refunds
    SET status = 'failed', paypal_status = COALESCE(p_paypal_status, paypal_status),
        paypal_refund_id = COALESCE(paypal_refund_id, p_paypal_refund_id),
        error_code = COALESCE(p_error_code, 'paypal_refund_failed'),
        failed_at = now(), last_checked_at = now(), updated_at = now()
    WHERE id = v_refund.id;
    -- Rien n'a été remboursé par cette demande : retour à l'état précédent.
    UPDATE public.rdv_paypal_payments
    SET settlement_status = CASE WHEN refunded_cents > 0 THEN 'partially_refunded' ELSE 'open' END,
        settlement_updated_at = now()
    WHERE id = v_payment.id;
    INSERT INTO public.rdv_payment_settlement_events(payment_id, refund_id, event, detail)
    VALUES (v_payment.id, v_refund.id, 'refund_failed',
            jsonb_strip_nulls(jsonb_build_object('paypal_status', p_paypal_status, 'error_code', COALESCE(p_error_code, 'paypal_refund_failed'))));
    RETURN jsonb_build_object('ok', true, 'status', 'failed');
  END IF;

  -- completed
  IF p_paypal_refund_id IS NULL AND v_refund.paypal_refund_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paypal_refund_id_required');
  END IF;

  v_new_refunded := v_payment.refunded_cents + v_refund.amount_cents;
  IF v_new_refunded > v_payment.amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_exceeds_capture');
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_refund.booking_id;

  -- TVA du remboursement : même taux que l'encaissement d'origine.
  SELECT * INTO v_origin FROM public.rdv_financial_entries
  WHERE source = 'mediumia' AND external_payment_ref = v_payment.paypal_capture_id;
  v_vat_bps := COALESCE(v_origin.vat_rate_bps, 0);
  v_vat_status := COALESCE(v_origin.vat_status, 'review');
  v_net := ROUND((v_refund.amount_cents::NUMERIC * 10000) / (10000 + v_vat_bps))::INTEGER;

  INSERT INTO public.rdv_financial_entries(
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email,
    external_payment_ref, note
  ) VALUES (
    v_refund.practitioner_id, v_refund.booking_id, v_booking.service_id, 'mediumia', 'refund', 'refund', 'paypal',
    now(), v_refund.amount_cents, v_net, v_refund.amount_cents - v_net, v_vat_bps, v_vat_status, 'EUR',
    v_booking.booked_price_cents, v_booking.starts_at,
    trim(coalesce(v_booking.customer_first_name, '') || ' ' || coalesce(v_booking.customer_last_name, '')), v_booking.customer_email,
    'refund:' || COALESCE(p_paypal_refund_id, v_refund.paypal_refund_id),
    CASE WHEN p_adopted_external THEN 'Remboursement PayPal constaté (fait hors MediumIA)'
         ELSE 'Remboursement des arrhes (PayPal)' END
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_entry_id;

  IF v_entry_id IS NULL THEN
    -- Écriture déjà présente (même remboursement PayPal) : on la rattache.
    SELECT id INTO v_entry_id FROM public.rdv_financial_entries
    WHERE source = 'mediumia' AND external_payment_ref = 'refund:' || COALESCE(p_paypal_refund_id, v_refund.paypal_refund_id);
  END IF;

  UPDATE public.rdv_payment_refunds
  SET status = 'completed',
      paypal_refund_id = COALESCE(paypal_refund_id, p_paypal_refund_id),
      paypal_status = COALESCE(p_paypal_status, 'COMPLETED'),
      error_code = NULL,
      adopted_external = p_adopted_external,
      ledger_entry_id = v_entry_id,
      completed_at = now(), last_checked_at = now(), updated_at = now()
  WHERE id = v_refund.id;

  UPDATE public.rdv_paypal_payments
  SET refunded_cents = v_new_refunded,
      settlement_status = CASE WHEN v_new_refunded = amount_cents THEN 'refunded' ELSE 'partially_refunded' END,
      settlement_updated_at = now()
  WHERE id = v_payment.id;

  INSERT INTO public.rdv_payment_settlement_events(payment_id, refund_id, event, detail)
  VALUES (v_payment.id, v_refund.id, 'refund_completed',
          jsonb_build_object('amount_cents', v_refund.amount_cents, 'refunded_cents', v_new_refunded, 'adopted_external', p_adopted_external));

  RETURN jsonb_build_object('ok', true, 'status', 'completed', 'refunded_cents', v_new_refunded,
    'settlement_status', CASE WHEN v_new_refunded = v_payment.amount_cents THEN 'refunded' ELSE 'partially_refunded' END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_rdv_payment_refund_result(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_rdv_payment_refund_result(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

-- ── Transfert des arrhes vers un autre rendez-vous ──────────────────────────
--
-- Aucune nouvelle recette : deux écritures « deposit_transfer » de même montant et
-- même TVA, -X sur le rendez-vous annulé, +X sur le rendez-vous cible. Le
-- total encaissé ne bouge pas ; le reste à payer du rendez-vous cible baisse.

CREATE OR REPLACE FUNCTION public.transfer_rdv_deposit(
  p_booking_id UUID,
  p_target_booking_id UUID,
  p_practitioner_id UUID,
  p_idempotency_key UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_id UUID;
  v_payment public.rdv_paypal_payments;
  v_source public.bookings;
  v_target public.bookings;
  v_transfer public.rdv_deposit_transfers;
  v_origin public.rdv_financial_entries;
  v_balance public.rdv_balance_payments;
  v_vat_bps INTEGER;
  v_vat_status TEXT;
  v_net INTEGER;
  v_due INTEGER;
  v_out_id UUID;
  v_in_id UUID;
  v_id UUID := gen_random_uuid();
  v_name TEXT;
BEGIN
  IF p_idempotency_key IS NULL OR p_target_booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_transfer_request');
  END IF;

  SELECT * INTO v_source FROM public.bookings WHERE id = p_booking_id AND practitioner_id = p_practitioner_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  v_payment_id := public.rdv_booking_deposit_payment_id(p_booking_id);
  IF v_payment_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_paypal_deposit'); END IF;

  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE id = v_payment_id FOR UPDATE;

  SELECT * INTO v_transfer FROM public.rdv_deposit_transfers WHERE idempotency_key = p_idempotency_key OR payment_id = v_payment.id;
  IF FOUND THEN
    IF v_transfer.idempotency_key = p_idempotency_key AND v_transfer.target_booking_id = p_target_booking_id THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'transfer_id', v_transfer.id, 'settlement_status', 'transferred');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'already_transferred');
  END IF;

  IF v_source.status <> 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_cancelled'); END IF;
  IF v_payment.settlement_status = 'refunded' THEN RETURN jsonb_build_object('ok', false, 'error', 'already_refunded'); END IF;
  IF v_payment.settlement_status <> 'open' OR v_payment.refunded_cents <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'settlement_not_open', 'settlement_status', v_payment.settlement_status);
  END IF;

  -- Ordre de verrouillage identique à finalize_rdv_balance_capture :
  -- règlement de solde d'abord, puis rendez-vous.
  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = p_target_booking_id FOR UPDATE;
  SELECT * INTO v_target FROM public.bookings WHERE id = p_target_booking_id FOR UPDATE;
  IF NOT FOUND OR v_target.practitioner_id <> v_source.practitioner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_found');
  END IF;
  IF v_target.id = v_source.id THEN RETURN jsonb_build_object('ok', false, 'error', 'target_is_source'); END IF;
  IF v_target.status <> 'confirmed' OR v_target.starts_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_upcoming');
  END IF;
  IF lower(coalesce(v_target.customer_email, '')) <> lower(coalesce(v_source.customer_email, '')) OR v_source.customer_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_other_customer');
  END IF;
  IF v_target.booked_price_cents IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'target_without_price'); END IF;

  v_due := v_target.booked_price_cents - public.rdv_booking_paid_cents(v_target.id);
  IF v_payment.amount_cents > v_due THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transfer_exceeds_due', 'due_cents', GREATEST(v_due, 0));
  END IF;

  -- Un règlement de solde déjà engagé chez PayPal (montant figé) bloquerait
  -- ou fausserait le solde : on refuse le transfert dans ce cas.
  IF v_balance.id IS NOT NULL AND v_balance.status <> 'failed' AND (v_balance.paypal_order_id IS NOT NULL OR v_balance.status <> 'order_pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_balance_payment_in_progress');
  END IF;

  SELECT * INTO v_origin FROM public.rdv_financial_entries
  WHERE source = 'mediumia' AND external_payment_ref = v_payment.paypal_capture_id;
  v_vat_bps := COALESCE(v_origin.vat_rate_bps, 0);
  v_vat_status := COALESCE(v_origin.vat_status, 'review');
  v_net := ROUND((v_payment.amount_cents::NUMERIC * 10000) / (10000 + v_vat_bps))::INTEGER;
  v_name := trim(coalesce(v_source.customer_first_name, '') || ' ' || coalesce(v_source.customer_last_name, ''));

  INSERT INTO public.rdv_financial_entries(
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email, external_payment_ref, note
  ) VALUES (
    v_source.practitioner_id, v_source.id, v_source.service_id, 'mediumia', 'deposit_transfer', 'refund', 'paypal',
    now(), v_payment.amount_cents, v_net, v_payment.amount_cents - v_net, v_vat_bps, v_vat_status, 'EUR',
    v_source.booked_price_cents, v_source.starts_at, v_name, v_source.customer_email,
    'transfer-out:' || v_id::text, 'Arrhes transférées vers un autre rendez-vous'
  ) RETURNING id INTO v_out_id;

  INSERT INTO public.rdv_financial_entries(
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email, external_payment_ref, note
  ) VALUES (
    v_target.practitioner_id, v_target.id, v_target.service_id, 'mediumia', 'deposit_transfer', 'income', 'paypal',
    now(), v_payment.amount_cents, v_net, v_payment.amount_cents - v_net, v_vat_bps, v_vat_status, 'EUR',
    v_target.booked_price_cents, v_target.starts_at, v_name, v_target.customer_email,
    'transfer-in:' || v_id::text, 'Arrhes reçues par transfert (rendez-vous annulé)'
  ) RETURNING id INTO v_in_id;

  INSERT INTO public.rdv_deposit_transfers(
    id, payment_id, source_booking_id, target_booking_id, practitioner_id, paypal_env, paypal_capture_id,
    amount_cents, currency, idempotency_key, source_ledger_entry_id, target_ledger_entry_id, created_by
  ) VALUES (
    v_id, v_payment.id, v_source.id, v_target.id, v_source.practitioner_id, v_payment.paypal_env, v_payment.paypal_capture_id,
    v_payment.amount_cents, 'EUR', p_idempotency_key, v_out_id, v_in_id, p_actor
  ) RETURNING * INTO v_transfer;

  UPDATE public.rdv_paypal_payments
  SET settlement_status = 'transferred', settlement_updated_at = now()
  WHERE id = v_payment.id;

  -- Solde : le reste à payer du rendez-vous cible a baissé.
  v_due := v_due - v_payment.amount_cents;
  IF v_balance.id IS NOT NULL AND v_balance.status = 'order_pending' AND v_balance.paypal_order_id IS NULL THEN
    IF v_due > 0 THEN
      UPDATE public.rdv_balance_payments SET amount_cents = v_due, updated_at = now() WHERE id = v_balance.id;
    ELSE
      UPDATE public.rdv_balance_payments SET status = 'failed', last_error_code = 'covered_by_transfer', updated_at = now() WHERE id = v_balance.id;
    END IF;
  END IF;
  IF v_due <= 0 THEN
    UPDATE public.bookings
    SET balance_paid_at = COALESCE(balance_paid_at, now()),
        balance_payment_token_hash = NULL,
        balance_payment_token_expires_at = NULL,
        updated_at = now()
    WHERE id = v_target.id;
  END IF;

  INSERT INTO public.rdv_payment_settlement_events(payment_id, transfer_id, event, actor, detail)
  VALUES (v_payment.id, v_transfer.id, 'transferred', p_actor,
          jsonb_build_object('amount_cents', v_payment.amount_cents, 'target_booking_id', v_target.id, 'remaining_due_cents', GREATEST(v_due, 0)));

  RETURN jsonb_build_object('ok', true, 'replay', false, 'transfer_id', v_transfer.id,
    'settlement_status', 'transferred', 'remaining_due_cents', GREATEST(v_due, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_rdv_deposit(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_rdv_deposit(UUID, UUID, UUID, UUID, UUID) TO service_role;
