-- MediumIA · Tarifs 397 / 297 · CONTRÔLE APRÈS MIGRATION (lecture seule)

-- 1. Conférence (attendu : prix_normal 39700, offre 29700, lot 39700 ; offre_active et
--    statut_tirage identiques à « avant » ; libellé identique, ou vide s'il citait 597/499/399)
select e.slug,
       e.pass_normal_amount_cents as prix_normal,
       e.pass_offer_amount_cents as offre,
       e.pass_offer_enabled as offre_active,
       e.pass_offer_label as libelle_offre,
       r.prize_value_cents as lot,
       r.status as statut_tirage
from public.conference_events e
left join public.conference_raffles r on r.event_id = e.id
order by e.slug;

-- 2. Synthèse : une seule ligne, toutes les colonnes doivent valoir true
select
  (select count(*) = 0 from public.conference_events where pass_normal_amount_cents <> 39700) as prix_normal_ok,
  (select column_default = '39700' from information_schema.columns where table_schema = 'public' and table_name = 'conference_events' and column_name = 'pass_normal_amount_cents') as defaut_ok,
  (select pass_offer_amount_cents = 29700 from public.conference_events where slug = 'premiere-conference-mediumia') as offre_ok,
  (select bool_and(r.prize_value_cents = 39700 or r.status = 'drawn') from public.conference_raffles r join public.conference_events e on e.id = r.event_id where e.slug = 'premiere-conference-mediumia') as lot_ok,
  (select prosrc like '%pass_normal_amount_cents, 39700)%' and prosrc not like '%59700%' from pg_proc where proname = 'validate_conference_pass') as fonction_pass_ok,
  (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents' and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at')) as colonnes_credit_ok,
  (select count(*) = 0 from public.mediumia_paypal_order_intents where user_id is not null or upgrade_credit_purchase_id is not null or upgrade_credit_claimed_at is not null) as colonnes_credit_vides,
  (select count(*) = 2 from pg_indexes where schemaname = 'public' and indexname in ('ux_mediumia_order_intents_credit_claim', 'ux_mediumia_purchases_credit_redeemed_by')) as index_ok,
  (select count(*) = 1 from pg_constraint where conrelid = 'public.mediumia_paypal_order_intents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount_cents = 2900%') as une_seule_regle_commandes,
  (select count(*) = 1 from pg_constraint where conrelid = 'public.mediumia_paypal_purchases'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount_cents = 2900%') as une_seule_regle_achats;

-- 3. Contraintes (attendu : les 4 définitions ci-dessous, exactement)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.conference_events'::regclass, 'public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)
  and (pg_get_constraintdef(oid) like '%amount_cents = 2900%' or pg_get_constraintdef(oid) like '%pass_normal_amount_cents%' or conname = 'mediumia_paypal_order_intents_credit_check')
order by 1, 2;

-- 4. Empreintes : doivent être IDENTIQUES à celles d'avant (requête E du contrôle avant)
select 'achats' as donnees, count(*) as lignes, md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as empreinte from public.mediumia_paypal_purchases p
union all
select 'commandes', count(*), md5(coalesce(string_agg(concat_ws(';', paypal_order_id, paypal_env, product_code, amount_cents, currency, reference_id, status, paypal_capture_id, captured_at, provisioned_at), '|' order by paypal_order_id), '')) from public.mediumia_paypal_order_intents
union all
select 'droits', count(*), md5(coalesce(string_agg(e::text, '|' order by e::text), '')) from public.mediumia_entitlements e
union all
select 'pass_conference', count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.conference_passes x
union all
select 'inscriptions', count(*), md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.conference_registrations x
order by 1;
