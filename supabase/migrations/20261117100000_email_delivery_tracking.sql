-- MediumIA — suivi de délivrabilité des e-mails (Resend), ticket #219.
--
-- Problème : Supabase Auth (codes OTP) et sendEmail considèrent un e-mail
-- « envoyé » dès que Resend l'accepte. Un rejet (bounce) ou une suppression
-- arrive ensuite, de façon asynchrone, sans que personne ne le sache.
--
-- Ce schéma reçoit les événements du webhook Resend signé (serveur seulement) :
--   email_delivery_events : journal minimal et idempotent (un événement Svix =
--     une ligne par destinataire ; jamais le contenu, jamais un code OTP : le
--     sujet est caviardé côté serveur avant stockage) ;
--   email_delivery_issues : une ligne par adresse en difficulté, ouverte ou
--     résolue, qui sert à prévenir le client (« vérifiez votre adresse ») et
--     Sébastien (alerte unique par incident).
--
-- Ce schéma ne débloque JAMAIS une adresse chez Resend et ne désactive aucune
-- protection : il observe. Une plainte (complained) n'est jamais résolue
-- automatiquement. Idempotente : peut être rejouée.

CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  webhook_id TEXT NOT NULL CHECK (char_length(webhook_id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 60),
  email_id TEXT CHECK (email_id IS NULL OR char_length(email_id) <= 200),
  recipient TEXT NOT NULL CHECK (recipient = lower(recipient) AND char_length(recipient) <= 320),
  subject_redacted TEXT CHECK (subject_redacted IS NULL OR char_length(subject_redacted) <= 200),
  bounce_type TEXT CHECK (bounce_type IS NULL OR char_length(bounce_type) <= 60),
  bounce_subtype TEXT CHECK (bounce_subtype IS NULL OR char_length(bounce_subtype) <= 60),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_delivery_events_once UNIQUE (provider, webhook_id, recipient)
);

CREATE INDEX IF NOT EXISTS email_delivery_events_recipient_idx
  ON public.email_delivery_events (recipient, received_at DESC);

CREATE TABLE IF NOT EXISTS public.email_delivery_issues (
  recipient TEXT PRIMARY KEY CHECK (recipient = lower(recipient) AND char_length(recipient) <= 320),
  status TEXT NOT NULL CHECK (status IN ('bounced', 'suppressed', 'failed', 'complained')),
  -- blocking : Resend n'enverra plus rien (rejet définitif, suppression, plainte) ;
  -- temporary : échec ou rejet temporaire, un nouvel essai peut aboutir.
  severity TEXT NOT NULL CHECK (severity IN ('blocking', 'temporary')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_type TEXT NOT NULL,
  last_subject_redacted TEXT,
  events_count INTEGER NOT NULL DEFAULT 1 CHECK (events_count >= 1),
  alert_sent_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 300),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_delivery_issues_open_idx
  ON public.email_delivery_issues (last_event_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_issues FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_delivery_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_delivery_issues FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.email_delivery_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_delivery_issues TO service_role;

-- ── Enregistrement d'un événement (webhook signé, serveur seulement) ─────────
--
-- p_event : { webhook_id, event_type, email_id, recipient, subject_redacted,
--             bounce_type, bounce_subtype, reason, occurred_at }
-- Retour : { recorded, duplicate, issue_opened, status, severity, alert_due }
--   alert_due = true une seule fois par incident (ouverture ou réouverture,
--   ou passage d'un incident temporaire à bloquant), réservé atomiquement.

CREATE OR REPLACE FUNCTION public.record_email_delivery_event(p_event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT := p_event->>'event_type';
  v_recipient TEXT := lower(btrim(p_event->>'recipient'));
  v_occurred TIMESTAMPTZ := coalesce(nullif(p_event->>'occurred_at', '')::TIMESTAMPTZ, now());
  v_bounce_type TEXT := nullif(left(p_event->>'bounce_type', 60), '');
  v_status TEXT;
  v_severity TEXT;
  v_issue public.email_delivery_issues;
  v_inserted BIGINT;
  v_opened BOOLEAN := false;
  v_alert BOOLEAN := false;
BEGIN
  IF v_recipient IS NULL OR v_recipient = '' OR v_recipient !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     OR nullif(p_event->>'webhook_id', '') IS NULL OR nullif(v_type, '') IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'error', 'invalid_event');
  END IF;

  INSERT INTO public.email_delivery_events (
    webhook_id, event_type, email_id, recipient, subject_redacted, bounce_type, bounce_subtype, reason, occurred_at
  ) VALUES (
    left(p_event->>'webhook_id', 200), left(v_type, 60), nullif(left(p_event->>'email_id', 200), ''), v_recipient,
    nullif(left(p_event->>'subject_redacted', 200), ''), v_bounce_type, nullif(left(p_event->>'bounce_subtype', 60), ''),
    nullif(left(p_event->>'reason', 300), ''), v_occurred
  )
  ON CONFLICT ON CONSTRAINT email_delivery_events_once DO NOTHING
  RETURNING id INTO v_inserted;

  -- Renvoi du même événement par Resend (retry) : rien ne change, pas d'alerte.
  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', true);
  END IF;

  -- Sérialise les événements d'une même adresse.
  PERFORM pg_advisory_xact_lock(hashtext('email-delivery:' || v_recipient));
  SELECT * INTO v_issue FROM public.email_delivery_issues WHERE recipient = v_recipient FOR UPDATE;

  IF v_type = 'email.delivered' THEN
    -- Une remise réussie, postérieure à l'incident, le clôt — sauf une plainte,
    -- qui n'est jamais résolue automatiquement.
    IF FOUND AND v_issue.resolved_at IS NULL AND v_issue.status <> 'complained' AND v_occurred > v_issue.last_event_at THEN
      UPDATE public.email_delivery_issues
      SET resolved_at = now(), resolution_note = 'remis avec succès après l''incident', updated_at = now()
      WHERE recipient = v_recipient;
      RETURN jsonb_build_object('recorded', true, 'issue_resolved', true);
    END IF;
    RETURN jsonb_build_object('recorded', true);
  END IF;

  v_status := CASE
    WHEN v_type = 'email.bounced' THEN 'bounced'
    WHEN v_type IN ('email.suppressed', 'suppression.added', 'contact.suppressed') THEN 'suppressed'
    WHEN v_type = 'email.complained' THEN 'complained'
    WHEN v_type = 'email.failed' THEN 'failed'
  END;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('recorded', true); -- envoyé, ouvert, retardé… : journal seulement
  END IF;
  v_severity := CASE
    WHEN v_status IN ('suppressed', 'complained') THEN 'blocking'
    WHEN v_status = 'bounced' AND coalesce(lower(v_bounce_type), 'permanent') NOT IN ('transient', 'temporary', 'undetermined') THEN 'blocking'
    ELSE 'temporary'
  END;

  IF NOT FOUND OR v_issue.resolved_at IS NOT NULL THEN
    INSERT INTO public.email_delivery_issues AS i (
      recipient, status, severity, first_seen_at, last_event_at, last_event_type, last_subject_redacted, events_count, alert_sent_at, resolved_at, resolved_by, resolution_note, updated_at
    ) VALUES (
      v_recipient, v_status, v_severity, now(), v_occurred, v_type, nullif(left(p_event->>'subject_redacted', 200), ''), 1, NULL, NULL, NULL, NULL, now()
    )
    ON CONFLICT (recipient) DO UPDATE SET
      status = EXCLUDED.status, severity = EXCLUDED.severity, first_seen_at = now(), last_event_at = EXCLUDED.last_event_at,
      last_event_type = EXCLUDED.last_event_type, last_subject_redacted = EXCLUDED.last_subject_redacted,
      events_count = i.events_count + 1, alert_sent_at = NULL, resolved_at = NULL, resolved_by = NULL, resolution_note = NULL, updated_at = now();
    v_opened := true;
    v_alert := true;
  ELSE
    -- Incident déjà ouvert : on garde le plus grave ; une aggravation
    -- (temporaire → bloquant, ou → plainte) déclenche une nouvelle alerte.
    v_alert := (v_issue.severity = 'temporary' AND v_severity = 'blocking')
      OR (v_status = 'complained' AND v_issue.status <> 'complained');
    UPDATE public.email_delivery_issues SET
      status = CASE WHEN v_issue.status = 'complained' THEN 'complained'
                    WHEN v_severity = 'blocking' OR v_issue.severity = 'temporary' THEN v_status ELSE v_issue.status END,
      severity = CASE WHEN v_issue.severity = 'blocking' OR v_severity = 'blocking' THEN 'blocking' ELSE 'temporary' END,
      last_event_at = greatest(v_issue.last_event_at, v_occurred),
      last_event_type = v_type,
      last_subject_redacted = coalesce(nullif(left(p_event->>'subject_redacted', 200), ''), v_issue.last_subject_redacted),
      events_count = v_issue.events_count + 1,
      alert_sent_at = CASE WHEN v_alert THEN NULL ELSE v_issue.alert_sent_at END,
      updated_at = now()
    WHERE recipient = v_recipient;
  END IF;

  SELECT * INTO v_issue FROM public.email_delivery_issues WHERE recipient = v_recipient;
  RETURN jsonb_build_object('recorded', true, 'issue_opened', v_opened, 'status', v_issue.status,
    'severity', v_issue.severity, 'alert_due', v_alert AND v_issue.alert_sent_at IS NULL,
    'first_seen_at', v_issue.first_seen_at);
END;
$$;

-- Réserve l'envoi de l'alerte (une seule fois par incident, même si deux
-- webhooks arrivent en même temps). Retourne true au seul appelant gagnant.
CREATE OR REPLACE FUNCTION public.claim_email_delivery_alert(p_recipient TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimed AS (
    UPDATE public.email_delivery_issues SET alert_sent_at = now(), updated_at = now()
    WHERE recipient = lower(btrim(p_recipient)) AND resolved_at IS NULL AND alert_sent_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

-- Échec de l'envoi de l'alerte : on libère la réservation pour un nouvel essai.
CREATE OR REPLACE FUNCTION public.release_email_delivery_alert(p_recipient TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.email_delivery_issues SET alert_sent_at = NULL, updated_at = now()
  WHERE recipient = lower(btrim(p_recipient)) AND resolved_at IS NULL;
$$;

-- Vérification avant envoi d'un code (espace client). Ne révèle ni l'existence
-- d'un compte, ni le sujet, ni la raison : seulement l'état de livraison.
CREATE OR REPLACE FUNCTION public.email_delivery_check(p_email TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('delivery', CASE WHEN i.severity = 'blocking' THEN 'blocked' ELSE 'temporary' END,
                               'since', i.last_event_at)
     FROM public.email_delivery_issues i
     WHERE i.recipient = lower(btrim(p_email)) AND i.resolved_at IS NULL),
    jsonb_build_object('delivery', 'ok'));
$$;

-- Clôture manuelle par l'administration (après correction ou vérification).
-- Ne débloque rien chez Resend : la suppression Resend se retire à la main,
-- et jamais pour une plainte sans accord explicite de la personne.
CREATE OR REPLACE FUNCTION public.resolve_email_delivery_issue(p_recipient TEXT, p_actor UUID, p_note TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_issue public.email_delivery_issues;
BEGIN
  UPDATE public.email_delivery_issues
  SET resolved_at = now(), resolved_by = p_actor, resolution_note = left(coalesce(nullif(btrim(p_note), ''), 'résolu manuellement'), 300), updated_at = now()
  WHERE recipient = lower(btrim(p_recipient)) AND resolved_at IS NULL
  RETURNING * INTO v_issue;
  IF NOT FOUND THEN RETURN jsonb_build_object('resolved', false, 'error', 'issue_not_open'); END IF;
  RETURN jsonb_build_object('resolved', true, 'status', v_issue.status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_delivery_event(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_email_delivery_alert(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_email_delivery_alert(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_delivery_check(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_email_delivery_issue(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_event(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_email_delivery_alert(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_email_delivery_alert(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_delivery_check(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_email_delivery_issue(TEXT, UUID, TEXT) TO service_role;

COMMENT ON TABLE public.email_delivery_events IS
  'Webhook Resend signé : journal minimal (type, destinataire, sujet caviardé). Jamais de contenu ni de code OTP.';
COMMENT ON TABLE public.email_delivery_issues IS
  'Adresses en difficulté de livraison. Observation seulement : aucun déblocage Resend automatique ; plainte jamais résolue automatiquement.';
