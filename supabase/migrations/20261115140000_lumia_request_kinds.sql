-- Lumia — type d'action des demandes importées depuis les messages.
--
-- Prérequis : 20261115090000_lumia_booking_request_import.sql.
--
-- Quatre types, toujours « à vérifier » (needs_review = true) :
--   new        nouvelle demande de rendez-vous
--   reschedule déplacement ou modification d'un rendez-vous
--   cancel     annulation d'un rendez-vous
--   followup   relance ou suivi client
--
-- Pour un déplacement ou une annulation, le serveur recherche le rendez-vous
-- concerné (même client, rendez-vous confirmé à venir) et le SIGNALE seulement :
--   related_booking_match = found | multiple | not_found
--   related_booking_id    = le rendez-vous, s'il est unique.
-- Rien ne modifie jamais ce rendez-vous : aucune annulation, aucun déplacement,
-- aucun Google Agenda, aucun message. ON DELETE SET NULL : la demande survit au
-- rendez-vous.
--
-- Colonnes nullables : les demandes existantes (formulaire du site, intake du
-- bridge) restent inchangées ; un type NULL est affiché comme une demande.
-- Idempotente : peut être rejouée.

ALTER TABLE public.booking_requests
  ADD COLUMN IF NOT EXISTS request_kind TEXT,
  ADD COLUMN IF NOT EXISTS related_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_booking_match TEXT;

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_request_kind_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_request_kind_check
  CHECK (request_kind IS NULL OR request_kind IN ('new', 'reschedule', 'cancel', 'followup'));

ALTER TABLE public.booking_requests DROP CONSTRAINT IF EXISTS booking_requests_related_booking_check;
ALTER TABLE public.booking_requests ADD CONSTRAINT booking_requests_related_booking_check
  CHECK (
    (related_booking_match IS NULL AND related_booking_id IS NULL)
    OR (related_booking_match = 'found' AND related_booking_id IS NOT NULL)
    OR (related_booking_match IN ('multiple', 'not_found') AND related_booking_id IS NULL)
  );

-- ── Exécuteur : identique à 20261115090000, plus le type et le rendez-vous lié ──
--
-- Après la création (et seulement elle), la demande créée reçoit son type et le
-- rendez-vous lié. Celui-ci est revérifié ici : rendez-vous confirmé, à venir, du
-- même praticien, et du même client (téléphone normalisé). Sinon, rien n'est relié
-- (« not_found »). Une demande existante n'est jamais modifiée.

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
  v_kind TEXT;
  v_related UUID;
  v_match TEXT;
  v_created_id UUID;
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

      IF v_anchor.source_conversation_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('lumia-conv:' || v_intent.practitioner_id::TEXT || ':'
          || v_anchor.source_channel || ':' || v_anchor.source_conversation_id));
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('lumia-msg:' || v_anchor.source_channel || ':' || v_anchor.source_message_id));

      SELECT * INTO v_event FROM public.booking_request_intake_events
      WHERE source_channel = v_anchor.source_channel AND source_message_id = v_anchor.source_message_id;
      IF FOUND THEN
        v_skipped := v_skipped + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'already_imported', 'request_id', v_event.request_id);
        CONTINUE;
      END IF;

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
        v_created_id := (v_upsert->>'request_id')::UUID;
        v_kind := CASE WHEN v_item->>'kind' IN ('new', 'reschedule', 'cancel', 'followup') THEN v_item->>'kind' ELSE 'new' END;
        v_related := NULL;
        v_match := NULL;
        IF v_kind IN ('reschedule', 'cancel') THEN
          -- Revérification : rendez-vous confirmé, à venir, même praticien, même client.
          IF v_item->>'related_booking_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            SELECT b.id INTO v_related FROM public.bookings b
            WHERE b.id = (v_item->>'related_booking_id')::UUID
              AND b.practitioner_id IN (SELECT p.id FROM public.booking_practitioners p WHERE p.owner_id = p_owner_id)
              AND b.status = 'confirmed' AND b.starts_at > clock_timestamp()
              AND v_phone IS NOT NULL AND public.lumia_normalize_phone(b.customer_phone) = v_phone;
          END IF;
          v_match := CASE
            WHEN v_related IS NOT NULL THEN 'found'
            WHEN v_item->>'related_booking_match' = 'multiple' THEN 'multiple'
            ELSE 'not_found' END;
        END IF;
        -- Uniquement la demande qui vient d'être créée par cet appel.
        UPDATE public.booking_requests
        SET request_kind = v_kind, related_booking_id = v_related, related_booking_match = v_match, needs_review = true
        WHERE id = v_created_id AND status = 'pending' AND intake_agent = 'lumia'
          AND source_channel = v_anchor.source_channel AND source_message_id = v_anchor.source_message_id;
        v_created := v_created + 1;
        v_outcomes := v_outcomes || jsonb_build_object('n', v_n, 'outcome', 'created', 'request_id', v_created_id,
          'kind', v_kind, 'related_booking_match', v_match, 'customer_match', v_upsert->>'customer_match');
      ELSE
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
      'booking_created', false, 'booking_modified', false, 'calendar_written', false, 'message_sent', false);
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

COMMENT ON COLUMN public.booking_requests.request_kind IS
  'Lumia : new | reschedule | cancel | followup. Toujours à vérifier par le praticien.';
COMMENT ON COLUMN public.booking_requests.related_booking_id IS
  'Lumia : rendez-vous concerné (déplacement/annulation), signalé seulement, jamais modifié.';
