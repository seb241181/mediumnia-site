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
