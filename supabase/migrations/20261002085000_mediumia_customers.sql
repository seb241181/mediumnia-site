-- Référentiel clients MediumIA — distinct de booking_requests et de bookings
-- (un client n'est pas une demande de rendez-vous).
--
-- But : une source fiable pour reconnaître un client (Lumia), qui pourra
-- recevoir plus tard l'export clients Reservio. AUCUN import n'est fait ici :
-- les tables sont créées vides.
--
-- Données de gestion uniquement : prénom, nom, e-mail normalisé, téléphone
-- normalisé, provenance, identifiant externe éventuel, dates. Les champs
-- Reservio « note », « address » et « birthday » ne sont pas stockés.
--
-- Rapprochement (jamais sur le nom seul) :
--   1. téléphone normalisé exact ; 2. e-mail normalisé exact ;
--   3. téléphone + e-mail concordants = forte confiance ;
--   4. nom / prénom = aide à la vérification uniquement.
-- Même téléphone (ou e-mail) avec un autre nom : fiche distincte, et les fiches
-- concernées passent en « ambiguous » au lieu d'être fusionnées.
--
-- Écrasement : chaque champ garde sa provenance et sa date (field_sources).
-- Une valeur n'est remplacée que par une valeur plus récente ; une valeur
-- sans date ne remplace jamais une valeur existante ; un vide n'efface rien.
--
-- Consentements : table séparée. privacy_policy ≠ marketing. Aucun usage
-- automatique (aucune communication commerciale) en phase 1.
--
-- Service_role uniquement. Idempotente.

-- ── 1. Clients ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mediumia_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  first_name TEXT,
  last_name TEXT,
  email TEXT CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone_e164 TEXT CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Provenance de la fiche (création) ; la provenance de chaque champ est dans field_sources.
  source TEXT NOT NULL CHECK (source IN ('mediumia', 'reservio', 'manual')),
  external_id TEXT,
  -- { "email": { "source": "reservio", "at": "2026-…" }, … }
  field_sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  identity_status TEXT NOT NULL DEFAULT 'ok' CHECK (identity_status IN ('ok', 'ambiguous')),
  imported_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mediumia_customers_external
  ON public.mediumia_customers (practitioner_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mediumia_customers_phone
  ON public.mediumia_customers (practitioner_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mediumia_customers_email
  ON public.mediumia_customers (practitioner_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mediumia_customers_name
  ON public.mediumia_customers (practitioner_id, lower(last_name), lower(first_name));

ALTER TABLE public.mediumia_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mediumia_customers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mediumia_customers TO service_role;

-- ── 2. Consentements (séparés des données de gestion) ──────────────────────
--
-- Reservio : privacyPolicyAcceptedAt → kind = privacy_policy (ce n'est PAS un
-- consentement marketing) ; marketingNotificationsAcceptedAt → kind = marketing
-- (trace de l'ancien consentement). Rien ne les utilise pour envoyer quoi que
-- ce soit en phase 1.

CREATE TABLE IF NOT EXISTS public.mediumia_customer_consents (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.mediumia_customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('privacy_policy', 'marketing')),
  source TEXT NOT NULL CHECK (source IN ('mediumia', 'reservio', 'manual')),
  accepted_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, kind, source)
);

ALTER TABLE public.mediumia_customer_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mediumia_customer_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mediumia_customer_consents TO service_role;

-- ── 3. Aides ────────────────────────────────────────────────────────────────

-- Clé de comparaison d'un nom (aide à la vérification, jamais critère de fusion).
CREATE OR REPLACE FUNCTION public.mediumia_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(regexp_replace(lower(translate(coalesce(p_name, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿŒœÆæ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyyOoAa')), '[^a-z]', '', 'g'), '');
$$;

-- Deux noms sont compatibles si l'un manque ou s'ils sont identiques (clé).
CREATE OR REPLACE FUNCTION public.mediumia_names_compatible(a_first TEXT, a_last TEXT, b_first TEXT, b_last TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (public.mediumia_name_key(a_first) IS NULL OR public.mediumia_name_key(b_first) IS NULL
          OR public.mediumia_name_key(a_first) = public.mediumia_name_key(b_first))
     AND (public.mediumia_name_key(a_last) IS NULL OR public.mediumia_name_key(b_last) IS NULL
          OR public.mediumia_name_key(a_last) = public.mediumia_name_key(b_last));
$$;

REVOKE ALL ON FUNCTION public.mediumia_name_key(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mediumia_names_compatible(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_name_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mediumia_names_compatible(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── 4. Écriture contrôlée d'une fiche (pour le futur import) ───────────────
--
-- Retour : { ok, outcome, customer_id, confidence }
--   outcome    : created | updated | unchanged | created_ambiguous
--   confidence : external_id | strong (téléphone + e-mail) | phone | email | new
-- Rien ne l'appelle encore : aucun import n'est fait par cette migration.

CREATE OR REPLACE FUNCTION public.upsert_mediumia_customer(
  p_practitioner_id UUID,
  p_source TEXT,
  p_external_id TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_phone_e164 TEXT,
  p_source_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first TEXT := nullif(btrim(p_first_name), '');
  v_last TEXT := nullif(btrim(p_last_name), '');
  v_email TEXT := nullif(lower(btrim(p_email)), '');
  v_phone TEXT := nullif(btrim(p_phone_e164), '');
  v_external TEXT := nullif(btrim(p_external_id), '');
  v_target public.mediumia_customers;
  v_conflict BOOLEAN := false;
  v_confidence TEXT := 'new';
  v_sources JSONB;
  v_changed BOOLEAN := false;
  v_field TEXT;
  v_new TEXT;
  v_old TEXT;
  v_old_at TIMESTAMPTZ;
BEGIN
  IF p_practitioner_id IS NULL OR p_source NOT IN ('mediumia', 'reservio', 'manual') OR (v_email IS NULL AND v_phone IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_customer');
  END IF;

  -- Un seul import à la fois pour un même praticien (rapprochement cohérent).
  PERFORM pg_advisory_xact_lock(hashtext('customers:' || p_practitioner_id::TEXT));

  -- 0. Identifiant externe : clé exacte.
  IF v_external IS NOT NULL THEN
    SELECT * INTO v_target FROM public.mediumia_customers
    WHERE practitioner_id = p_practitioner_id AND source = p_source AND external_id = v_external FOR UPDATE;
    IF v_target.id IS NOT NULL THEN v_confidence := 'external_id'; END IF;
  END IF;

  -- 1-3. Téléphone exact, puis e-mail exact ; le nom ne sert qu'à vérifier.
  IF v_target.id IS NULL AND v_phone IS NOT NULL THEN
    SELECT * INTO v_target FROM public.mediumia_customers
    WHERE practitioner_id = p_practitioner_id AND phone_e164 = v_phone
      AND public.mediumia_names_compatible(first_name, last_name, v_first, v_last)
    ORDER BY (v_email IS NOT NULL AND email = v_email) DESC, updated_at DESC
    LIMIT 1 FOR UPDATE;
    IF v_target.id IS NOT NULL THEN
      v_confidence := CASE WHEN v_email IS NOT NULL AND v_target.email = v_email THEN 'strong' ELSE 'phone' END;
    ELSIF EXISTS (SELECT 1 FROM public.mediumia_customers WHERE practitioner_id = p_practitioner_id AND phone_e164 = v_phone) THEN
      v_conflict := true;   -- même téléphone, autre nom
    END IF;
  END IF;

  IF v_target.id IS NULL AND NOT v_conflict AND v_email IS NOT NULL THEN
    SELECT * INTO v_target FROM public.mediumia_customers
    WHERE practitioner_id = p_practitioner_id AND email = v_email
      AND public.mediumia_names_compatible(first_name, last_name, v_first, v_last)
    ORDER BY updated_at DESC
    LIMIT 1 FOR UPDATE;
    IF v_target.id IS NOT NULL THEN
      v_confidence := 'email';
    ELSIF EXISTS (SELECT 1 FROM public.mediumia_customers WHERE practitioner_id = p_practitioner_id AND email = v_email) THEN
      v_conflict := true;   -- même e-mail, autre nom
    END IF;
  END IF;

  -- Nouvelle fiche (éventuellement ambiguë : jamais de fusion sur doute).
  IF v_target.id IS NULL THEN
    v_sources := '{}'::jsonb;
    FOREACH v_field IN ARRAY ARRAY['first_name', 'last_name', 'email', 'phone_e164'] LOOP
      v_new := CASE v_field WHEN 'first_name' THEN v_first WHEN 'last_name' THEN v_last WHEN 'email' THEN v_email ELSE v_phone END;
      IF v_new IS NOT NULL THEN
        v_sources := v_sources || jsonb_build_object(v_field, jsonb_build_object('source', p_source, 'at', p_source_updated_at));
      END IF;
    END LOOP;
    INSERT INTO public.mediumia_customers(practitioner_id, first_name, last_name, email, phone_e164, source, external_id,
      field_sources, identity_status, imported_at, source_updated_at)
    VALUES (p_practitioner_id, v_first, v_last, v_email, v_phone, p_source, v_external,
      v_sources, CASE WHEN v_conflict THEN 'ambiguous' ELSE 'ok' END,
      CASE WHEN p_source = 'mediumia' THEN NULL ELSE now() END, p_source_updated_at)
    RETURNING * INTO v_target;
    IF v_conflict THEN
      UPDATE public.mediumia_customers SET identity_status = 'ambiguous', updated_at = now()
      WHERE practitioner_id = p_practitioner_id AND identity_status <> 'ambiguous'
        AND ((v_phone IS NOT NULL AND phone_e164 = v_phone) OR (v_email IS NOT NULL AND email = v_email));
      RETURN jsonb_build_object('ok', true, 'outcome', 'created_ambiguous', 'customer_id', v_target.id, 'confidence', 'new');
    END IF;
    RETURN jsonb_build_object('ok', true, 'outcome', 'created', 'customer_id', v_target.id, 'confidence', 'new');
  END IF;

  -- Fiche existante : champ par champ, jamais plus ancien, jamais sans date,
  -- jamais vidé.
  v_sources := v_target.field_sources;
  FOREACH v_field IN ARRAY ARRAY['first_name', 'last_name', 'email', 'phone_e164'] LOOP
    v_new := CASE v_field WHEN 'first_name' THEN v_first WHEN 'last_name' THEN v_last WHEN 'email' THEN v_email ELSE v_phone END;
    v_old := CASE v_field WHEN 'first_name' THEN v_target.first_name WHEN 'last_name' THEN v_target.last_name
                          WHEN 'email' THEN v_target.email ELSE v_target.phone_e164 END;
    v_old_at := nullif(v_sources->v_field->>'at', '')::TIMESTAMPTZ;
    CONTINUE WHEN v_new IS NULL OR v_new = v_old;
    IF v_old IS NULL OR (p_source_updated_at IS NOT NULL AND v_old_at IS NOT NULL AND p_source_updated_at > v_old_at) THEN
      v_sources := v_sources || jsonb_build_object(v_field, jsonb_build_object('source', p_source, 'at', p_source_updated_at));
      v_changed := true;
      IF v_field = 'first_name' THEN v_target.first_name := v_new;
      ELSIF v_field = 'last_name' THEN v_target.last_name := v_new;
      ELSIF v_field = 'email' THEN v_target.email := v_new;
      ELSE v_target.phone_e164 := v_new;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_changed THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'unchanged', 'customer_id', v_target.id, 'confidence', v_confidence);
  END IF;

  UPDATE public.mediumia_customers SET
    first_name = v_target.first_name,
    last_name = v_target.last_name,
    email = v_target.email,
    phone_e164 = v_target.phone_e164,
    field_sources = v_sources,
    imported_at = CASE WHEN p_source = 'mediumia' THEN imported_at ELSE now() END,
    source_updated_at = greatest(source_updated_at, p_source_updated_at),
    updated_at = now()
  WHERE id = v_target.id;
  RETURN jsonb_build_object('ok', true, 'outcome', 'updated', 'customer_id', v_target.id, 'confidence', v_confidence);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_mediumia_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mediumia_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── 5. Consentement (trace uniquement) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_mediumia_customer_consent(
  p_customer_id UUID,
  p_kind TEXT,
  p_source TEXT,
  p_accepted_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF p_customer_id IS NULL OR p_accepted_at IS NULL OR p_kind NOT IN ('privacy_policy', 'marketing')
     OR p_source NOT IN ('mediumia', 'reservio', 'manual') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_consent');
  END IF;
  INSERT INTO public.mediumia_customer_consents(customer_id, kind, source, accepted_at)
  VALUES (p_customer_id, p_kind, p_source, p_accepted_at)
  ON CONFLICT (customer_id, kind, source) DO NOTHING
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'outcome', CASE WHEN v_id IS NULL THEN 'already_recorded' ELSE 'recorded' END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_mediumia_customer_consent(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_mediumia_customer_consent(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
