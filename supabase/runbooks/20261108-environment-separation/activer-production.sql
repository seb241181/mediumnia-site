-- Active la garde sur la base de PRODUCTION (après la migration 20261108130000).
-- Refuse de s'exécuter si la base n'est pas celle de Production.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     OR (SELECT count(*) FROM public.bookings) < 50 THEN
    RAISE EXCEPTION 'pas_la_base_de_production : marquage refusé';
  END IF;
END $$;
INSERT INTO public.mediumia_runtime_environment (environment) VALUES ('production')
ON CONFLICT (singleton) DO NOTHING;
DO $$
BEGIN
  IF public.mediumia_runtime_environment_value() IS DISTINCT FROM 'production' THEN
    RAISE EXCEPTION 'marquage_incoherent : la base porte déjà un autre marqueur';
  END IF;
END $$;
COMMIT;
SELECT environment, set_at FROM public.mediumia_runtime_environment;
