-- À lancer en Production AVANT la migration 20261108120000 (lecture seule).
-- Les trois fonctions remplacées doivent être exactement celles relues le
-- 08/11/2026 ; sinon, ne pas appliquer : la migration écraserait une version
-- plus récente.
SELECT p.proname,
       md5(pg_get_functiondef(p.oid)) AS empreinte,
       md5(pg_get_functiondef(p.oid)) = CASE p.proname
         WHEN 'create_or_get_rdv_balance_payment' THEN '39a37b224da3a10ffb7598ff0a1b9dbb'
         WHEN 'claim_rdv_balance_capture' THEN '52cfebd3ea58784697ea36ab998710a1'
         WHEN 'rdv_balance_cancel_blocker' THEN 'b593676c6e6250e777d2c5e25cef4fec'
       END AS conforme
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_or_get_rdv_balance_payment', 'claim_rdv_balance_capture', 'rdv_balance_cancel_blocker')
ORDER BY 1;
-- Attendu : 3 lignes, « conforme » = true partout.

-- Aucun objet du même nom ne doit déjà exister.
SELECT to_regclass('public.rdv_offline_payments') IS NULL AS table_libre,
       to_regclass('public.rdv_offline_payment_events') IS NULL AS historique_libre;
