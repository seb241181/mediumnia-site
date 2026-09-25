-- MediumIA · Parcours 597 € · 01. CONTRÔLE AVANT MIGRATION (lecture seule)
-- À lancer juste avant 20261001090000_formation_parcours_597.sql.
-- Lancer chaque bloc séparément (le SQL Editor n'affiche que le dernier résultat).

-- A. Tables du parcours déjà présentes ? (attendu aujourd'hui : 4 × null)
--    Si des tables existent (ancienne migration 34 € appliquée), passer les blocs
--    B et C ; sinon ils échouent (table inconnue) : c'est normal, aller au D.
select to_regclass('public.mediumia_formation_payments') as registre,
       to_regclass('public.mediumia_formation_subscriptions') as abonnements,
       to_regclass('public.mediumia_formation_unlock_orders') as tout_debloquer,
       to_regclass('public.mediumia_paypal_plans') as plans;

-- B. (seulement si A n'est pas null) Contenu existant : attendu 0 abonnement et
--    0 paiement mensuel ou « tout débloquer » en live. Si ce n'est pas le cas : stop.
select
  (select count(*) from public.mediumia_formation_subscriptions where paypal_env = 'live') as abonnements_live,
  (select count(*) from public.mediumia_formation_subscriptions where paypal_env = 'sandbox') as abonnements_sandbox,
  (select count(*) from public.mediumia_formation_payments where paypal_env = 'live' and kind in ('monthly', 'unlock', 'refund')) as paiements_parcours_live,
  (select count(*) from public.mediumia_formation_unlock_orders where paypal_env = 'live') as commandes_debloquer_live;

-- C. (seulement si A n'est pas null) Règles de montant actuelles (ancien modèle : 3400 / 36800).
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'c'
  and conrelid in ('public.mediumia_formation_subscriptions'::regclass, 'public.mediumia_formation_unlock_orders'::regclass)
order by 1, 2;

-- D. Les droits d'accès respectent la future règle « Découverte = module 1,
--    complet = modules 1 à 25 » (attendu : 0). Sinon : stop.
select count(*) as droits_hors_regle
from public.mediumia_entitlements
where not ((access_level = 'discovery' and max_module = 1) or (access_level = 'full' and max_module between 1 and 25));

-- E. Achats qui seront recopiés dans le registre du parcours
--    (Découvertes et achats complets provisionnés, par environnement et montant).
select paypal_env, product_code, amount_cents, count(*) as achats
from public.mediumia_paypal_purchases
where status = 'provisioned' and user_id is not null and paypal_capture_id is not null
  and product_code in ('discovery', 'full')
group by 1, 2, 3
order by 1, 2, 3;

-- F. Découvertes live : combien, et combien remboursées côté base (attendu : 0 remboursée).
--    La vérification PayPal (remboursement fait dans PayPal) est refaite par le
--    serveur à chaque paiement du parcours.
select count(*) filter (where status = 'provisioned') as decouvertes_live_provisionnees,
       count(*) filter (where status <> 'provisioned') as decouvertes_live_autres_statuts
from public.mediumia_paypal_purchases
where product_code = 'discovery' and paypal_env = 'live';

-- G. Empreintes des données qui ne doivent PAS changer (à comparer au runbook 02).
select 'achats' as donnees, count(*) as lignes, md5(coalesce(string_agg(p::text, '|' order by p::text), '')) as empreinte from public.mediumia_paypal_purchases p
union all
select 'commandes', count(*), md5(coalesce(string_agg(i::text, '|' order by i::text), '')) from public.mediumia_paypal_order_intents i
union all
select 'droits', count(*), md5(coalesce(string_agg(e::text, '|' order by e::text), '')) from public.mediumia_entitlements e
order by 1;
