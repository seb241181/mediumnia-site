-- MediumIA · Tarifs 397 / 297 · CONTRÔLE AVANT MIGRATION (lecture seule, ne modifie rien)
-- À lancer dans le SQL Editor juste avant la migration. Garder le résultat (copie d'écran).

-- A. Valeurs actuelles de la conférence (attendu : 59700 / 49900 / lot 59700 / tirage non effectué)
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

-- B. Les colonnes de crédit n'existent pas encore (attendu : 0 ligne)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents'
  and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at');

-- C. Contraintes de montant actuelles (attendu : 3 lignes, toutes avec 59700 et sans 39700)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.conference_events'::regclass, 'public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)
  and (pg_get_constraintdef(oid) like '%amount_cents = 2900%' or pg_get_constraintdef(oid) like '%pass_normal_amount_cents%')
order by 1, 2;

-- D. Aucune commande ni achat à un nouveau montant (attendu : 0 / 0)
select (select count(*) from public.mediumia_paypal_order_intents where amount_cents in (39700, 36800)) as commandes_nouveau_prix,
       (select count(*) from public.mediumia_paypal_purchases where amount_cents in (39700, 36800)) as achats_nouveau_prix;

-- E. Empreintes des données qui ne doivent PAS changer (à comparer après migration)
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
