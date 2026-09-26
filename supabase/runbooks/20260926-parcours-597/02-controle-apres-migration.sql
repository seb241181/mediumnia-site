-- MediumIA · Parcours 597 € · 02. CONTRÔLE APRÈS MIGRATION (lecture seule)
-- Lancer chaque bloc séparément.

-- 1. Synthèse : une ligne, toutes les colonnes doivent valoir true.
select
  (select count(*) = 4 from (values
     (to_regclass('public.mediumia_formation_payments')),
     (to_regclass('public.mediumia_formation_subscriptions')),
     (to_regclass('public.mediumia_formation_unlock_orders')),
     (to_regclass('public.mediumia_paypal_plans'))) t(x) where x is not null) as tables_ok,
  (select bool_and(relrowsecurity) from pg_class where oid in (
     'public.mediumia_formation_payments'::regclass, 'public.mediumia_formation_subscriptions'::regclass,
     'public.mediumia_formation_unlock_orders'::regclass, 'public.mediumia_paypal_plans'::regclass)) as rls_active,
  (select count(*) = 0 from pg_policies where tablename in (
     'mediumia_formation_payments', 'mediumia_formation_subscriptions', 'mediumia_formation_unlock_orders', 'mediumia_paypal_plans')) as aucune_policy,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_formation_subscriptions_amounts_597_check') as regle_abonnement_597,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_formation_unlock_orders_amount_597_check') as regle_debloquer_597,
  (select count(*) = 1 from pg_constraint
     where conrelid = 'public.mediumia_formation_subscriptions'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ '(step_cents|final_cents|regular_count)') as une_seule_regle_abonnement,
  (select count(*) = 1 from pg_constraint
     where conrelid = 'public.mediumia_formation_unlock_orders'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'amount_cents') as une_seule_regle_debloquer,
  (select bool_and(pg_get_constraintdef(oid) !~ '(39700|36800)') from pg_constraint
     where conrelid in ('public.mediumia_formation_subscriptions'::regclass, 'public.mediumia_formation_unlock_orders'::regclass)) as aucun_montant_397_368,
  (select count(*) = 1 from pg_proc where proname = 'mediumia_set_path_entitlement') as fonction_ok,
  (select not has_function_privilege('anon', 'public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.mediumia_set_path_entitlement(uuid, text, integer, timestamptz)', 'execute')) as fonction_serveur_seulement,
  (select count(*) = 0 from public.mediumia_formation_payments where kind in ('monthly', 'unlock', 'refund') and paypal_env = 'live') as aucun_paiement_parcours_live,
  (select count(*) = 0 from public.mediumia_formation_subscriptions where paypal_env = 'live') as aucun_abonnement_live;

-- 2. Règles de montant (attendu : les 2 définitions 597 €).
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.mediumia_formation_subscriptions'::regclass, 'public.mediumia_formation_unlock_orders'::regclass)
  and conname like '%597%'
order by 1, 2;

-- 3. Registre recopié : doit correspondre au bloc E du contrôle avant
--    (valeur live = montant encaissé ; Sandbox : 2900 / 59700).
select paypal_env, kind, amount_cents, value_cents, count(*) as lignes
from public.mediumia_formation_payments
group by 1, 2, 3, 4
order by 1, 2, 3;

-- 4. Aucun élève au-delà de 597 € en paiements réels (attendu : 0 ligne).
--    Une ligne ici = un trop-perçu historique à examiner (et rembourser).
--    Les essais Sandbox (argent fictif) ne sont pas concernés.
select user_id, sum(case when kind = 'refund' then -value_cents else value_cents end) as total_cents
from public.mediumia_formation_payments
where paypal_env = 'live'
group by 1
having sum(case when kind = 'refund' then -value_cents else value_cents end) > 59700;

-- 5. Empreintes : doivent être IDENTIQUES à celles d'avant (bloc G du contrôle avant).
select 'achats' as donnees, count(*) as lignes, md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as empreinte from public.mediumia_paypal_purchases p
union all
select 'commandes', count(*), md5(coalesce(string_agg(i::text, '|' order by i::text), '')) from public.mediumia_paypal_order_intents i
union all
select 'droits', count(*), md5(coalesce(string_agg(e::text, '|' order by e::text), '')) from public.mediumia_entitlements e
order by 1;
