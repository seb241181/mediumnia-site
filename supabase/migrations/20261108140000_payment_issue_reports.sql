-- Signalements de problèmes de paiement (« Signaler un problème de paiement »).
--
-- Accessible sans connexion depuis tous les parcours de paiement. Ne déclenche
-- jamais de capture ni de commande PayPal : un signalement est une simple
-- trace, traitée ensuite par le propriétaire.
--
-- Protections : limites de débit (adresse IP hachée, e-mail, volume global),
-- dédoublonnage sur 24 h, accusé de réception au plus une fois par jour et par
-- adresse, aucune donnée bancaire (le serveur masque numéros de carte et IBAN
-- avant l'enregistrement ; la base refuse une suite de 13 à 19 chiffres).
-- Tables et fonctions réservées au serveur.

CREATE TABLE IF NOT EXISTS public.payment_issue_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE CHECK (reference ~ '^PB-[0-9A-F]{8}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  contact_email TEXT NOT NULL CHECK (length(contact_email) <= 254 AND contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  reason TEXT NOT NULL CHECK (reason IN ('payment_failed', 'charged_no_service', 'double_charge', 'page_error', 'session_expired', 'other')),
  comment TEXT CHECK (comment IS NULL OR (length(comment) <= 1000 AND comment !~ '\d(?:[ -]?\d){12,18}')),
  journey TEXT NOT NULL CHECK (journey IN ('chronosphere', 'chronosphere_max', 'rdv_deposit', 'rdv_balance', 'formation',
    'parcours', 'email_question', 'gift_card', 'conference_pass', 'oracle', 'other')),
  step TEXT CHECK (step IS NULL OR step ~ '^[a-z_]{1,40}$'),
  attempt_ref TEXT CHECK (attempt_ref IS NULL OR attempt_ref ~ '^[A-Za-z0-9-]{8,64}$'),
  attempt_at TIMESTAMPTZ,
  page_path TEXT CHECK (page_path IS NULL OR (length(page_path) <= 200 AND page_path !~ '[?#]')),
  client_kind TEXT CHECK (client_kind IS NULL OR client_kind IN ('mobile', 'desktop', 'in_app', 'unknown')),
  ip_hash TEXT CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  dedupe_key TEXT NOT NULL CHECK (dedupe_key ~ '^[0-9a-f]{32}$'),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'dismissed')),
  owner_note TEXT CHECK (owner_note IS NULL OR length(owner_note) <= 1000),
  handled_at TIMESTAMPTZ,
  handled_by UUID,
  owner_notified_at TIMESTAMPTZ,
  ack_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_issue_reports_created_idx ON public.payment_issue_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS payment_issue_reports_status_idx ON public.payment_issue_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_issue_reports_ip_idx ON public.payment_issue_reports (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_issue_reports_email_idx ON public.payment_issue_reports (contact_email, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_issue_reports_dedupe_idx ON public.payment_issue_reports (dedupe_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_issue_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.payment_issue_reports(id),
  event TEXT NOT NULL CHECK (event IN ('submitted', 'duplicate', 'owner_notified', 'ack_sent', 'status_changed', 'note_updated')),
  actor UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_issue_events_report_idx ON public.payment_issue_events (report_id, created_at);

ALTER TABLE public.payment_issue_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_issue_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_issue_reports, public.payment_issue_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_issue_reports, public.payment_issue_events TO service_role;

-- ── Dépôt d'un signalement (public, via le serveur) ────────────────────────
CREATE OR REPLACE FUNCTION public.submit_payment_issue_report(
  p_email TEXT,
  p_reason TEXT,
  p_comment TEXT,
  p_journey TEXT,
  p_step TEXT,
  p_attempt_ref TEXT,
  p_attempt_at TIMESTAMPTZ,
  p_page_path TEXT,
  p_client_kind TEXT,
  p_ip_hash TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_dedupe TEXT;
  v_existing public.payment_issue_reports;
  v_report public.payment_issue_reports;
  v_ack_allowed BOOLEAN;
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_email');
  END IF;

  -- Limites : 5 par heure et par adresse IP, 3 par heure et par e-mail, 60 par heure au total.
  IF p_ip_hash IS NOT NULL AND (SELECT count(*) FROM public.payment_issue_reports
      WHERE ip_hash = p_ip_hash AND created_at > p_now - INTERVAL '1 hour') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF (SELECT count(*) FROM public.payment_issue_reports
      WHERE contact_email = v_email AND created_at > p_now - INTERVAL '1 hour') >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;
  IF (SELECT count(*) FROM public.payment_issue_reports WHERE created_at > p_now - INTERVAL '1 hour') >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Même personne, même parcours, même tentative, même motif : un seul signalement par 24 h.
  v_dedupe := md5(v_email || '|' || COALESCE(p_journey, '') || '|' || COALESCE(p_attempt_ref, '') || '|' || COALESCE(p_reason, ''));
  PERFORM pg_advisory_xact_lock(hashtext('payment_issue:' || v_dedupe));
  SELECT * INTO v_existing FROM public.payment_issue_reports
  WHERE dedupe_key = v_dedupe AND created_at > p_now - INTERVAL '24 hours'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.payment_issue_events (report_id, event) VALUES (v_existing.id, 'duplicate');
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'reference', v_existing.reference);
  END IF;

  v_ack_allowed := NOT EXISTS (SELECT 1 FROM public.payment_issue_reports
    WHERE contact_email = v_email AND ack_sent_at > p_now - INTERVAL '24 hours');

  INSERT INTO public.payment_issue_reports (reference, created_at, contact_email, reason, comment, journey, step,
    attempt_ref, attempt_at, page_path, client_kind, ip_hash, dedupe_key, updated_at)
  VALUES ('PB-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)), p_now, v_email, p_reason,
    NULLIF(trim(COALESCE(p_comment, '')), ''), p_journey, p_step, p_attempt_ref, p_attempt_at, p_page_path,
    p_client_kind, p_ip_hash, v_dedupe, p_now)
  RETURNING * INTO v_report;
  INSERT INTO public.payment_issue_events (report_id, event, detail)
  VALUES (v_report.id, 'submitted', jsonb_build_object('journey', p_journey, 'step', p_step, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_report.id, 'reference', v_report.reference,
    'ack_allowed', v_ack_allowed);
END;
$$;

-- ── Traces d'envoi (notification propriétaire, accusé client) ──────────────
CREATE OR REPLACE FUNCTION public.mark_payment_issue_notified(p_report_id UUID, p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_kind = 'owner' THEN
    UPDATE public.payment_issue_reports SET owner_notified_at = COALESCE(owner_notified_at, now()), updated_at = now() WHERE id = p_report_id;
    INSERT INTO public.payment_issue_events (report_id, event) VALUES (p_report_id, 'owner_notified');
  ELSIF p_kind = 'ack' THEN
    UPDATE public.payment_issue_reports SET ack_sent_at = COALESCE(ack_sent_at, now()), updated_at = now() WHERE id = p_report_id;
    INSERT INTO public.payment_issue_events (report_id, event) VALUES (p_report_id, 'ack_sent');
  ELSE
    RETURN false;
  END IF;
  RETURN FOUND;
END;
$$;

-- ── Traitement par le propriétaire ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_payment_issue_report(p_actor UUID, p_report_id UUID, p_status TEXT, p_owner_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report public.payment_issue_reports;
  v_note TEXT := NULLIF(left(trim(COALESCE(p_owner_note, '')), 1000), '');
BEGIN
  IF p_actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('new', 'in_progress', 'resolved', 'dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;
  SELECT * INTO v_report FROM public.payment_issue_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'report_not_found'); END IF;

  IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_report.status THEN
    INSERT INTO public.payment_issue_events (report_id, event, actor, detail)
    VALUES (v_report.id, 'status_changed', p_actor, jsonb_build_object('from', v_report.status, 'to', p_status));
  END IF;
  IF p_owner_note IS NOT NULL AND v_note IS DISTINCT FROM v_report.owner_note THEN
    INSERT INTO public.payment_issue_events (report_id, event, actor) VALUES (v_report.id, 'note_updated', p_actor);
  END IF;

  UPDATE public.payment_issue_reports
  SET status = COALESCE(p_status, status),
      owner_note = CASE WHEN p_owner_note IS NULL THEN owner_note ELSE v_note END,
      handled_at = CASE WHEN COALESCE(p_status, status) IN ('resolved', 'dismissed') THEN COALESCE(handled_at, now()) ELSE NULL END,
      handled_by = CASE WHEN COALESCE(p_status, status) IN ('resolved', 'dismissed') THEN p_actor ELSE NULL END,
      updated_at = now()
  WHERE id = v_report.id
  RETURNING * INTO v_report;
  RETURN jsonb_build_object('ok', true, 'status', v_report.status, 'owner_note', v_report.owner_note, 'handled_at', v_report.handled_at);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_payment_issue_report(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payment_issue_notified(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_payment_issue_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_issue_report(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_issue_notified(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_issue_report(UUID, UUID, TEXT, TEXT) TO service_role;
