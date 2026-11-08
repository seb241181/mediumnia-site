-- Retour arrière de la garde SQL 20261108130000. À n'utiliser qu'avec GO explicite.
--
-- Ne réintroduit pas à lui seul les écritures Sandbox en Production : la garde
-- serveur (lib/environmentGuard.js) et la séparation des variables Vercel
-- restent en place. Ne jamais retirer deux protections en même temps.
--
-- Exige une confirmation explicite dans la même session :
--   SET mediumia.confirm_guard_removal = 'oui';
BEGIN;
DO $$
BEGIN
  IF COALESCE(current_setting('mediumia.confirm_guard_removal', true), '') <> 'oui' THEN
    RAISE EXCEPTION 'confirmation_requise : SET mediumia.confirm_guard_removal = ''oui''';
  END IF;
END $$;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tgrelid::regclass AS tbl, tgname FROM pg_trigger
           WHERE tgname IN ('zz_mediumia_no_sandbox_in_production', 'zz_mediumia_no_sandbox_entitlement_in_production') LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.mediumia_reject_sandbox_in_production();
DROP FUNCTION IF EXISTS public.mediumia_reject_sandbox_entitlement_in_production();
-- Le marqueur d'environnement est conservé (verrouillé, sans effet sans déclencheur).
COMMIT;
