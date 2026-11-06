-- 00 — Contrôles AVANT, lecture seule. Chaque ligne doit afficher « ok ».
-- Toute ligne différente : ne pas appliquer 01, la Production a changé depuis la préparation.
select 'creation paiement integral = version video seule attendue' as controle,
  case when md5(regexp_replace(pg_get_functiondef('public.create_rdv_full_payment_hold'::regproc), '\s+', ' ', 'g')) = '123f4c27a4dbafcbbe53d5cd6465c3e0' then 'ok' else 'DIFFERENT' end as resultat
union all select 'protection rendez-vous = version video seule attendue',
  case when md5(regexp_replace(pg_get_functiondef('public.enforce_mediumia_booking_reservation_payment'::regproc), '\s+', ' ', 'g')) = 'aa738e5cf2f3653ebeb60bafbc3b1228' then 'ok' else 'DIFFERENT' end
union all select 'reclamation capture = version historique attendue',
  case when md5(regexp_replace(pg_get_functiondef('public.claim_rdv_deposit_capture'::regproc), '\s+', ' ', 'g')) = '023638252baeb4d35c45f44c83716fb4' then 'ok' else 'DIFFERENT' end
union all select 'conversion sans restriction video (aucune modification prevue)',
  case when position('''video'' = ANY(v_service.modality)' in pg_get_functiondef('public.convert_rdv_deposit_hold'::regproc)) = 0 then 'ok' else 'DIFFERENT' end
union all select 'fonctions de paiement reservees au serveur',
  case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_rdv_deposit_hold','create_rdv_full_payment_hold','claim_rdv_deposit_capture','convert_rdv_deposit_hold') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')) = 4 then 'ok' else 'DIFFERENT' end
union all select 'objets de fiabilite absents (premiere application)',
  case when to_regclass('public.rdv_checkout_events') is null and not exists (select 1 from pg_proc where proname = 'release_rdv_deposit_capture') then 'ok' else 'DEJA PRESENTS' end
union all select 'paiements en capture (attendu : 2, ceux du 14/10 et du 03/11)',
  case when (select count(*) from public.rdv_paypal_payments where status = 'capturing') = 2 then 'ok' else (select count(*)::text from public.rdv_paypal_payments where status = 'capturing') end;
