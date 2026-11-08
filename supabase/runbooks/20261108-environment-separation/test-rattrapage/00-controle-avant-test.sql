-- Lecture seule, sur TEST, avant B2. S'arrêter si « est_test » n'est pas vrai.
SELECT NOT EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
       AND EXISTS (SELECT 1 FROM public.booking_practitioners WHERE slug = 'seb-test') AS est_test,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r') AS tables_public,
       (SELECT count(*) FROM public.bookings) AS rendez_vous_test,
       (SELECT count(*) FROM auth.users) AS comptes_test;
-- Aucune adresse client réelle dans TEST (relevé du 08/11/2026 : 0).
SELECT count(*) AS adresses_non_test FROM public.bookings
WHERE customer_email !~* '(example\.(org|com|invalid)|test|mediumia|seguin|sebastien)';
