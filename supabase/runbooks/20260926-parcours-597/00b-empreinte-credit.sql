-- MediumIA · Parcours 597 € · 00b. EMPREINTE DU CRÉDIT 568 € (lecture seule)
-- À lancer JUSTE AVANT et JUSTE APRÈS l'étape B (repair 20260926090000).
-- Les deux résultats doivent être IDENTIQUES : repair n'écrit que dans
-- l'historique, jamais dans le schéma ni dans les données.
-- Ne renvoie que des nombres et des empreintes (aucune donnée personnelle).

select
  -- Schéma : colonnes, règles et index des deux tables du crédit
  (select md5(string_agg(table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), '|' order by table_name, column_name))
     from information_schema.columns
    where table_schema = 'public' and table_name in ('mediumia_paypal_order_intents', 'mediumia_paypal_purchases')) as empreinte_colonnes,
  (select md5(string_agg(conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname))
     from pg_constraint
    where conrelid in ('public.mediumia_paypal_order_intents'::regclass, 'public.mediumia_paypal_purchases'::regclass)) as empreinte_regles,
  (select md5(string_agg(indexdef, '|' order by indexdef))
     from pg_indexes
    where schemaname = 'public' and tablename in ('mediumia_paypal_order_intents', 'mediumia_paypal_purchases')) as empreinte_index,
  -- Données : nombre de lignes et empreinte complète des deux tables
  (select count(*) from public.mediumia_paypal_purchases) as achats,
  (select md5(coalesce(string_agg(p::text, '|' order by p::text), '')) from public.mediumia_paypal_purchases p) as empreinte_achats,
  (select count(*) from public.mediumia_paypal_order_intents) as commandes,
  (select md5(coalesce(string_agg(i::text, '|' order by i::text), '')) from public.mediumia_paypal_order_intents i) as empreinte_commandes,
  -- Crédits en cours / consommés (attendu identique avant / après)
  (select count(*) from public.mediumia_paypal_order_intents where upgrade_credit_claimed_at is not null) as credits_reserves,
  (select count(*) from public.mediumia_paypal_purchases where upgrade_credit_redeemed_at is not null) as credits_consommes;
