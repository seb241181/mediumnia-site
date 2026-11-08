-- MediumIA — rattrapage de la base TEST — Garde TEST/PROD (marqueur « test ») et signalement des problèmes de paiement
-- Projet : MediumIA RDV PayPal Test (wnbwhnqiulsdjcvkuwos) UNIQUEMENT.
-- Exécution : Supabase > projet TEST > SQL Editor > coller tout le fichier > Run.
-- Tout ou rien : en cas d'erreur, rien n'est conservé. Refusé sur la Production
-- et refusé si le fichier a déjà été exécuté. Inscrit dans l'historique : environment_separation_guard, activer_test_marqueur, payment_issue_reports.
begin;

do $garde$
begin
  if exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     or not exists (select 1 from public.booking_practitioners where slug = 'seb-test') then
    raise exception 'ARRET : cette base n''est pas TEST (wnbwhnqiulsdjcvkuwos). Rien n''a été modifié.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20261108200400', '20261108200500', '20261108200600')) then
    raise exception 'ARRET : ce fichier a déjà été exécuté sur TEST. Rien n''a été modifié.';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261108200000', '20261108200100', '20261108200200', '20261108200300')) <> 4 then
    raise exception 'ARRET : exécutez d''abord le fichier précédent. Rien n''a été modifié.';
  end if;
end $garde$;

-- >>> migrations/20261108130000_environment_separation_guard.sql
-- Séparation TEST / PRODUCTION, garde dans la base (indépendante de Vercel).
--
-- Une base marquée « production » refuse toute NOUVELLE ligne de paiement
-- issue de PayPal Sandbox, quel que soit le client qui écrit (site,
-- préversion, script, fonction SQL, tâche automatique).
--
-- Sans marquage, rien ne change : la migration peut être appliquée sans
-- interruption, puis activée par supabase/runbooks/20261108-environment-separation/
-- activer-production.sql (ou activer-test.sql sur la base TEST).
--
-- Ne modifie ni ne supprime aucune ligne existante : les lignes Sandbox déjà
-- présentes restent lisibles et modifiables (statut, consommation), seule leur
-- création ou leur passage en Sandbox est refusé.
--
-- Exclusions volontaires :
--   - tables ChronoSphère (chronosphere_credit_packs, chronosphere_paid_draws,
--     oracle_timeline_follow_plans) : chantier en cours de Codex ;
--   - droits d'accès Formation : le parcours Formation est protégé contre toute
--     migration ultérieure ; leur garde est un script séparé, soumis à un GO
--     dédié (runbooks/20261108-environment-separation/garde-droits-formation.sql).

-- ── 1. Marqueur d'environnement (une ligne, verrouillée une fois « production ») ──
CREATE TABLE IF NOT EXISTS public.mediumia_runtime_environment (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  set_by TEXT NOT NULL DEFAULT current_user
);
ALTER TABLE public.mediumia_runtime_environment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mediumia_runtime_environment FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mediumia_runtime_environment TO service_role;

CREATE OR REPLACE FUNCTION public.mediumia_protect_runtime_environment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.environment = 'production'
     AND COALESCE(current_setting('mediumia.allow_environment_change', true), '') <> 'oui' THEN
    RAISE EXCEPTION 'runtime_environment_locked' USING ERRCODE = 'P0001',
      HINT = 'La base est marquée production : changement refusé.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mediumia_protect_runtime_environment ON public.mediumia_runtime_environment;
CREATE TRIGGER mediumia_protect_runtime_environment
  BEFORE UPDATE OR DELETE ON public.mediumia_runtime_environment
  FOR EACH ROW EXECUTE FUNCTION public.mediumia_protect_runtime_environment();

CREATE OR REPLACE FUNCTION public.mediumia_runtime_environment_value()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT environment FROM public.mediumia_runtime_environment WHERE singleton;
$$;

-- ── 2. Refus des paiements Sandbox dans une base de Production ─────────────
CREATE OR REPLACE FUNCTION public.mediumia_reject_sandbox_in_production()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new TEXT := to_jsonb(NEW) ->> 'paypal_env';
  v_old TEXT;
BEGIN
  IF v_new IS DISTINCT FROM 'sandbox' THEN RETURN NEW; END IF;
  IF public.mediumia_runtime_environment_value() IS DISTINCT FROM 'production' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD) ->> 'paypal_env';
    -- Ligne Sandbox historique : ses autres colonnes restent modifiables.
    IF v_old = 'sandbox' THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'sandbox_payment_in_production' USING ERRCODE = 'P0001',
    DETAIL = TG_TABLE_NAME, HINT = 'Paiement PayPal Sandbox refusé : cette base est la Production.';
END;
$$;

-- ── 3. Branchement sur les tables présentes (tolérant aux bases incomplètes) ──
DO $$
DECLARE
  t TEXT;
  payment_tables TEXT[] := ARRAY[
    'rdv_paypal_payments', 'rdv_balance_payments', 'rdv_payment_refunds', 'rdv_deposit_transfers',
    'mediumia_paypal_purchases', 'mediumia_paypal_order_intents', 'mediumia_paypal_plans',
    'mediumia_formation_payments', 'mediumia_formation_subscriptions', 'mediumia_formation_unlock_orders',
    'mediumia_email_questions', 'gift_cards', 'conference_passes'
  ];
BEGIN
  FOREACH t IN ARRAY payment_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'paypal_env'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zz_mediumia_no_sandbox_in_production ON public.%I', t);
      EXECUTE format('CREATE TRIGGER zz_mediumia_no_sandbox_in_production BEFORE INSERT OR UPDATE OF paypal_env ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.mediumia_reject_sandbox_in_production()', t);
    END IF;
  END LOOP;

END $$;

REVOKE ALL ON FUNCTION public.mediumia_runtime_environment_value() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mediumia_reject_sandbox_in_production() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mediumia_protect_runtime_environment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_runtime_environment_value() TO service_role;

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200400', 'environment_separation_guard', 'rattrapage-test-sql-editor');

-- >>> runbooks/20261108-environment-separation/activer-test.sql
-- Marque la base TEST (après la migration 20261108130000). Refuse la Production.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c') THEN
    RAISE EXCEPTION 'base_de_production_detectee : marquage test refusé';
  END IF;
END $$;
INSERT INTO public.mediumia_runtime_environment (environment) VALUES ('test')
ON CONFLICT (singleton) DO NOTHING;
DO $$
BEGIN
  IF public.mediumia_runtime_environment_value() IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'marquage_incoherent : la base porte déjà un autre marqueur';
  END IF;
END $$;
SELECT environment, set_at FROM public.mediumia_runtime_environment;

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200500', 'activer_test_marqueur', 'rattrapage-test-sql-editor');

-- >>> migrations/20261108140000_payment_issue_reports.sql
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

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200600', 'payment_issue_reports', 'rattrapage-test-sql-editor');

commit;

select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
