-- Marque la base TEST (après la migration 20261108130000). Refuse la Production.
BEGIN;
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
COMMIT;
SELECT environment, set_at FROM public.mediumia_runtime_environment;
