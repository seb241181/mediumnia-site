-- MediumIA RDV — option de paiement intégral pour les rendez-vous vidéo.
-- Les rendez-vous en présence conservent uniquement les arrhes configurées.

ALTER TABLE public.rdv_booking_holds
  ADD COLUMN IF NOT EXISTS payment_choice TEXT NOT NULL DEFAULT 'arrhes'
    CHECK (payment_choice IN ('arrhes', 'full_payment'));

CREATE OR REPLACE FUNCTION public.create_rdv_full_payment_hold(
  p_practitioner_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_selected_modality TEXT,
  p_customer_first_name TEXT,
  p_customer_last_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_message TEXT,
  p_client_checkout_id UUID,
  p_paypal_env TEXT,
  p_terms_version TEXT,
  p_early_performance_requested BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_service public.booking_services;
  v_hold_id UUID;
BEGIN
  IF p_selected_modality <> 'video' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'full_payment_video_only');
  END IF;

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;

  IF NOT FOUND
    OR v_service.booking_mode <> 'instant'
    OR v_service.reservation_payment_kind <> 'arrhes'
    OR v_service.price_cents IS NULL
    OR v_service.price_cents <= 0
    OR v_service.currency <> 'EUR'
    OR NOT ('video' = ANY(v_service.modality))
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;

  -- Réutilise toutes les protections existantes : verrou, disponibilité,
  -- limite quotidienne, idempotence, durée et contrôles de modalité.
  v_result := public.create_rdv_deposit_hold(
    p_practitioner_id,
    p_service_id,
    p_starts_at,
    p_ends_at,
    p_selected_modality,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_email,
    p_customer_phone,
    p_customer_message,
    p_client_checkout_id,
    p_paypal_env,
    p_terms_version,
    p_early_performance_requested
  );

  IF NOT COALESCE((v_result->>'ok')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_hold_id := NULLIF(v_result->>'hold_id', '')::UUID;
  IF v_hold_id IS NULL THEN
    RETURN v_result;
  END IF;

  UPDATE public.rdv_booking_holds
  SET reservation_payment_cents = v_service.price_cents,
      payment_choice = 'full_payment'
  WHERE id = v_hold_id;

  UPDATE public.rdv_paypal_payments
  SET amount_cents = v_service.price_cents
  WHERE hold_id = v_hold_id
    AND paypal_order_id IS NULL;

  IF NOT FOUND AND COALESCE((v_result->>'existing')::BOOLEAN, false) THEN
    -- Une commande PayPal existe déjà pour ce checkout : on ne change jamais son montant.
    RETURN jsonb_build_object('ok', false, 'error', 'payment_choice_locked');
  END IF;

  RETURN v_result || jsonb_build_object(
    'amount_cents', v_service.price_cents,
    'service_price_cents', v_service.price_cents,
    'payment_choice', 'full_payment'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO service_role;

-- Autorise soit les arrhes configurées, soit le prix total pour un service vidéo.
CREATE OR REPLACE FUNCTION public.enforce_mediumia_booking_reservation_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.booking_services;
  v_valid BOOLEAN := false;
BEGIN
  IF NEW.booking_source <> 'mediumia' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = NEW.service_id;
  IF FOUND
    AND v_service.booking_mode = 'instant'
    AND v_service.reservation_payment_kind = 'arrhes'
  THEN
    v_valid := NEW.booked_price_cents IS NOT DISTINCT FROM v_service.price_cents
      AND (
        NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.reservation_payment_cents
        OR (
          'video' = ANY(v_service.modality)
          AND NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.price_cents
        )
      );

    IF NOT v_valid THEN
      RAISE EXCEPTION 'reservation_payment_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Le convertisseur existant crée d'abord l'écriture comme "arrhes".
-- Ce trigger la normalise en "full_payment" si le montant encaissé couvre le prix total.
CREATE OR REPLACE FUNCTION public.normalize_mediumia_rdv_financial_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'mediumia'
    AND NEW.direction = 'income'
    AND NEW.payment_method = 'paypal'
    AND NEW.entry_kind = 'arrhes'
    AND NEW.service_price_cents IS NOT NULL
    AND NEW.gross_cents = NEW.service_price_cents
  THEN
    NEW.entry_kind := 'full_payment';
    NEW.note := 'Paiement intégral du rendez-vous MediumIA';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rdv_financial_normalize_full_payment ON public.rdv_financial_entries;
CREATE TRIGGER rdv_financial_normalize_full_payment
BEFORE INSERT ON public.rdv_financial_entries
FOR EACH ROW EXECUTE FUNCTION public.normalize_mediumia_rdv_financial_kind();

REVOKE ALL ON FUNCTION public.normalize_mediumia_rdv_financial_kind() FROM PUBLIC;
