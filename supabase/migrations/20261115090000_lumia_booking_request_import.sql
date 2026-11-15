-- Lumia — ajouter à « Demandes de RDV à traiter » les demandes détectées dans
-- les messages (SMS, iMessage, RCS), après validation explicite de Sébastien.
--
-- Prérequis : 20261002090000_lumia_rdv_intake.sql (booking_requests,
-- booking_request_intake_events, lumia_upsert_booking_request),
-- 20261004090000_lumia_message_inbox.sql et 20261005110000_lumia_action_foundation.sql.
--
-- Réutilise la fondation d'actions Lumia : preview immuable → GO de Sébastien
-- (approve) → réclamation (claim) → exécution serveur journalisée.
--
-- Garanties de l'exécuteur :
--   - il CRÉE seulement des demandes « pending » : jamais de booking, jamais de
--     Google Agenda, jamais d'envoi de message, aucun paiement ;
--   - il ne MODIFIE jamais une demande existante : si la conversation a déjà une
--     demande ouverte, ou si le message a déjà été importé, il ne fait rien ;
--   - le texte enregistré est relu côté serveur dans lumia_message_inbox, et
--     seulement pour des messages REÇUS classés « probable » ou « incertain »
--     (un message personnel classé « ignorer » n'est jamais copié) ;
--   - idempotence : même message = même demande, même après plusieurs analyses
--     (verrous consultatifs identiques à lumia_upsert_booking_request + clé
--     unique (canal, message) de booking_request_intake_events) ;
--   - journal : lumia_action_attempts (création, GO, réclamation, résultat) et
--     booking_request_intake_events (« created ») ; aucun texte client dans le
--     résultat ni dans le journal.
-- Idempotente : peut être rejouée.

-- ── 1. Canal RCS accepté pour une demande d'agent ───────────────────────────

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_intake_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_intake_check
  CHECK (
    (intake_agent IS NULL AND source_channel IS NULL AND source_message_id IS NULL)
    OR (intake_agent ~ '^[a-z0-9_-]{1,32}$'
        AND source_channel IN ('sms', 'imessage', 'rcs', 'whatsapp', 'dots', 'chatgpt', 'email', 'form', 'other')
        AND source_message_id IS NOT NULL)
  );

-- ── 2. Nouveau type d'action ────────────────────────────────────────────────

ALTER TABLE public.lumia_action_intents DROP CONSTRAINT IF EXISTS lumia_action_intents_action_type_check;
ALTER TABLE public.lumia_action_intents ADD CONSTRAINT lumia_action_intents_action_type_check
  CHECK (action_type IN (
    'mediumia.booking.create',
    'mediumia.booking.update',
    'mediumia.booking.cancel',
    'mediumia.booking_request.import',
    'google.event.create',
    'google.event.update',
    'google.event.cancel',
    'message.send'
  ));

ALTER TABLE public.lumia_action_intents DROP CONSTRAINT IF EXISTS lumia_action_intents_action_target_check;
ALTER TABLE public.lumia_action_intents ADD CONSTRAINT lumia_action_intents_action_target_check CHECK (
  (action_type IN ('mediumia.booking.create', 'mediumia.booking_request.import', 'google.event.create')
    AND target_source = 'none' AND target_id IS NULL)
  OR (action_type IN ('mediumia.booking.update', 'mediumia.booking.cancel')
    AND target_source = 'mediumia_booking' AND target_id IS NOT NULL)
  OR (action_type IN ('google.event.update', 'google.event.cancel')
    AND target_source = 'google_event' AND target_id IS NOT NULL)
  OR (action_type = 'message.send'
    AND target_source = 'message_conversation' AND target_id IS NOT NULL)
);

-- lumia_create_action_intent : identique à 20261005110000, avec le nouveau type
-- (cible « none », praticien obligatoire).
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
  IF (p_action_type LIKE 'mediumia.booking.%' OR p_action_type LIKE 'google.event.%'
      OR p_action_type = 'mediumia.booking_request.import')
    AND p_practitioner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_practitioner_required';
  END IF;
  IF p_practitioner_id IS NOT NULL THEN
    PERFORM 1
    FROM public.booking_practitioners p
    WHERE p.id = p_practitioner_id AND p.owner_id = p_owner_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_practitioner_not_owned';
    END IF;
  END IF;
  IF NOT (
    (p_action_type IN ('mediumia.booking.create', 'mediumia.booking_request.import', 'google.event.create')
      AND COALESCE(p_target_source, 'none') = 'none' AND NULLIF(p_target_id, '') IS NULL)
    OR (p_action_type IN ('mediumia.booking.update', 'mediumia.booking.cancel')
      AND COALESCE(p_target_source, 'none') = 'mediumia_booking' AND NULLIF(p_target_id, '') IS NOT NULL)
    OR (p_action_type IN ('google.event.update', 'google.event.cancel')
      AND COALESCE(p_target_source, 'none') = 'google_event' AND NULLIF(p_target_id, '') IS NOT NULL)
    OR (p_action_type = 'message.send'
      AND COALESCE(p_target_source, 'none') = 'message_conversation' AND NULLIF(p_target_id, '') IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_action_target_incoherent';
  END IF;

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
      OR v_intent.conversation_id <> p_conversation_id
      OR v_intent.practitioner_id IS DISTINCT FROM p_practitioner_id
      OR v_intent.target_source IS DISTINCT FROM COALESCE(p_target_source, 'none')
      OR v_intent.target_id IS DISTINCT FROM NULLIF(p_target_id, '')
      OR v_intent.expected_version IS DISTINCT FROM p_expected_version
      OR v_intent.expected_target_updated_at IS DISTINCT FROM p_expected_target_updated_at
      OR v_intent.target_google_etag IS DISTINCT FROM NULLIF(p_target_google_etag, '') THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'lumia_idempotency_key_reused_with_different_action';
    END IF;
    RETURN jsonb_build_object(
      'intent_id', v_intent.id, 'short_code', v_intent.short_code,
      'status', v_intent.status, 'payload_hash', v_intent.payload_hash,
      'preview', v_intent.preview, 'preview_expires_at', v_intent.preview_expires_at,
      'idempotent', true
    );
  END IF;

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
      SELECT * INTO v_intent
      FROM public.lumia_action_intents
      WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key
      FOR UPDATE;
      IF FOUND THEN
        IF v_intent.payload_hash <> v_hash
          OR v_intent.action_type <> p_action_type
          OR v_intent.conversation_id <> p_conversation_id
          OR v_intent.practitioner_id IS DISTINCT FROM p_practitioner_id
          OR v_intent.target_source IS DISTINCT FROM COALESCE(p_target_source, 'none')
          OR v_intent.target_id IS DISTINCT FROM NULLIF(p_target_id, '')
          OR v_intent.expected_version IS DISTINCT FROM p_expected_version
          OR v_intent.expected_target_updated_at IS DISTINCT FROM p_expected_target_updated_at
          OR v_intent.target_google_etag IS DISTINCT FROM NULLIF(p_target_google_etag, '') THEN
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

-- ── 3. Exécuteur : création des demandes approuvées ─────────────────────────
--
-- canonical_payload (construit par le serveur, jamais par le modèle) :
--   { version: 1, items: [ { n, channel, conversation_id, source_message_id,
--       message_ids: [uuid…] (messages reçus RDV de la conversation, le dernier
--       = source_message_id), modality, video_channel, service_hint,
--       preferred_period, confidence } ] }
-- p_selection : numéros (n) retenus par Sébastien, sous-ensemble des items.

CREATE OR REPLACE FUNCTION public.lumia_execute_booking_request_import(
  p_owner_id UUID,
  p_conversation_id UUID,
  p_intent_id UUID,
  p_selection INTEGER[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_intent public.lumia_action_intents;
  v_items JSONB;
  v_count INTEGER;
  v_selection INTEGER[];
  v_n INTEGER;
  v_item JSONB;
  v_anchor public.lumia_message_inbox;
  v_text TEXT;
  v_rows INTEGER;
  v_handle TEXT;
  v_phone TEXT;
  v_event public.booking_request_intake_events;
  v_existing UUID;
  v_upsert JSONB;
  v_outcomes JSONB := '[]'::jsonb;
  v_created INTEGER := 0;
  v_skipped INTEGER := 0;
  v_failure TEXT;
  v_result JSONB;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_owner_id IS NULL OR p_conversation_id IS NULL OR p_intent_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'lumia_owner_conversation_intent_required';
  END IF;

  SELECT * INTO v_intent
  FROM public.lumia_action_intents
  WHERE id = p_intent_id AND owner_id = p_owner_id AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'lumia_intent_not_owned';
  END IF;

  -- Rejeu après une exécution validée : même résultat, rien n'est refait.
  IF v_intent.status IN ('succeeded', 'failed', 'compensation_required') THEN
    RETURN COALESCE(v_intent.execution_result, jsonb_build_object(
      'intent_id', v_intent.id, 'status', v_intent.status, 'idempotent', true));
  END IF;
  IF v_intent.status <> 'executing' THEN
    RETURN jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status,
      'executed', false, 'reason', 'intent_not_claimed');
  END IF;

  v_items := v_intent.canonical_payload->'items';
  v_count := CASE WHEN jsonb_typeof(v_items) = 'array' THEN jsonb_array_length(v_items) ELSE 0 END;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_selection FROM unnest(p_selection) s;

  IF v_intent.action_type <> 'mediumia.booking_request.import'
     OR v_intent.target_source <> 'none' OR v_intent.practitioner_id IS NULL OR v_count = 0 THEN
    v_failure := 'intent_target_incoherent';
  ELSIF v_intent.preview_expires_at <= clock_timestamp() THEN
    v_failure := 'preview_expired';
  ELSIF v_selection IS NULL OR cardinality(v_selection) = 0 OR cardinality(v_selection) > 25
     OR v_selection[1] < 1 OR v_selection[cardinality(v_selection)] > v_count THEN
    v_failure := 'invalid_selection';
  END IF;

  IF v_failure IS NULL THEN
    FOREACH v_n IN ARRAY v_selection LOOP
      v_item := v_items->(v_n - 1);
      v_existing := NULL;

      -- Message d'ancrage relu côté serveur : reçu, classé RDV, du propriétaire.
      SELECT * INTO v_anchor FROM public.lumia_message_inbox m
      WHERE m.owner_id = p_owner_id
        AND m.source_channel = v_item->>'channel'
        AND m.source_message_id = v_item->>'source_message_id'
        AND m.is_from_me = false
        AND m.classification IN ('probable', 'incertain');
      IF NOT FOUND THEN
        v_skipped := v_skipped + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'source_unavailable');
        CONTINUE;
      END IF;

      -- Mêmes verrous que lumia_upsert_booking_request (réentrants ici).
      IF v_anchor.source_conversation_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('lumia-conv:' || v_intent.practitioner_id::TEXT || ':'
          || v_anchor.source_channel || ':' || v_anchor.source_conversation_id));
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('lumia-msg:' || v_anchor.source_channel || ':' || v_anchor.source_message_id));

      -- 1. Message déjà importé (par Lumia, le bridge ou une analyse précédente).
      SELECT * INTO v_event FROM public.booking_request_intake_events
      WHERE source_channel = v_anchor.source_channel AND source_message_id = v_anchor.source_message_id;
      IF FOUND THEN
        v_skipped := v_skipped + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'already_imported', 'request_id', v_event.request_id);
        CONTINUE;
      END IF;

      -- 2. Demande encore ouverte pour cette conversation : on n'y touche pas.
      IF v_anchor.source_conversation_id IS NOT NULL THEN
        SELECT r.id INTO v_existing FROM public.booking_requests r
        WHERE r.practitioner_id = v_intent.practitioner_id
          AND r.intake_agent IS NOT NULL
          AND r.source_channel = v_anchor.source_channel
          AND r.source_conversation_id = v_anchor.source_conversation_id
          AND r.status IN ('pending', 'contacted')
          AND r.confirmed_booking_id IS NULL
        ORDER BY r.created_at DESC LIMIT 1;
      END IF;

      -- 3. Demande ouverte du même numéro (formulaire du site, autre canal).
      v_handle := coalesce(v_anchor.counterpart, v_anchor.sender);
      v_phone := public.lumia_normalize_phone(CASE WHEN v_handle LIKE '+%' THEN v_handle END);
      IF v_existing IS NULL AND v_phone IS NOT NULL THEN
        SELECT r.id INTO v_existing FROM public.booking_requests r
        WHERE r.practitioner_id = v_intent.practitioner_id
          AND r.status IN ('pending', 'contacted')
          AND r.confirmed_booking_id IS NULL
          AND public.lumia_normalize_phone(r.customer_phone) = v_phone
        ORDER BY r.created_at DESC LIMIT 1;
      END IF;
      IF v_existing IS NOT NULL THEN
        v_skipped := v_skipped + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'already_open', 'request_id', v_existing);
        CONTINUE;
      END IF;

      -- Texte : uniquement les messages REÇUS classés RDV listés dans le preview,
      -- de la même conversation, relus en base (jamais un texte du navigateur).
      SELECT left(string_agg(m.message_text, E'\n— ' ORDER BY m.message_sent_at), 2000), count(*)
      INTO v_text, v_rows
      FROM public.lumia_message_inbox m
      WHERE m.owner_id = p_owner_id
        AND m.id::TEXT IN (SELECT jsonb_array_elements_text(coalesce(v_item->'message_ids', '[]'::jsonb)))
        AND m.source_channel = v_anchor.source_channel
        AND m.source_conversation_id IS NOT DISTINCT FROM v_anchor.source_conversation_id
        AND m.is_from_me = false
        AND m.classification IN ('probable', 'incertain');
      IF coalesce(v_rows, 0) = 0 THEN v_text := left(v_anchor.message_text, 2000); END IF;

      v_upsert := public.lumia_upsert_booking_request(v_intent.practitioner_id, jsonb_build_object(
        'agent', 'lumia',
        'channel', v_anchor.source_channel,
        'message_id', v_anchor.source_message_id,
        'conversation_id', v_anchor.source_conversation_id,
        'message_at', v_anchor.message_sent_at,
        'detected_at', clock_timestamp(),
        'phone', v_phone,
        'email', CASE WHEN v_handle LIKE '%@%' THEN lower(v_handle) END,
        'message_text', v_text,
        'service_hint', v_item->>'service_hint',
        'modality', coalesce(nullif(v_item->>'modality', ''), 'unknown'),
        'video_channel', v_item->>'video_channel',
        'preferred_period', v_item->>'preferred_period',
        'confidence', v_item->>'confidence',
        'missing', '[]'::jsonb
      ));

      IF coalesce((v_upsert->>'ok')::BOOLEAN, false) AND v_upsert->>'outcome' = 'created' THEN
        v_created := v_created + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'created', 'request_id', v_upsert->>'request_id',
          'customer_match', v_upsert->>'customer_match');
      ELSE
        -- « duplicate » / « updated » ne devraient pas arriver (vérifiés sous verrou) :
        -- signalés tels quels, jamais présentés comme une création.
        v_skipped := v_skipped + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n,
          'outcome', coalesce(v_upsert->>'outcome', v_upsert->>'error', 'refused'), 'request_id', v_upsert->>'request_id');
      END IF;
    END LOOP;
  END IF;

  IF v_failure IS NOT NULL THEN
    v_result := jsonb_build_object('intent_id', v_intent.id, 'status', 'failed', 'executed', false, 'reason', v_failure);
  ELSE
    v_result := jsonb_build_object('intent_id', v_intent.id, 'status', 'succeeded', 'executed', true,
      'selection', to_jsonb(v_selection), 'created', v_created, 'skipped', v_skipped, 'items', v_outcomes,
      'booking_created', false, 'calendar_written', false, 'message_sent', false);
  END IF;

  UPDATE public.lumia_action_intents
  SET status = v_result->>'status', executed_at = clock_timestamp(),
      execution_result = v_result, updated_at = clock_timestamp()
  WHERE id = v_intent.id;
  INSERT INTO public.lumia_action_attempts(intent_id, owner_id, event_type, actor_type, actor_id, detail)
  VALUES (v_intent.id, p_owner_id, 'finished', 'executor', p_owner_id,
    jsonb_build_object('status', v_result->>'status', 'reason', v_failure,
      'selection', to_jsonb(v_selection), 'created', v_created, 'skipped', v_skipped));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.lumia_execute_booking_request_import(UUID, UUID, UUID, INTEGER[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_execute_booking_request_import(UUID, UUID, UUID, INTEGER[]) TO service_role;

COMMENT ON FUNCTION public.lumia_execute_booking_request_import(UUID, UUID, UUID, INTEGER[]) IS
  'Lumia : crée des demandes pending à partir de messages RDV après GO de Sébastien. Ne modifie jamais une demande existante, ne crée aucun booking, n''écrit pas Google, n''envoie rien.';
