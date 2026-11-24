-- Lumia — brouillons SMS validés par le propriétaire, envoyés uniquement par le Mac.
-- DÉSACTIVÉ par défaut : aucun endpoint n'utilise cette table sans deux flags et secrets.
-- Pas de publication ni d'envoi par l'application web.
CREATE TABLE IF NOT EXISTS public.lumia_sms_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL UNIQUE REFERENCES public.lumia_action_intents(id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_inbox_id UUID NOT NULL REFERENCES public.lumia_message_inbox(id) ON DELETE RESTRICT,
  source_conversation_id TEXT NOT NULL,
  recipient TEXT NOT NULL CHECK (char_length(recipient) BETWEEN 8 AND 254),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'imessage')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'dispatching', 'accepted', 'uncertain', 'failed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,64}$'),
  CONSTRAINT lumia_sms_outbox_expiration_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '20 minutes')
);
CREATE INDEX IF NOT EXISTS lumia_sms_outbox_ready_idx
  ON public.lumia_sms_outbox (owner_id, created_at) WHERE status='ready';
ALTER TABLE public.lumia_sms_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lumia_sms_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.lumia_sms_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lumia_sms_outbox TO service_role;

-- Un GET du Mac marque le message "dispatching" AVANT de livrer son texte.
-- Si le Mac tombe ensuite, il ne sera jamais remis en file automatiquement.
CREATE OR REPLACE FUNCTION public.lumia_claim_sms_outbox(p_owner_id UUID)
RETURNS SETOF public.lumia_sms_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM public.lumia_require_service_role();
  UPDATE public.lumia_sms_outbox
     SET status='expired', closed_at=clock_timestamp(), error_code='expired'
   WHERE owner_id=p_owner_id AND status='ready' AND expires_at <= clock_timestamp();

  SELECT id INTO v_id FROM public.lumia_sms_outbox
   WHERE owner_id=p_owner_id AND status='ready' AND expires_at > clock_timestamp()
   ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.lumia_sms_outbox
   SET status='dispatching', claimed_at=clock_timestamp()
   WHERE id=v_id AND status='ready' RETURNING *;
END; $$;

CREATE OR REPLACE FUNCTION public.lumia_finish_sms_outbox(
  p_owner_id UUID, p_outbox_id UUID, p_status TEXT, p_error_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_record public.lumia_sms_outbox;
BEGIN
  PERFORM public.lumia_require_service_role();
  IF p_status NOT IN ('accepted','failed','uncertain')
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z_]{1,64}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_outbox_result';
  END IF;
  SELECT * INTO v_record FROM public.lumia_sms_outbox
    WHERE id=p_outbox_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_record.status IN ('accepted','failed','uncertain','expired') THEN
    RETURN jsonb_build_object('status',v_record.status,'idempotent',true);
  END IF;
  IF v_record.status <> 'dispatching' THEN
    RETURN jsonb_build_object('status','not_claimed');
  END IF;
  UPDATE public.lumia_sms_outbox
    SET status=p_status, error_code=p_error_code, closed_at=clock_timestamp()
    WHERE id=p_outbox_id;
  RETURN jsonb_build_object('status',p_status,'idempotent',false);
END; $$;

REVOKE ALL ON FUNCTION public.lumia_claim_sms_outbox(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lumia_finish_sms_outbox(UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lumia_claim_sms_outbox(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.lumia_finish_sms_outbox(UUID,UUID,TEXT,TEXT) TO service_role;

COMMENT ON TABLE public.lumia_sms_outbox IS
  'Brouillons approuvés par GO, livrés au Mac une fois. accepted = accepté par Messages.app, PAS preuve de livraison au destinataire.';
