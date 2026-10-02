-- Prérequis : 20261002085000_mediumia_customers.sql (référentiel clients).
--
-- Lumia RDV — demandes de rendez-vous détectées dans les messages (SMS,
-- iMessage, WhatsApp, Dots…) importées dans MediumIA.
--
-- MediumIA reste la source de vérité : une demande détectée devient une ligne
-- booking_requests (statut pending). Elle ne crée jamais de booking ni
-- d'événement Google. Sébastien la confirme ensuite par le flux existant
-- (action=requests status=scheduled → confirm_booking_request →
-- syncBookingToGoogleCalendar).
--
-- Changement minimal sur booking_requests :
-- - les champs pensés pour le formulaire « déplacement » deviennent facultatifs
--   UNIQUEMENT pour les demandes venues d'un agent (intake_agent non nul) ; le
--   formulaire du site garde exactement ses obligations (contrainte CHECK) ;
-- - colonnes de traçabilité (canal, message, dates, modalité, créneau proposé,
--   indice de prestation, rapprochement client, données manquantes, confiance).
--
-- Idempotence : un message (canal + identifiant) ne produit qu'un seul
-- événement (clé unique) ; la fonction sérialise les appels concurrents par
-- verrou consultatif. Deux appels du même message renvoient la même demande.
--
-- Rien ici n'appelle Google, ni ne touche aux bookings, paiements, arrhes ou
-- remboursements. Idempotente : peut être rejouée.

-- ── 1. booking_requests : champs facultatifs pour les demandes d'agent ───────

ALTER TABLE public.booking_requests
  ALTER COLUMN service_id DROP NOT NULL,
  ALTER COLUMN customer_first_name DROP NOT NULL,
  ALTER COLUMN customer_last_name DROP NOT NULL,
  ALTER COLUMN customer_email DROP NOT NULL,
  ALTER COLUMN customer_phone DROP NOT NULL,
  ALTER COLUMN address_line1 DROP NOT NULL,
  ALTER COLUMN postal_code DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL;

ALTER TABLE public.booking_requests
  ADD COLUMN IF NOT EXISTS intake_agent TEXT,
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS source_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requested_modality TEXT,
  ADD COLUMN IF NOT EXISTS proposed_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS service_hint TEXT,
  ADD COLUMN IF NOT EXISTS customer_match TEXT,
  ADD COLUMN IF NOT EXISTS intake_missing TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intake_confidence NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lumia_updated_at TIMESTAMPTZ,
  -- Référentiel clients (20261002085000) : lien certain, ou simple suggestion.
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.mediumia_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_suggestion_id UUID REFERENCES public.mediumia_customers(id) ON DELETE SET NULL;

-- Le formulaire du site (intake_agent NULL) garde toutes ses obligations.
ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_site_form_required_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_site_form_required_check
  CHECK (
    intake_agent IS NOT NULL
    OR (service_id IS NOT NULL AND customer_first_name IS NOT NULL AND customer_last_name IS NOT NULL
        AND customer_email IS NOT NULL AND customer_phone IS NOT NULL
        AND address_line1 IS NOT NULL AND postal_code IS NOT NULL AND city IS NOT NULL)
  );

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_intake_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_intake_check
  CHECK (
    (intake_agent IS NULL AND source_channel IS NULL AND source_message_id IS NULL)
    OR (intake_agent ~ '^[a-z0-9_-]{1,32}$'
        AND source_channel IN ('sms', 'imessage', 'whatsapp', 'dots', 'chatgpt', 'email', 'form', 'other')
        AND source_message_id IS NOT NULL)
  );

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_requested_modality_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_requested_modality_check
  CHECK (requested_modality IS NULL OR requested_modality IN ('video', 'in-person', 'phone', 'unknown'));

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_customer_match_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_customer_match_check
  CHECK (customer_match IS NULL OR customer_match IN ('phone', 'email', 'none', 'ambiguous'));

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_intake_confidence_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_intake_confidence_check
  CHECK (intake_confidence IS NULL OR (intake_confidence >= 0 AND intake_confidence <= 1));

-- Un message n'ouvre qu'une seule demande.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_requests_source_message
  ON public.booking_requests (source_channel, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_source_conversation
  ON public.booking_requests (practitioner_id, source_channel, source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

-- ── 2. Journal des messages importés (idempotence par message) ──────────────

CREATE TABLE IF NOT EXISTS public.booking_request_intake_events (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.booking_requests(id) ON DELETE CASCADE,
  intake_agent TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_conversation_id TEXT,
  source_message_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_channel, source_message_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_request_intake_events_request
  ON public.booking_request_intake_events (request_id, created_at);

ALTER TABLE public.booking_request_intake_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_request_intake_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_request_intake_events TO service_role;

-- ── 3. Normalisation téléphone (identique à lib/lumiaRdvIntake.js) ───────────

CREATE OR REPLACE FUNCTION public.lumia_normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d ~ '^0[1-9][0-9]{8}$' THEN '+33' || substr(d, 2)
    WHEN d ~ '^0033[1-9][0-9]{8}$' THEN '+33' || substr(d, 5)
    WHEN d ~ '^\+33[1-9][0-9]{8}$' THEN d
    WHEN d ~ '^\+[1-9][0-9]{6,14}$' THEN d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g') AS d) s;
$$;

REVOKE ALL ON FUNCTION public.lumia_normalize_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_normalize_phone(TEXT) TO service_role;

-- Sources fiables pour reconnaître un client (identité = e-mail, sinon fiche).
CREATE OR REPLACE FUNCTION public.lumia_known_customers(p_practitioner_id UUID)
RETURNS TABLE (identity TEXT, email TEXT, first_name TEXT, last_name TEXT, phone TEXT, customer_id UUID, seen_at TIMESTAMPTZ, ambiguous BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(c.email, 'customer:' || c.id::TEXT), c.email, c.first_name, c.last_name, c.phone_e164, c.id, c.updated_at,
         c.identity_status = 'ambiguous'
  FROM public.mediumia_customers c WHERE c.practitioner_id = p_practitioner_id
  UNION ALL
  SELECT lower(b.customer_email), lower(b.customer_email), b.customer_first_name, b.customer_last_name,
         public.lumia_normalize_phone(b.customer_phone), NULL::UUID, b.created_at, false
  FROM public.bookings b WHERE b.practitioner_id = p_practitioner_id AND b.customer_email IS NOT NULL
  UNION ALL
  SELECT lower(r.customer_email), lower(r.customer_email), r.customer_first_name, r.customer_last_name,
         public.lumia_normalize_phone(r.customer_phone), NULL::UUID, r.created_at, false
  FROM public.booking_requests r
  WHERE r.practitioner_id = p_practitioner_id AND r.intake_agent IS NULL AND r.customer_email IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.lumia_known_customers(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_known_customers(UUID) TO service_role;

-- ── 4. Import atomique d'une demande ────────────────────────────────────────
--
-- p_payload (déjà validé et normalisé côté API) :
--   agent, channel, message_id, conversation_id, message_at, detected_at,
--   first_name, last_name, phone (+33…), email (minuscules), message_text,
--   service_id (déjà vérifié : prestation active du praticien) ou NULL,
--   service_hint, modality, preferred_period, proposed_starts_at,
--   confidence, missing (tableau de textes)
--
-- Retour : { ok, request_id, outcome: created | updated | duplicate, ... }

CREATE OR REPLACE FUNCTION public.lumia_upsert_booking_request(
  p_practitioner_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent TEXT := p_payload->>'agent';
  v_channel TEXT := p_payload->>'channel';
  v_message_id TEXT := p_payload->>'message_id';
  v_conversation TEXT := nullif(p_payload->>'conversation_id', '');
  v_first TEXT := nullif(btrim(p_payload->>'first_name'), '');
  v_last TEXT := nullif(btrim(p_payload->>'last_name'), '');
  v_phone TEXT := public.lumia_normalize_phone(p_payload->>'phone');
  v_email TEXT := nullif(lower(btrim(p_payload->>'email')), '');
  v_text TEXT := nullif(left(p_payload->>'message_text', 2000), '');
  v_service UUID := nullif(p_payload->>'service_id', '')::UUID;
  v_hint TEXT := nullif(left(p_payload->>'service_hint', 120), '');
  v_modality TEXT := coalesce(nullif(p_payload->>'modality', ''), 'unknown');
  v_period TEXT := nullif(left(p_payload->>'preferred_period', 200), '');
  v_proposed TIMESTAMPTZ := nullif(p_payload->>'proposed_starts_at', '')::TIMESTAMPTZ;
  v_message_at TIMESTAMPTZ := nullif(p_payload->>'message_at', '')::TIMESTAMPTZ;
  v_detected_at TIMESTAMPTZ := coalesce(nullif(p_payload->>'detected_at', '')::TIMESTAMPTZ, now());
  v_confidence NUMERIC := nullif(p_payload->>'confidence', '')::NUMERIC;
  v_missing TEXT[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'missing', '[]'::jsonb))), '{}');
  v_event public.booking_request_intake_events;
  v_request public.booking_requests;
  v_phone_ids TEXT[];
  v_phone_emails TEXT[];
  v_phone_first_names TEXT[];
  v_identity TEXT;
  v_phone_ambiguous BOOLEAN := false;
  v_history JSONB;
  v_customer UUID;
  v_suggestion UUID;
  v_match TEXT := 'none';
  v_fill_email TEXT;
  v_fill_last TEXT;
  v_fill_phone TEXT;
  v_review BOOLEAN;
BEGIN
  IF p_practitioner_id IS NULL OR v_agent IS NULL OR v_channel IS NULL OR v_message_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_intake');
  END IF;

  -- Sérialisation : même conversation, puis même message (ordre constant).
  IF v_conversation IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('lumia-conv:' || p_practitioner_id::TEXT || ':' || v_channel || ':' || v_conversation));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lumia-msg:' || v_channel || ':' || v_message_id));

  -- Message déjà importé : on renvoie la demande existante, sans rien changer.
  SELECT * INTO v_event FROM public.booking_request_intake_events
  WHERE source_channel = v_channel AND source_message_id = v_message_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'duplicate', 'request_id', v_event.request_id);
  END IF;

  -- Rapprochement client, sources fiables uniquement (référentiel clients,
  -- rendez-vous MediumIA, formulaire du site — jamais les demandes d'agent) :
  --   1. téléphone exact normalisé ; 2. e-mail exact ;
  --   3. nom/prénom : simple suggestion (customer_suggestion_id), jamais fusion.
  -- Un doute → « ambiguous », rien n'est complété ni relié.
  IF v_phone IS NOT NULL THEN
    SELECT array_agg(DISTINCT k.identity),
           array_agg(DISTINCT k.email) FILTER (WHERE k.email IS NOT NULL),
           array_agg(DISTINCT lower(k.first_name)) FILTER (WHERE k.first_name IS NOT NULL),
           coalesce(bool_or(k.ambiguous), false)
    INTO v_phone_ids, v_phone_emails, v_phone_first_names, v_phone_ambiguous
    FROM public.lumia_known_customers(p_practitioner_id) k
    WHERE k.phone = v_phone;
  END IF;

  IF v_phone_ambiguous THEN
    v_match := 'ambiguous';              -- fiche client déjà marquée ambiguë (numéro partagé)
  ELSIF v_email IS NOT NULL AND coalesce(cardinality(v_phone_emails), 0) > 0 AND NOT (v_email = ANY (v_phone_emails)) THEN
    v_match := 'ambiguous';              -- téléphone connu sous une autre adresse
  ELSIF coalesce(cardinality(v_phone_ids), 0) > 1 THEN
    v_match := 'ambiguous';              -- numéro partagé par plusieurs clients
  ELSIF coalesce(cardinality(v_phone_ids), 0) = 1 THEN
    -- Même téléphone mais prénom différent (proche, famille…) : pas de fusion.
    IF v_first IS NOT NULL AND NOT (lower(v_first) = ANY (coalesce(v_phone_first_names, '{}'))) THEN
      v_match := 'ambiguous';
    ELSE
      v_match := 'phone';
      v_identity := v_phone_ids[1];
      v_fill_email := v_phone_emails[1];
    END IF;
  ELSIF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.lumia_known_customers(p_practitioner_id) k WHERE k.email = v_email AND k.ambiguous) THEN
    v_match := 'ambiguous';              -- e-mail partagé (fiche ambiguë)
  ELSIF v_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.lumia_known_customers(p_practitioner_id) k WHERE k.email = v_email) THEN
    v_match := 'email';
    v_identity := v_email;
  END IF;

  IF v_match IN ('phone', 'email') THEN
    SELECT k.last_name, k.phone INTO v_fill_last, v_fill_phone
    FROM public.lumia_known_customers(p_practitioner_id) k
    WHERE k.identity = v_identity AND k.last_name IS NOT NULL
    ORDER BY k.seen_at DESC
    LIMIT 1;
    -- Fiche du référentiel clients, si elle est unique.
    SELECT CASE WHEN count(*) = 1 THEN min(c.id::TEXT)::UUID END INTO v_customer
    FROM public.mediumia_customers c
    WHERE c.practitioner_id = p_practitioner_id AND c.identity_status = 'ok'
      AND ((v_match = 'phone' AND c.phone_e164 = v_phone) OR (v_match = 'email' AND c.email = v_email));
    -- Historique MediumIA du client reconnu (pour l'agent : rendez-vous passés).
    SELECT jsonb_build_object('bookings', count(*), 'last_starts_at', max(b.starts_at)) INTO v_history
    FROM public.bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND (lower(b.customer_email) = coalesce(v_email, v_fill_email)
           OR (v_phone IS NOT NULL AND public.lumia_normalize_phone(b.customer_phone) = v_phone));
  ELSIF v_match = 'none' AND v_first IS NOT NULL AND v_last IS NOT NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(c.id::TEXT)::UUID END INTO v_suggestion
    FROM public.mediumia_customers c
    WHERE c.practitioner_id = p_practitioner_id
      AND public.mediumia_name_key(c.first_name) = public.mediumia_name_key(v_first)
      AND public.mediumia_name_key(c.last_name) = public.mediumia_name_key(v_last);
  END IF;

  -- Message d'une conversation déjà ouverte : mise à jour de cette demande.
  IF v_conversation IS NOT NULL THEN
    SELECT * INTO v_request FROM public.booking_requests
    WHERE practitioner_id = p_practitioner_id
      AND intake_agent IS NOT NULL
      AND source_channel = v_channel
      AND source_conversation_id = v_conversation
      AND status IN ('pending', 'contacted')
      AND confirmed_booking_id IS NULL
      AND coalesce(lumia_updated_at, created_at) > now() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_request.id IS NOT NULL THEN
    UPDATE public.booking_requests SET
      service_id = coalesce(service_id, v_service),
      service_hint = coalesce(v_hint, service_hint),
      customer_first_name = coalesce(customer_first_name, v_first),
      customer_last_name = coalesce(customer_last_name, v_last, v_fill_last),
      customer_email = coalesce(customer_email, v_email, v_fill_email),
      customer_phone = coalesce(customer_phone, v_phone),
      customer_message = left(concat_ws(E'\n— ', customer_message, v_text), 4000),
      requested_modality = CASE WHEN v_modality <> 'unknown' THEN v_modality ELSE requested_modality END,
      preferred_period = coalesce(v_period, preferred_period),
      proposed_starts_at = coalesce(v_proposed, proposed_starts_at),
      customer_match = CASE WHEN customer_match IN ('phone', 'email') THEN customer_match ELSE v_match END,
      customer_id = coalesce(customer_id, v_customer),
      customer_suggestion_id = CASE WHEN coalesce(customer_id, v_customer) IS NULL THEN coalesce(v_suggestion, customer_suggestion_id) END,
      intake_missing = v_missing,
      intake_confidence = coalesce(v_confidence, intake_confidence),
      lumia_updated_at = now(),
      updated_at = now()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    v_review := v_request.service_id IS NULL OR v_request.customer_match = 'ambiguous'
      OR v_request.customer_email IS NULL OR v_request.customer_last_name IS NULL OR v_request.customer_first_name IS NULL;
    UPDATE public.booking_requests SET needs_review = v_review WHERE id = v_request.id;

    INSERT INTO public.booking_request_intake_events(
      request_id, intake_agent, source_channel, source_message_id, source_conversation_id, source_message_at, detected_at, action
    ) VALUES (v_request.id, v_agent, v_channel, v_message_id, v_conversation, v_message_at, v_detected_at, 'updated');

    RETURN jsonb_build_object('ok', true, 'outcome', 'updated', 'request_id', v_request.id,
      'customer_match', v_request.customer_match, 'customer_id', v_request.customer_id,
      'customer_suggestion_id', v_request.customer_suggestion_id, 'customer_history', v_history, 'needs_review', v_review);
  END IF;

  v_review := v_service IS NULL OR v_match = 'ambiguous'
    OR coalesce(v_email, v_fill_email) IS NULL OR coalesce(v_last, v_fill_last) IS NULL OR v_first IS NULL;

  INSERT INTO public.booking_requests(
    practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, customer_phone,
    customer_message, preferred_period, status,
    intake_agent, source_channel, source_message_id, source_conversation_id, source_message_at, detected_at,
    requested_modality, proposed_starts_at, service_hint, customer_match, intake_missing, intake_confidence,
    needs_review, lumia_updated_at, customer_id, customer_suggestion_id
  ) VALUES (
    p_practitioner_id, v_service, v_first, coalesce(v_last, v_fill_last), coalesce(v_email, v_fill_email),
    coalesce(v_phone, v_fill_phone),
    v_text, v_period, 'pending',
    v_agent, v_channel, v_message_id, v_conversation, v_message_at, v_detected_at,
    v_modality, v_proposed, v_hint, v_match, v_missing, v_confidence,
    v_review, now(), v_customer, v_suggestion
  ) RETURNING * INTO v_request;

  INSERT INTO public.booking_request_intake_events(
    request_id, intake_agent, source_channel, source_message_id, source_conversation_id, source_message_at, detected_at, action
  ) VALUES (v_request.id, v_agent, v_channel, v_message_id, v_conversation, v_message_at, v_detected_at, 'created');

  RETURN jsonb_build_object('ok', true, 'outcome', 'created', 'request_id', v_request.id,
    'customer_match', v_match, 'customer_id', v_customer, 'customer_suggestion_id', v_suggestion,
    'customer_history', v_history, 'needs_review', v_review);
EXCEPTION
  WHEN unique_violation THEN
    -- Filet de sécurité (le verrou l'évite) : même message déjà enregistré.
    SELECT * INTO v_event FROM public.booking_request_intake_events
    WHERE source_channel = v_channel AND source_message_id = v_message_id;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'duplicate', 'request_id', v_event.request_id);
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.lumia_upsert_booking_request(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_upsert_booking_request(UUID, JSONB) TO service_role;
