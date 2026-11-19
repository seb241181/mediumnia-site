-- Règlements hors PayPal des rendez-vous (virement, chèque, espèces, carte sur place).
--
-- Deux temps distincts :
--   1. « Virement annoncé » : le client dit avoir payé. Rien n'est comptabilisé.
--      Le solde reste dû, mais l'annulation automatique est suspendue, aucun
--      rappel de paiement n'est envoyé et le paiement PayPal du lien de solde est
--      bloqué (pas de second règlement pendant la vérification).
--   2. « Paiement reçu et confirmé » : le propriétaire a vérifié la réception.
--      Une seule écriture comptable est créée (jamais de transaction PayPal
--      fictive), le solde est recalculé et, s'il est nul, le rendez-vous est soldé.
--
-- Garanties : verrous sur le rendez-vous, clé d'idempotence par demande, montant
-- jamais supérieur au reste dû, refus pendant une capture PayPal en cours,
-- historique complet. Aucune capture PayPal existante n'est modifiée.
--
-- Additif. Remplace trois fonctions existantes (définitions de Production du
-- 08/11/2026 + une garde chacune) : create_or_get_rdv_balance_payment,
-- claim_rdv_balance_capture, rdv_balance_cancel_blocker. Retour arrière :
-- supabase/runbooks/20261108-rdv-offline-payments/retour-arriere.sql

-- ── 1. Règlements hors PayPal et historique ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.rdv_offline_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id),
  status TEXT NOT NULL CHECK (status IN ('announced', 'confirmed', 'withdrawn')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('transfer', 'check', 'cash', 'card', 'other')),
  announced_amount_cents INTEGER CHECK (announced_amount_cents > 0),
  received_amount_cents INTEGER CHECK (received_amount_cents > 0),
  received_on DATE,
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  financial_entry_id UUID REFERENCES public.rdv_financial_entries(id),
  announce_request_id TEXT UNIQUE CHECK (announce_request_id IS NULL OR length(announce_request_id) BETWEEN 16 AND 120),
  confirm_request_id TEXT UNIQUE CHECK (confirm_request_id IS NULL OR length(confirm_request_id) BETWEEN 16 AND 120),
  created_by UUID NOT NULL,
  confirmed_by UUID,
  withdrawn_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'announced' OR announced_amount_cents IS NOT NULL),
  CHECK (status <> 'confirmed' OR (received_amount_cents IS NOT NULL AND received_on IS NOT NULL
    AND financial_entry_id IS NOT NULL AND confirm_request_id IS NOT NULL AND confirmed_at IS NOT NULL))
);
-- Une seule annonce ouverte par rendez-vous.
CREATE UNIQUE INDEX IF NOT EXISTS rdv_offline_payments_one_open_announcement
  ON public.rdv_offline_payments (booking_id) WHERE status = 'announced';
-- Une écriture comptable ne confirme qu'un seul règlement.
CREATE UNIQUE INDEX IF NOT EXISTS rdv_offline_payments_entry_once
  ON public.rdv_offline_payments (financial_entry_id) WHERE financial_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rdv_offline_payments_booking_idx ON public.rdv_offline_payments (booking_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rdv_offline_payment_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offline_payment_id UUID REFERENCES public.rdv_offline_payments(id),
  booking_id UUID NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('announced', 'confirmed', 'withdrawn')),
  actor UUID NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rdv_offline_payment_events_booking_idx ON public.rdv_offline_payment_events (booking_id, created_at);

ALTER TABLE public.rdv_offline_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rdv_offline_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rdv_offline_payments, public.rdv_offline_payment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rdv_offline_payments TO service_role;
GRANT SELECT, INSERT ON public.rdv_offline_payment_events TO service_role;

-- Montant net reçu pour un rendez-vous, toutes sources (encaissements − remboursements).
CREATE OR REPLACE FUNCTION public.rdv_booking_received_cents(p_booking_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(CASE direction WHEN 'income' THEN gross_cents WHEN 'refund' THEN -gross_cents ELSE 0 END), 0)::INTEGER
  FROM public.rdv_financial_entries
  WHERE booking_id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.rdv_offline_payment_json(p public.rdv_offline_payments)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'booking_id', p.booking_id, 'status', p.status, 'payment_method', p.payment_method,
    'announced_amount_cents', p.announced_amount_cents, 'received_amount_cents', p.received_amount_cents,
    'received_on', p.received_on, 'reference', p.reference, 'note', p.note,
    'financial_entry_id', p.financial_entry_id, 'created_at', p.created_at,
    'confirmed_at', p.confirmed_at, 'withdrawn_at', p.withdrawn_at);
$$;

-- ── 2. Annonce d'un règlement (rien n'est comptabilisé) ───────────────────
CREATE OR REPLACE FUNCTION public.announce_rdv_offline_payment(
  p_actor UUID,
  p_booking_id UUID,
  p_payment_method TEXT,
  p_amount_cents INTEGER,
  p_note TEXT,
  p_request_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_existing public.rdv_offline_payments;
  v_total INTEGER;
  v_due INTEGER;
BEGIN
  IF p_actor IS NULL OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 16 AND 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  IF p_payment_method NOT IN ('transfer', 'check', 'cash', 'card', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT * INTO v_existing FROM public.rdv_offline_payments WHERE announce_request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.booking_id <> p_booking_id THEN RETURN jsonb_build_object('ok', false, 'error', 'request_id_reused'); END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'payment', public.rdv_offline_payment_json(v_existing));
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b JOIN public.booking_practitioners p ON p.id = b.practitioner_id
  WHERE b.id = p_booking_id AND p.owner_id = p_actor
  FOR UPDATE OF b;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_confirmed'); END IF;

  v_total := COALESCE(v_booking.booked_price_cents,
    (SELECT s.price_cents FROM public.booking_services s WHERE s.id = v_booking.service_id), 0);
  v_due := GREATEST(v_total - public.rdv_booking_received_cents(v_booking.id), 0);
  IF v_due <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_due'); END IF;
  IF p_amount_cents > v_due THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_exceeds_due', 'due_cents', v_due);
  END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_offline_payments WHERE booking_id = v_booking.id AND status = 'announced') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'announcement_exists');
  END IF;

  INSERT INTO public.rdv_offline_payments (booking_id, practitioner_id, status, payment_method,
    announced_amount_cents, note, announce_request_id, created_by)
  VALUES (v_booking.id, v_booking.practitioner_id, 'announced', p_payment_method,
    p_amount_cents, NULLIF(left(trim(COALESCE(p_note, '')), 500), ''), p_request_id, p_actor)
  RETURNING * INTO v_existing;

  INSERT INTO public.rdv_offline_payment_events (offline_payment_id, booking_id, event, actor, detail)
  VALUES (v_existing.id, v_booking.id, 'announced', p_actor,
    jsonb_build_object('amount_cents', p_amount_cents, 'payment_method', p_payment_method, 'due_cents', v_due));

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'payment', public.rdv_offline_payment_json(v_existing), 'due_cents', v_due);
END;
$$;

-- ── 3. Confirmation de réception (seule étape comptable) ──────────────────
CREATE OR REPLACE FUNCTION public.confirm_rdv_offline_payment(
  p_actor UUID,
  p_booking_id UUID,
  p_payment_method TEXT,
  p_amount_cents INTEGER,
  p_received_on DATE,
  p_reference TEXT,
  p_note TEXT,
  p_request_id TEXT,
  p_offline_payment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_balance public.rdv_balance_payments;
  v_offline public.rdv_offline_payments;
  v_total INTEGER;
  v_paid INTEGER;
  v_due INTEGER;
  v_kind TEXT;
  v_net INTEGER;
  v_vat_bps INTEGER;
  v_entry_id UUID;
  v_occurred TIMESTAMPTZ;
  v_settled BOOLEAN;
BEGIN
  IF p_actor IS NULL OR p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 16 AND 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  IF p_payment_method NOT IN ('transfer', 'check', 'cash', 'card', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_amount_cents > 10000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF p_received_on IS NULL OR p_received_on > (now() AT TIME ZONE 'Europe/Paris')::date
     OR p_received_on < (now() AT TIME ZONE 'Europe/Paris')::date - 400 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_received_on');
  END IF;

  -- Rejeu de la même demande : même réponse, rien de nouveau.
  SELECT * INTO v_offline FROM public.rdv_offline_payments WHERE confirm_request_id = p_request_id;
  IF FOUND THEN
    IF v_offline.booking_id <> p_booking_id THEN RETURN jsonb_build_object('ok', false, 'error', 'request_id_reused'); END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'payment', public.rdv_offline_payment_json(v_offline),
      'due_cents', GREATEST(COALESCE((SELECT booked_price_cents FROM public.bookings WHERE id = p_booking_id), 0)
        - public.rdv_booking_received_cents(p_booking_id), 0));
  END IF;

  -- Même ordre de verrous que la capture du solde PayPal : paiement, puis rendez-vous.
  SELECT * INTO v_balance FROM public.rdv_balance_payments WHERE booking_id = p_booking_id FOR UPDATE;
  SELECT b.* INTO v_booking
  FROM public.bookings b JOIN public.booking_practitioners p ON p.id = b.practitioner_id
  WHERE b.id = p_booking_id AND p.owner_id = p_actor
  FOR UPDATE OF b;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  -- Rejeu concurrent : la demande a pu être enregistrée pendant l'attente du verrou.
  SELECT * INTO v_offline FROM public.rdv_offline_payments WHERE confirm_request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'payment', public.rdv_offline_payment_json(v_offline),
      'due_cents', GREATEST(COALESCE(v_booking.booked_price_cents, 0) - public.rdv_booking_received_cents(v_booking.id), 0));
  END IF;

  IF v_booking.status <> 'confirmed' THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_confirmed'); END IF;
  IF v_balance.id IS NOT NULL AND v_balance.status = 'capture_in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'paypal_capture_in_progress');
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  v_total := COALESCE(v_booking.booked_price_cents, v_service.price_cents, 0);
  v_paid := public.rdv_booking_received_cents(v_booking.id);
  v_due := GREATEST(v_total - v_paid, 0);
  IF v_due <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_due'); END IF;
  IF p_amount_cents > v_due THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_exceeds_due', 'due_cents', v_due);
  END IF;

  -- L'annonce à confirmer : celle désignée, sinon l'annonce ouverte du rendez-vous.
  IF p_offline_payment_id IS NOT NULL THEN
    SELECT * INTO v_offline FROM public.rdv_offline_payments
    WHERE id = p_offline_payment_id AND booking_id = v_booking.id FOR UPDATE;
    IF NOT FOUND OR v_offline.status <> 'announced' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'announcement_not_open');
    END IF;
  ELSE
    SELECT * INTO v_offline FROM public.rdv_offline_payments
    WHERE booking_id = v_booking.id AND status = 'announced' FOR UPDATE;
  END IF;

  v_kind := CASE WHEN v_paid > 0 THEN 'balance' WHEN p_amount_cents = v_total THEN 'full_payment' ELSE 'adjustment' END;
  v_vat_bps := COALESCE(v_service.vat_rate_bps, 0);
  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_vat_bps))::INTEGER;
  v_occurred := (p_received_on + TIME '12:00') AT TIME ZONE 'Europe/Paris';

  INSERT INTO public.rdv_financial_entries (
    practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency,
    service_price_cents, appointment_starts_at, customer_name, customer_email,
    external_payment_ref, note
  ) VALUES (
    v_booking.practitioner_id, v_booking.id, v_booking.service_id, v_booking.booking_source, v_kind, 'income', p_payment_method,
    v_occurred, p_amount_cents, v_net, p_amount_cents - v_net, v_vat_bps, 'taxable', 'EUR',
    NULLIF(v_total, 0), v_booking.starts_at,
    NULLIF(trim(COALESCE(v_booking.customer_first_name, '') || ' ' || COALESCE(v_booking.customer_last_name, '')), ''),
    v_booking.customer_email,
    'offline:' || p_request_id,
    left('Règlement hors PayPal confirmé' || COALESCE(' — réf. ' || NULLIF(trim(p_reference), ''), '')
      || COALESCE(' — ' || NULLIF(trim(p_note), ''), ''), 500)
  ) RETURNING id INTO v_entry_id;

  IF v_offline.id IS NOT NULL THEN
    UPDATE public.rdv_offline_payments
    SET status = 'confirmed', payment_method = p_payment_method, received_amount_cents = p_amount_cents,
        received_on = p_received_on, reference = NULLIF(left(trim(COALESCE(p_reference, '')), 120), ''),
        note = COALESCE(NULLIF(left(trim(COALESCE(p_note, '')), 500), ''), note),
        financial_entry_id = v_entry_id, confirm_request_id = p_request_id,
        confirmed_by = p_actor, confirmed_at = now(), updated_at = now()
    WHERE id = v_offline.id
    RETURNING * INTO v_offline;
  ELSE
    INSERT INTO public.rdv_offline_payments (booking_id, practitioner_id, status, payment_method,
      received_amount_cents, received_on, reference, note, financial_entry_id, confirm_request_id,
      created_by, confirmed_by, confirmed_at)
    VALUES (v_booking.id, v_booking.practitioner_id, 'confirmed', p_payment_method,
      p_amount_cents, p_received_on, NULLIF(left(trim(COALESCE(p_reference, '')), 120), ''),
      NULLIF(left(trim(COALESCE(p_note, '')), 500), ''), v_entry_id, p_request_id,
      p_actor, p_actor, now())
    RETURNING * INTO v_offline;
  END IF;

  v_due := v_due - p_amount_cents;
  v_settled := v_due = 0;
  IF v_settled THEN
    -- Soldé : plus de rappel, d'alerte ni d'annulation pour impayé. Le jeton du
    -- lien reste lisible (page « réglé ») ; toute capture PayPal tardive sera
    -- refusée car plus rien n'est dû.
    UPDATE public.bookings
    SET balance_paid_at = COALESCE(balance_paid_at, v_occurred), balance_cancel_claimed_at = NULL, updated_at = now()
    WHERE id = v_booking.id;
  END IF;

  INSERT INTO public.rdv_offline_payment_events (offline_payment_id, booking_id, event, actor, detail)
  VALUES (v_offline.id, v_booking.id, 'confirmed', p_actor, jsonb_build_object(
    'amount_cents', p_amount_cents, 'payment_method', p_payment_method, 'received_on', p_received_on,
    'financial_entry_id', v_entry_id, 'due_after_cents', v_due,
    'paypal_balance_status', v_balance.status));

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'payment', public.rdv_offline_payment_json(v_offline),
    'due_cents', v_due, 'settled', v_settled);
END;
$$;

-- ── 4. Retrait d'une annonce (virement jamais reçu, erreur de saisie) ─────
CREATE OR REPLACE FUNCTION public.withdraw_rdv_offline_payment(p_actor UUID, p_offline_payment_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offline public.rdv_offline_payments;
BEGIN
  SELECT o.* INTO v_offline
  FROM public.rdv_offline_payments o JOIN public.booking_practitioners p ON p.id = o.practitioner_id
  WHERE o.id = p_offline_payment_id AND p.owner_id = p_actor
  FOR UPDATE OF o;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'offline_payment_not_found'); END IF;
  IF v_offline.status = 'withdrawn' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'payment', public.rdv_offline_payment_json(v_offline));
  END IF;
  IF v_offline.status <> 'announced' THEN RETURN jsonb_build_object('ok', false, 'error', 'announcement_not_open'); END IF;

  UPDATE public.rdv_offline_payments
  SET status = 'withdrawn', withdrawn_by = p_actor, withdrawn_at = now(), updated_at = now()
  WHERE id = v_offline.id RETURNING * INTO v_offline;
  INSERT INTO public.rdv_offline_payment_events (offline_payment_id, booking_id, event, actor, detail)
  VALUES (v_offline.id, v_offline.booking_id, 'withdrawn', p_actor,
    jsonb_build_object('reason', NULLIF(left(trim(COALESCE(p_reason, '')), 200), '')));
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'payment', public.rdv_offline_payment_json(v_offline));
END;
$$;

REVOKE ALL ON FUNCTION public.rdv_booking_received_cents(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rdv_offline_payment_json(public.rdv_offline_payments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.announce_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, DATE, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdraw_rdv_offline_payment(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_booking_received_cents(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.rdv_offline_payment_json(public.rdv_offline_payments) TO service_role;
GRANT EXECUTE ON FUNCTION public.announce_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_rdv_offline_payment(UUID, UUID, TEXT, INTEGER, DATE, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_rdv_offline_payment(UUID, UUID, TEXT) TO service_role;

-- ── 5. Lien de solde PayPal : bloqué pendant une annonce ──────────────────
-- Définition de Production du 08/11/2026 + la garde « offline_payment_announced ».
CREATE OR REPLACE FUNCTION public.create_or_get_rdv_balance_payment(p_token_hash text, p_client_checkout_id uuid, p_paypal_env text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Règlement hors PayPal annoncé : pas de second paiement pendant la vérification.
  IF EXISTS (SELECT 1 FROM public.rdv_offline_payments o WHERE o.booking_id = v_booking.id AND o.status = 'announced') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offline_payment_announced');
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
$function$;

-- Définition de Production du 08/11/2026 + la même garde avant toute capture.
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_capture(p_paypal_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Règlement hors PayPal annoncé : la capture n'est pas tentée (aucun débit).
  IF EXISTS (SELECT 1 FROM public.rdv_offline_payments o WHERE o.booking_id = v_booking.id AND o.status = 'announced') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offline_payment_announced');
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
$function$;

-- ── 6. Annulation pour solde impayé : jamais pendant une annonce ──────────
-- Définition de Production du 08/11/2026 + la garde « offline_payment_announced ».
CREATE OR REPLACE FUNCTION public.rdv_balance_cancel_blocker(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_settings public.rdv_balance_runtime_settings;
  v_payment public.rdv_balance_payments;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 'booking_not_found'; END IF;
  SELECT * INTO v_settings FROM public.rdv_balance_runtime_settings WHERE singleton = true;

  IF v_booking.balance_owner_decision = 'hold' THEN RETURN 'owner_hold'; END IF;
  IF EXISTS (SELECT 1 FROM public.rdv_offline_payments o WHERE o.booking_id = v_booking.id AND o.status = 'announced') THEN
    RETURN 'offline_payment_announced';
  END IF;
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
$function$;
