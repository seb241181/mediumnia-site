-- MediumIA · Parcours 597 € · 00. HISTORIQUE DES MIGRATIONS (lecture seule)
-- But : savoir ce que Supabase croit appliqué, et ce qui l'est réellement,
-- AVANT toute nouvelle migration et avant tout « supabase db push ».
-- Lancer chaque bloc séparément (le SQL Editor n'affiche que le dernier résultat).
-- Aucune écriture ici.

-- A. La table d'historique existe-t-elle ? (null = aucun historique enregistré)
select to_regclass('supabase_migrations.schema_migrations') as table_historique;

-- B. Ce que l'historique contient (les 20 dernières versions).
--    Si le bloc A a renvoyé null, ce bloc échoue : c'est normal, passer au C.
select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 20;

-- C. Les trois migrations concernées : présentes dans l'historique ?
--    Attendu aujourd'hui : 20260925120000 = false, 20260926090000 = false
--    (appliquée à la main le 26/09), 20261001090000 = false.
select v.version,
       exists (select 1 from supabase_migrations.schema_migrations m where m.version = v.version) as dans_historique
from (values ('20260925120000'), ('20260926090000'), ('20261001090000')) as v(version)
order by 1;

-- D. Réalité du schéma : le crédit Découverte (20260926090000) est-il bien en place ?
--    Attendu : une ligne, toutes les colonnes à true. C'est la preuve qui autorise
--    à marquer 20260926090000 « appliquée » SANS la rejouer.
select
  (select count(*) = 3 from information_schema.columns
     where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents'
       and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at')) as credit_colonnes,
  (select count(*) = 2 from pg_indexes
     where schemaname = 'public' and indexname in ('ux_mediumia_order_intents_credit_claim', 'ux_mediumia_purchases_credit_redeemed_by')) as credit_index,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_paypal_order_intents_credit_check') as credit_regle,
  (select count(*) = 1 from pg_constraint
     where conrelid = 'public.mediumia_paypal_purchases'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%56800%') as achats_568_autorises;

-- E. Réalité du schéma : l'ancien parcours (20260925120000, modèle 34 €) est-il en place ?
--    Attendu aujourd'hui : 4 × null (jamais appliqué). Si une table existe,
--    le runbook 01 dit quoi vérifier ; la migration 597 sait la reprendre.
select to_regclass('public.mediumia_formation_payments') as registre,
       to_regclass('public.mediumia_formation_subscriptions') as abonnements,
       to_regclass('public.mediumia_formation_unlock_orders') as tout_debloquer,
       to_regclass('public.mediumia_paypal_plans') as plans;
