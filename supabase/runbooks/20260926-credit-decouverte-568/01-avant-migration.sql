-- MediumIA · Crédit Découverte 597 / 568 · CONTRÔLE AVANT MIGRATION (lecture seule)
-- Lancer chaque bloc séparément (le SQL Editor n'affiche que le dernier résultat).

-- A. Les colonnes de crédit n'existent pas encore (attendu : 0 ligne)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents'
  and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at');

-- B. Règles de montant actuelles (attendu : 2 lignes, achat complet live = 59700 seulement)
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)
  and pg_get_constraintdef(oid) like '%amount_cents = 2900%'
order by 1, 2;

-- C. Découvertes live réellement payées, et élèves concernés (attendu aujourd'hui : 0 / 0 / 0)
--    decouvertes_live : Découvertes live provisionnées à 29 €
--    deja_passees_au_complet : parmi elles, élèves ayant ensuite acheté le complet (payé 597 € au lieu de 568 €)
--    credits_deja_consommes : crédits marqués comme utilisés
select
  (select count(*) from public.mediumia_paypal_purchases
     where product_code = 'discovery' and paypal_env = 'live' and status = 'provisioned' and amount_cents = 2900) as decouvertes_live,
  (select count(distinct d.user_id) from public.mediumia_paypal_purchases d
     join public.mediumia_paypal_purchases f
       on f.user_id = d.user_id and f.product_code = 'full' and f.paypal_env = 'live' and f.status = 'provisioned'
      and f.captured_at > d.captured_at
     where d.product_code = 'discovery' and d.paypal_env = 'live' and d.status = 'provisioned') as deja_passees_au_complet,
  (select count(*) from public.mediumia_paypal_purchases where upgrade_credit_redeemed_at is not null) as credits_deja_consommes;

-- D. Aucune commande ni achat à 568 € (attendu : 0 / 0)
select (select count(*) from public.mediumia_paypal_order_intents where amount_cents = 56800) as commandes_568,
       (select count(*) from public.mediumia_paypal_purchases where amount_cents = 56800) as achats_568;

-- E. Empreintes des données qui ne doivent PAS changer (à comparer après migration)
select 'achats' as donnees, count(*) as lignes, md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as empreinte from public.mediumia_paypal_purchases p
union all
select 'commandes', count(*), md5(coalesce(string_agg(concat_ws(';', paypal_order_id, paypal_env, product_code, amount_cents, currency, reference_id, status, paypal_capture_id, captured_at, provisioned_at), '|' order by paypal_order_id), '')) from public.mediumia_paypal_order_intents
union all
select 'droits', count(*), md5(coalesce(string_agg(e::text, '|' order by e::text), '')) from public.mediumia_entitlements e
order by 1;
