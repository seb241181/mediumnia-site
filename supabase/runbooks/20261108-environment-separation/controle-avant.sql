-- Contrôle AVANT la migration 20261108130000 (lecture seule, à lancer sur la base visée).
-- 1. Quelle base ? (la prestation dab110fb… n'existe qu'en Production)
SELECT EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c') AS est_la_production,
       (SELECT count(*) FROM public.bookings) AS rendez_vous;
-- 2. Rien du même nom n'existe déjà.
SELECT to_regclass('public.mediumia_runtime_environment') IS NULL AS marqueur_absent,
       NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'zz_mediumia_no_sandbox%') AS declencheurs_absents;
-- 3. Photographie des lignes Sandbox existantes (elles ne seront pas modifiées).
SELECT t AS table_name, n AS lignes_sandbox FROM (
  SELECT 'rdv_paypal_payments' t, count(*) n FROM public.rdv_paypal_payments WHERE paypal_env = 'sandbox'
  UNION ALL SELECT 'mediumia_paypal_purchases', count(*) FROM public.mediumia_paypal_purchases WHERE paypal_env = 'sandbox'
  UNION ALL SELECT 'mediumia_entitlements (origine sandbox)', count(*) FROM public.mediumia_entitlements WHERE origin_ref ~ '^[a-z-]+:sandbox:'
  UNION ALL SELECT 'gift_cards', count(*) FROM public.gift_cards WHERE paypal_env = 'sandbox'
  UNION ALL SELECT 'mediumia_email_questions', count(*) FROM public.mediumia_email_questions WHERE paypal_env = 'sandbox'
  UNION ALL SELECT 'conference_passes', count(*) FROM public.conference_passes WHERE paypal_env = 'sandbox'
) x ORDER BY 1;
