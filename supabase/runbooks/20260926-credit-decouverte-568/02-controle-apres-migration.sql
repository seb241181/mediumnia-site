-- MediumIA · Crédit Découverte 597 / 568 · CONTRÔLE APRÈS MIGRATION (lecture seule)

-- 1. Synthèse : une ligne, toutes les colonnes doivent valoir true
select
  (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents' and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at')) as colonnes_credit_ok,
  (select count(*) = 0 from public.mediumia_paypal_order_intents where user_id is not null or upgrade_credit_purchase_id is not null or upgrade_credit_claimed_at is not null) as colonnes_credit_vides,
  (select count(*) = 2 from pg_indexes where schemaname = 'public' and indexname in ('ux_mediumia_order_intents_credit_claim', 'ux_mediumia_purchases_credit_redeemed_by')) as index_ok,
  (select count(*) = 1 from pg_constraint where conrelid = 'public.mediumia_paypal_order_intents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount_cents = 2900%') as une_seule_regle_commandes,
  (select count(*) = 1 from pg_constraint where conrelid = 'public.mediumia_paypal_purchases'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount_cents = 2900%') as une_seule_regle_achats,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_paypal_order_intents_credit_check') as regle_credit_ok,
  (select bool_and(pg_get_constraintdef(oid) not like '%39700%' and pg_get_constraintdef(oid) not like '%36800%') from pg_constraint where conrelid in ('public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass) and contype = 'c') as aucun_montant_397_368;

-- 2. Règles (attendu : les 3 définitions, exactement)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)
  and (pg_get_constraintdef(oid) like '%amount_cents = 2900%' or conname = 'mediumia_paypal_order_intents_credit_check')
order by 1, 2;

-- 3. Empreintes : doivent être IDENTIQUES à celles d'avant (bloc E du contrôle avant)
select 'achats' as donnees, count(*) as lignes, md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as empreinte from public.mediumia_paypal_purchases p
union all
select 'commandes', count(*), md5(coalesce(string_agg(concat_ws(';', paypal_order_id, paypal_env, product_code, amount_cents, currency, reference_id, status, paypal_capture_id, captured_at, provisioned_at), '|' order by paypal_order_id), '')) from public.mediumia_paypal_order_intents
union all
select 'droits', count(*), md5(coalesce(string_agg(e::text, '|' order by e::text), '')) from public.mediumia_entitlements e
order by 1;
