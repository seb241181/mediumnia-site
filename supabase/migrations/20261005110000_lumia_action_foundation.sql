-- Lumia Phase 3A — socle d'actions préparées, jamais exécutées ici.
--
-- Cette migration ne modifie PAS bookings, Google Agenda ni Messages.app.
-- Elle ne fait qu'enregistrer un preview immuable, son approbation humaine et
-- le cycle de vie technique qui permettra une exécution future contrôlée.
-- Les RPC sont réservés au service_role ; le navigateur ne peut ni créer, ni
-- approuver, ni réclamer une action directement.

CREATE TABLE IF NOT EXISTS public.lumia_action_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identifiant d'affichage : pratique pour le praticien, jamais un secret.
  short_code TEXT NOT NULL UNIQUE CHECK (short_code ~ '^#[A-Z0-9]{6}$'),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  practitioner_id UUID REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'mediumia.booking.create',
    'mediumia.booking.update',
    'mediumia.booking.cancel',
    'google.event.create',
    'google.event.update',
    'google.event.cancel',
    'message.send'
  )),
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN (
    'preview', 'approved', 'executing', 'succeeded', 'failed',
    'compensation_required', 'expired'
  )),
  -- La cible est résolue côté serveur. Aucune référence libre du modèle n'est
  -- exécutable ; les créations futures emploieront target_source = none.
  target_source TEXT NOT NULL DEFAULT 'none' CHECK (target_source IN (
    'none', 'mediumia_booking', 'google_event', 'message_conversation'
  )),
  target_id TEXT,
  expected_version INTEGER CHECK (expected_version IS NULL OR expected_version >= 1),
  expected_target_updated_at TIMESTAMPTZ,
  target_google_etag TEXT CHECK (target_google_etag IS NULL OR char_length(target_google_etag) BETWEEN 1 AND 1024),
  -- Le JSONB est canonique dans PostgreSQL ; payload_hash est calculé par RPC
  -- depuis sa représentation textuelle canonique, jamais fourni par le client.
  canonical_payload JSONB NOT NULL CHECK (jsonb_typeof(canonical_payload) = 'object' AND octet_length(canonical_payload::text) <= 16384),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  -- Preview minimal : ni description Google, ni participants, ni historique SMS.
  preview JSONB NOT NULL CHECK (
    jsonb_typeof(preview) = 'object'
    AND octet_length(preview::text) <= 8192
    AND NOT (preview ?| ARRAY['description', 'attendees', 'participants', 'notes', 'private_content', 'message_history'])
  ),
  preview_expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,200}$'),
  approved_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_result JSONB CHECK (
    execution_result IS NULL OR (
      jsonb_typeof(execution_result) = 'object'
      AND octet_length(execution_result::text) <= 4096
      AND NOT (execution_result ?| ARRAY['description', 'attendees', 'participants', 'message_text', 'private_content'])
    )
  ),
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lumia_action_intents_agent_owner_fkey
    FOREIGN KEY (agent_id, owner_id) REFERENCES public.agents(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT lumia_action_intents_conversation_agent_owner_fkey
    FOREIGN KEY (conversation_id, agent_id, owner_id)
    REFERENCES public.agent_conversations(id, agent_id, owner_id) ON DELETE CASCADE,
  CONSTRAINT lumia_action_intents_target_check CHECK (
    (target_source = 'none' AND target_id IS NULL)
    OR (target_source <> 'none' AND target_id IS NOT NULL AND char_length(target_id) BETWEEN 1 AND 512)
  ),
  CONSTRAINT lumia_action_intents_approval_check CHECK (
    (status = 'preview' AND approved_by IS NULL AND approved_at IS NULL AND claimed_at IS NULL AND executed_at IS NULL AND expired_at IS NULL)
    OR (status = 'approved' AND approved_by = owner_id AND approved_at IS NOT NULL AND claimed_at IS NULL AND executed_at IS NULL AND expired_at IS NULL)
    OR (status = 'executing' AND approved_by = owner_id AND approved_at IS NOT NULL AND claimed_at IS NOT NULL AND executed_at IS NULL AND expired_at IS NULL)
    OR (status IN ('succeeded', 'failed', 'compensation_required') AND approved_by = owner_id AND approved_at IS NOT NULL AND claimed_at IS NOT NULL AND executed_at IS NOT NULL AND expired_at IS NULL)
    OR (status = 'expired' AND expired_at IS NOT NULL AND executed_at IS NULL)
  ),
  CONSTRAINT lumia_action_intents_idempotency_key_unique UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS lumia_action_intents_owner_conversation_active_idx
  ON public.lumia_action_intents (owner_id, conversation_id, status, preview_expires_at);
CREATE INDEX IF NOT EXISTS lumia_action_intents_expiry_idx
  ON public.lumia_action_intents (status, preview_expires_at)
  WHERE status IN ('preview', 'approved');
CREATE INDEX IF NOT EXISTS lumia_action_intents_target_idx
  ON public.lumia_action_intents (owner_id, target_source, target_id)
  WHERE target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lumia_action_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES public.lumia_action_intents(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'approved', 'claimed', 'finished', 'expired')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('server', 'owner', 'executor')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Uniquement le résultat technique minimal : pas de texte client, ni détails
  -- Google privés. Le payload complet éventuel reste dans l'intent privé.
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(detail) = 'object'
    AND octet_length(detail::text) <= 4096
    AND NOT (detail ?| ARRAY['description', 'attendees', 'participants', 'message_text', 'private_content', 'canonical_payload'])
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lumia_action_attempts_intent_created_idx
  ON public.lumia_action_attempts (intent_id, created_at, id);
CREATE INDEX IF NOT EXISTS lumia_action_attempts_owner_created_idx
  ON public.lumia_action_attempts (owner_id, created_at DESC);

ALTER TABLE public.lumia_action_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_action_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_action_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_action_attempts FORCE ROW LEVEL SECURITY;

-- Aucune Data API publique. Les futurs écrans passeront par l'API serveur,
-- qui vérifiera la session puis appellera ces RPC avec service_role.
REVOKE ALL ON TABLE public.lumia_action_intents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lumia_action_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lumia_action_intents TO service_role;
GRANT ALL ON TABLE public.lumia_action_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lumia_action_attempts_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.lumia_require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_service_role_required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lumia_new_action_short_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, pg_temp
AS $$
  SELECT '#' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

CREATE OR REPLACE FUNCTION public.lumia_create_action_intent(
  p_owner_id UUID,
  p_agent_id UUID,
  p_conversation_id UUID,
  p_practitioner_id UUID,
  p_action_type TEXT,
  p_target_source TEXT,
  p_target_id TEXT,
  p_expected_version INTEGER,
  p_expected_target_updated_at TIMESTAMPTZ,
  p_target_google_etag TEXT,
  p_canonical_payload JSONB,
  p_preview JSONB,
  p_preview_expires_at TIMESTAMPTZ,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash TEXT;
  v_intent public.lumia_action_intents;
  v_short_code TEXT;
  v_inserted BOOLEAN := false;
  v_tries INTEGER := 0;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_owner_id IS NULL OR p_agent_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_owner_agent_conversation_required';
  END IF;
  IF p_canonical_payload IS NULL OR jsonb_typeof(p_canonical_payload) <> 'object'
    OR p_preview IS NULL OR jsonb_typeof(p_preview) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_invalid_preview_payload';
  END IF;
  IF p_preview_expires_at <= clock_timestamp() OR p_preview_expires_at > clock_timestamp() + interval '30 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_invalid_preview_expiry';
  END IF;
  IF (p_action_type LIKE 'mediumia.booking.%' OR p_action_type LIKE 'google.event.%')
    AND p_practitioner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_practitioner_required';
  END IF;

  -- Vérification explicite owner/agent/conversation avant toute insertion.
  PERFORM 1
  FROM public.agent_conversations c
  WHERE c.id = p_conversation_id AND c.agent_id = p_agent_id AND c.owner_id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_conversation_not_owned';
  END IF;

  v_hash := encode(extensions.digest(p_canonical_payload::text, 'sha256'), 'hex');
  SELECT * INTO v_intent
  FROM public.lumia_action_intents
  WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_intent.payload_hash <> v_hash
      OR v_intent.action_type <> p_action_type
      OR v_intent.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'lumia_idempotency_key_reused_with_different_action';
    END IF;
    RETURN jsonb_build_object(
      'intent_id', v_intent.id, 'short_code', v_intent.short_code,
      'status', v_intent.status, 'payload_hash', v_intent.payload_hash,
      'preview', v_intent.preview, 'preview_expires_at', v_intent.preview_expires_at,
      'idempotent', true
    );
  END IF;

  -- Collision de code court : exceptionnel, mais traité sans réutiliser un code.
  WHILE NOT v_inserted AND v_tries < 8 LOOP
    v_tries := v_tries + 1;
    v_short_code := public.lumia_new_action_short_code();
    BEGIN
      INSERT INTO public.lumia_action_intents (
        short_code, owner_id, agent_id, conversation_id, practitioner_id,
        action_type, target_source, target_id, expected_version,
        expected_target_updated_at, target_google_etag, canonical_payload,
        payload_hash, preview, preview_expires_at, idempotency_key
      ) VALUES (
        v_short_code, p_owner_id, p_agent_id, p_conversation_id, p_practitioner_id,
        p_action_type, COALESCE(p_target_source, 'none'), NULLIF(p_target_id, ''), p_expected_version,
        p_expected_target_updated_at, NULLIF(p_target_google_etag, ''), p_canonical_payload,
        v_hash, p_preview, p_preview_expires_at, p_idempotency_key
      ) RETURNING * INTO v_intent;
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      -- Une course sur l'idempotency_key doit retourner l'intent existant ; une
      -- collision de short_code est simplement retentée.
      SELECT * INTO v_intent
      FROM public.lumia_action_intents
      WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key
      FOR UPDATE;
      IF FOUND THEN
        IF v_intent.payload_hash <> v_hash
          OR v_intent.action_type <> p_action_type
          OR v_intent.conversation_id <> p_conversation_id THEN
          RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'lumia_idempotency_key_reused_with_different_action';
        END IF;
        RETURN jsonb_build_object(
          'intent_id', v_intent.id, 'short_code', v_intent.short_code,
          'status', v_intent.status, 'payload_hash', v_intent.payload_hash,
          'preview', v_intent.preview, 'preview_expires_at', v_intent.preview_expires_at,
          'idempotent', true
        );
      END IF;
    END;
  END LOOP;
  IF NOT v_inserted THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'lumia_short_code_collision_retry';
  END IF;

  INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'created', 'server', NULL,
    jsonb_build_object('payload_hash', v_hash, 'action_type', p_action_type));
  RETURN jsonb_build_object(
    'intent_id', v_intent.id, 'short_code', v_intent.short_code,
    'status', v_intent.status, 'payload_hash', v_intent.payload_hash,
    'preview', v_intent.preview, 'preview_expires_at', v_intent.preview_expires_at,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lumia_approve_action_intent(
  p_owner_id UUID,
  p_conversation_id UUID,
  p_intent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.lumia_action_intents;
BEGIN
  PERFORM public.lumia_require_service_role();
  SELECT * INTO v_intent FROM public.lumia_action_intents
  WHERE id = p_intent_id AND owner_id = p_owner_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_intent_not_owned_in_conversation';
  END IF;
  IF v_intent.status IN ('succeeded', 'failed', 'compensation_required') THEN
    RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'idempotent', true);
  END IF;
  IF v_intent.status <> 'preview' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_intent_not_approvable';
  END IF;
  IF v_intent.preview_expires_at <= clock_timestamp() THEN
    UPDATE public.lumia_action_intents
    SET status = 'expired', expired_at = clock_timestamp()
    WHERE id = v_intent.id;
    INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
    VALUES (v_intent.id, p_owner_id, 'expired', 'server', NULL, '{}'::jsonb);
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_preview_expired';
  END IF;
  UPDATE public.lumia_action_intents
  SET status = 'approved', approved_by = p_owner_id, approved_at = clock_timestamp()
  WHERE id = v_intent.id
  RETURNING * INTO v_intent;
  INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'approved', 'owner', p_owner_id,
    jsonb_build_object('payload_hash', v_intent.payload_hash));
  RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'approved_at', v_intent.approved_at, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.lumia_claim_action_execution(
  p_owner_id UUID,
  p_conversation_id UUID,
  p_intent_id UUID,
  p_executor_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.lumia_action_intents;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_executor_name IS NULL OR p_executor_name !~ '^[A-Za-z0-9._:-]{1,120}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_invalid_executor';
  END IF;
  SELECT * INTO v_intent FROM public.lumia_action_intents
  WHERE id = p_intent_id AND owner_id = p_owner_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_intent_not_owned_in_conversation';
  END IF;
  IF v_intent.status IN ('succeeded', 'failed', 'compensation_required') THEN
    RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'execution_result', v_intent.execution_result, 'claimed', false, 'idempotent', true);
  END IF;
  IF v_intent.status = 'executing' THEN
    RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'claimed', false, 'reason', 'already_claimed');
  END IF;
  IF v_intent.status <> 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_intent_not_claimable';
  END IF;
  IF v_intent.preview_expires_at <= clock_timestamp() THEN
    UPDATE public.lumia_action_intents SET status = 'expired', expired_at = clock_timestamp() WHERE id = v_intent.id;
    INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
    VALUES (v_intent.id, p_owner_id, 'expired', 'server', NULL, '{}'::jsonb);
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_preview_expired';
  END IF;
  UPDATE public.lumia_action_intents SET status = 'executing', claimed_at = clock_timestamp() WHERE id = v_intent.id RETURNING * INTO v_intent;
  INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'claimed', 'executor', NULL, jsonb_build_object('executor', p_executor_name));
  RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'claimed', true, 'payload_hash', v_intent.payload_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.lumia_finish_action_execution(
  p_owner_id UUID,
  p_intent_id UUID,
  p_final_status TEXT,
  p_execution_result JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.lumia_action_intents;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_final_status NOT IN ('succeeded', 'failed', 'compensation_required')
    OR p_execution_result IS NULL OR jsonb_typeof(p_execution_result) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_invalid_finish';
  END IF;
  SELECT * INTO v_intent FROM public.lumia_action_intents
  WHERE id = p_intent_id AND owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_intent_not_owned';
  END IF;
  IF v_intent.status IN ('succeeded', 'failed', 'compensation_required') THEN
    RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'execution_result', v_intent.execution_result, 'idempotent', true);
  END IF;
  IF v_intent.status <> 'executing' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_intent_not_finishable';
  END IF;
  UPDATE public.lumia_action_intents
  SET status = p_final_status, executed_at = clock_timestamp(), execution_result = p_execution_result
  WHERE id = v_intent.id
  RETURNING * INTO v_intent;
  INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'finished', 'executor', NULL,
    jsonb_build_object('status', p_final_status, 'result_hash', encode(extensions.digest(p_execution_result::text, 'sha256'), 'hex')));
  RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'execution_result', v_intent.execution_result, 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.lumia_expire_action_intents()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM public.lumia_require_service_role();
  WITH expired AS (
    UPDATE public.lumia_action_intents
    SET status = 'expired', expired_at = clock_timestamp()
    WHERE status IN ('preview', 'approved') AND preview_expires_at <= clock_timestamp()
    RETURNING id, owner_id
  ), audit AS (
    INSERT INTO public.lumia_action_attempts (intent_id, owner_id, event_type, actor_type, actor_id, detail)
    SELECT id, owner_id, 'expired', 'server', NULL, '{}'::jsonb FROM expired
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.lumia_require_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_new_action_short_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_create_action_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TEXT, JSONB, JSONB, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_approve_action_intent(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_claim_action_execution(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_finish_action_execution(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_expire_action_intents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_create_action_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TEXT, JSONB, JSONB, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lumia_approve_action_intent(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lumia_claim_action_execution(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.lumia_finish_action_execution(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.lumia_expire_action_intents() TO service_role;

COMMENT ON TABLE public.lumia_action_intents IS
  'Lumia Phase 3A : preview canonique immuable et approbation humaine. Aucun exécuteur métier dans cette migration.';
COMMENT ON TABLE public.lumia_action_attempts IS
  'Journal d''audit Lumia minimal : métadonnées/hachages seulement, sans contenu privé de message ni description Google.';
