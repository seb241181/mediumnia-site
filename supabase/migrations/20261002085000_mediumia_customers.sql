-- Référentiel clients MediumIA — distinct de booking_requests et de bookings.
--
-- But : une source fiable pour reconnaître un client (Lumia, et plus tard
-- l'import de l'export clients Reservio). AUCUN import n'est fait ici : la
-- table est créée vide.
--
-- Contenu volontairement minimal : uniquement ce qui sert à gérer les
-- rendez-vous (nom, prénom, e-mail, téléphone) + la provenance. Pas de champs
-- Reservio superflus, et AUCUN consentement marketing : s'il en faut un un
-- jour, il ira dans une table séparée (ex. customer_marketing_consents, avec
-- canal, date, preuve et retrait), jamais mélangé à ces données de gestion.
--
-- Écrasement : upsert_mediumia_customer ne remplace une fiche que par des
-- données plus récentes à la source (source_updated_at), et ne vide jamais un
-- champ déjà renseigné. Service_role uniquement. Idempotente.

CREATE TABLE IF NOT EXISTS public.mediumia_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  first_name TEXT,
  last_name TEXT,
  email TEXT CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone_e164 TEXT CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  source TEXT NOT NULL CHECK (source IN ('mediumia', 'reservio', 'manual')),
  external_id TEXT,
  imported_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CHECK (source = 'mediumia' OR source = 'manual' OR external_id IS NOT NULL)
);

-- Une fiche par identifiant externe et par provenance (ré-import idempotent).
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

-- ── Écriture contrôlée (pour le futur import, rien ne l'appelle encore) ─────
--
-- Retour : { ok, outcome: created | updated | stale, customer_id }
-- - Reservio (et toute provenance externe) : clé = identifiant externe.
-- - mediumia / manual : rapprochement par téléphone exact, puis e-mail exact.
-- - stale : la fiche existante est plus récente à la source → rien n'est écrit.

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
  v_existing public.mediumia_customers;
  v_email TEXT := nullif(lower(btrim(p_email)), '');
  v_phone TEXT := nullif(btrim(p_phone_e164), '');
  v_external TEXT := nullif(btrim(p_external_id), '');
BEGIN
  IF p_practitioner_id IS NULL OR p_source NOT IN ('mediumia', 'reservio', 'manual') OR (v_email IS NULL AND v_phone IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_customer');
  END IF;
  IF p_source = 'reservio' AND v_external IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'external_id_required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('customer:' || p_practitioner_id::TEXT || ':' || coalesce(v_external, v_phone, v_email)));

  IF v_external IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.mediumia_customers
    WHERE practitioner_id = p_practitioner_id AND source = p_source AND external_id = v_external FOR UPDATE;
  ELSE
    SELECT * INTO v_existing FROM public.mediumia_customers
    WHERE practitioner_id = p_practitioner_id AND source = p_source
      AND ((v_phone IS NOT NULL AND phone_e164 = v_phone) OR (v_phone IS NULL AND email = v_email))
    ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.mediumia_customers(practitioner_id, first_name, last_name, email, phone_e164, source, external_id, imported_at, source_updated_at)
    VALUES (p_practitioner_id, nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''), v_email, v_phone, p_source, v_external,
            CASE WHEN p_source = 'mediumia' THEN NULL ELSE now() END, p_source_updated_at)
    RETURNING * INTO v_existing;
    RETURN jsonb_build_object('ok', true, 'outcome', 'created', 'customer_id', v_existing.id);
  END IF;

  -- Protection : jamais remplacer une fiche par des données plus anciennes.
  IF v_existing.source_updated_at IS NOT NULL
     AND (p_source_updated_at IS NULL OR p_source_updated_at <= v_existing.source_updated_at) THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'stale', 'customer_id', v_existing.id);
  END IF;

  UPDATE public.mediumia_customers SET
    first_name = coalesce(nullif(btrim(p_first_name), ''), first_name),
    last_name = coalesce(nullif(btrim(p_last_name), ''), last_name),
    email = coalesce(v_email, email),
    phone_e164 = coalesce(v_phone, phone_e164),
    imported_at = CASE WHEN p_source = 'mediumia' THEN imported_at ELSE now() END,
    source_updated_at = coalesce(p_source_updated_at, source_updated_at),
    updated_at = now()
  WHERE id = v_existing.id;
  RETURN jsonb_build_object('ok', true, 'outcome', 'updated', 'customer_id', v_existing.id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_mediumia_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_mediumia_customer(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
