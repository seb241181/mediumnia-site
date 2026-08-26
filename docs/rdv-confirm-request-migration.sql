-- MediumIA — Migration confirm_booking_request RPC
-- Fournir au praticien, NE PAS appliquer automatiquement.
-- Appliquer via Supabase Dashboard → SQL Editor.
--
-- Pré-requis : migration docs/rdv-requests-migration.sql déjà appliquée.

CREATE OR REPLACE FUNCTION public.confirm_booking_request(
  p_request_id         UUID,
  p_practitioner_id    UUID,
  p_scheduled_at       TIMESTAMPTZ,
  p_travel_fee_cents   INTEGER  DEFAULT 0,
  p_final_price_cents  INTEGER  DEFAULT NULL,
  p_practitioner_notes TEXT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request    booking_requests;
  v_service    booking_services;
  v_pract      booking_practitioners;
  v_ends_at    TIMESTAMPTZ;
  v_booking_id UUID;
  v_conflicts  INTEGER;
BEGIN
  -- 1. Verrou anti-concurrence sur le praticien (évite les double-clics)
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::TEXT));

  -- 2. Charger la demande avec verrou ligne-par-ligne
  SELECT * INTO v_request
  FROM booking_requests
  WHERE id = p_request_id
    AND practitioner_id = p_practitioner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'request_not_found');
  END IF;

  -- 3. Vérifier qu'elle n'est pas déjà confirmée (idempotence)
  IF v_request.confirmed_booking_id IS NOT NULL OR v_request.status = 'scheduled' THEN
    RETURN jsonb_build_object(
      'error',      'already_confirmed',
      'booking_id', v_request.confirmed_booking_id
    );
  END IF;

  IF v_request.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'request_closed', 'status', v_request.status);
  END IF;

  -- 4. Charger le service (durée)
  SELECT * INTO v_service FROM booking_services WHERE id = v_request.service_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'service_not_found');
  END IF;

  v_ends_at := p_scheduled_at + (v_service.duration_min * INTERVAL '1 minute');

  -- 5. Buffers du praticien
  SELECT * INTO v_pract FROM booking_practitioners WHERE id = p_practitioner_id;

  -- 6. Vérifier les chevauchements MediumIA (avec buffers de chaque côté)
  SELECT COUNT(*) INTO v_conflicts
  FROM bookings
  WHERE practitioner_id = p_practitioner_id
    AND status = 'confirmed'
    AND starts_at < v_ends_at    + (COALESCE(v_pract.buffer_after_min,  0) * INTERVAL '1 minute')
    AND ends_at   > p_scheduled_at - (COALESCE(v_pract.buffer_before_min, 0) * INTERVAL '1 minute');

  IF v_conflicts > 0 THEN
    RETURN jsonb_build_object(
      'error',   'conflict',
      'message', 'Un rendez-vous MediumIA existe déjà sur cette plage horaire (buffers inclus).'
    );
  END IF;

  -- 7. Créer le booking confirmé
  INSERT INTO bookings (
    practitioner_id,
    service_id,
    starts_at,
    ends_at,
    timezone,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    customer_message,
    status
  ) VALUES (
    v_request.practitioner_id,
    v_request.service_id,
    p_scheduled_at,
    v_ends_at,
    'Europe/Paris',
    v_request.customer_first_name,
    v_request.customer_last_name,
    v_request.customer_email,
    v_request.customer_phone,
    v_request.customer_message,
    'confirmed'
  )
  RETURNING id INTO v_booking_id;

  -- 8. Mettre à jour la demande (atomique dans la même transaction)
  UPDATE booking_requests SET
    status               = 'scheduled',
    confirmed_booking_id = v_booking_id,
    scheduled_at         = p_scheduled_at,
    travel_fee_cents     = p_travel_fee_cents,
    final_price_cents    = p_final_price_cents,
    practitioner_notes   = p_practitioner_notes,
    updated_at           = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success',    true,
    'booking_id', v_booking_id,
    'ends_at',    v_ends_at
  );
END;
$$;

-- Permissions : service_role uniquement (API serveur)
-- anon et authenticated n'ont jamais accès à cette fonction.
REVOKE ALL ON FUNCTION public.confirm_booking_request(UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_booking_request(UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_request(UUID, UUID, TIMESTAMPTZ, INTEGER, INTEGER, TEXT)
  TO service_role;

-- ── Vérification ───────────────────────────────────────────────────────────────
-- Après application :
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'confirm_booking_request';
-- prosecdef doit être true (SECURITY DEFINER).
