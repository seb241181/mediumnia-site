-- Garde des droits Formation (optionnelle, GO dédié requis).
-- À appliquer APRÈS la migration 20261108130000 et l'activation du marqueur.
-- Une base marquée « production » refuse tout NOUVEAU droit d'origine Sandbox.
-- Les droits existants (dont les 12 d'origine Sandbox relevés le 08/11/2026)
-- ne sont ni modifiés ni révoqués.
BEGIN;
-- Les références de droits encodent l'environnement : « paypal:sandbox:… »,
-- « parcours:sandbox:… », « conference-pass:sandbox:… ».
CREATE OR REPLACE FUNCTION public.mediumia_reject_sandbox_entitlement_in_production()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.origin_ref, '') !~ '^[a-z-]+:sandbox:' THEN RETURN NEW; END IF;
  IF public.mediumia_runtime_environment_value() IS DISTINCT FROM 'production' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.origin_ref, '') ~ '^[a-z-]+:sandbox:' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'sandbox_entitlement_in_production' USING ERRCODE = 'P0001',
    HINT = 'Droit issu de PayPal Sandbox refusé : cette base est la Production.';
END;
$$;

DROP TRIGGER IF EXISTS zz_mediumia_no_sandbox_entitlement_in_production ON public.mediumia_entitlements;
CREATE TRIGGER zz_mediumia_no_sandbox_entitlement_in_production
  BEFORE INSERT OR UPDATE OF origin_ref ON public.mediumia_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.mediumia_reject_sandbox_entitlement_in_production();
REVOKE ALL ON FUNCTION public.mediumia_reject_sandbox_entitlement_in_production() FROM PUBLIC, anon, authenticated;
COMMIT;
