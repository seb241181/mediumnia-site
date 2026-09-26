-- MediumIA · Parcours 597 € · 00. DIAGNOSTIC DU SCHÉMA ET DE L'HISTORIQUE (lecture seule)
-- But : savoir ce que Supabase croit appliqué, et ce qui l'est réellement,
-- AVANT toute migration et avant toute réparation de l'historique.
-- Lancer chaque bloc séparément (le SQL Editor n'affiche que le dernier résultat).
-- Aucune écriture ici. Résultats attendus aujourd'hui indiqués pour chaque bloc.

-- A. La table d'historique existe-t-elle ?
--    Attendu : null (le SQL Editor n'enregistre rien ; aucune migration n'a été
--    poussée par le CLI). Si ce n'est pas null, les blocs B et C disent ce qu'elle contient.
select to_regclass('supabase_migrations.schema_migrations') as table_historique;

-- B. Contenu de l'historique (toutes les versions, des deux dépôts site et espace élève).
--    Si le bloc A a renvoyé null, ce bloc échoue (table inconnue) : c'est normal.
select version, name, coalesce(array_length(statements, 1), 0) as nb_instructions
from supabase_migrations.schema_migrations
order by version;

-- C. Les versions concernées par le parcours : présentes dans l'historique ?
--    Attendu : false partout (ou erreur si A = null).
select v.version, v.depot,
       exists (select 1 from supabase_migrations.schema_migrations m where m.version = v.version) as dans_historique
from (values ('20260925120000', 'site'), ('20260925150000', 'espace élève'),
             ('20260926090000', 'site'), ('20260926100000', 'site')) as v(version, depot)
order by 1;

-- D. Réalité : le crédit Découverte (20260926090000) est-il entièrement en place ?
--    Attendu : une ligne, toutes les colonnes à true. C'est la preuve qui autorise
--    à l'inscrire « appliquée » dans l'historique SANS rejouer son SQL.
select
  (select count(*) = 3 from information_schema.columns
     where table_schema = 'public' and table_name = 'mediumia_paypal_order_intents'
       and column_name in ('user_id', 'upgrade_credit_purchase_id', 'upgrade_credit_claimed_at')) as credit_colonnes,
  (select count(*) = 2 from pg_indexes
     where schemaname = 'public' and indexname in ('ux_mediumia_order_intents_credit_claim', 'ux_mediumia_purchases_credit_redeemed_by')) as credit_index,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_paypal_order_intents_credit_check') as credit_regle,
  (select count(*) = 1 from pg_constraint where conname = 'mediumia_paypal_order_intents_amount_check') as regle_commandes,
  (select count(*) = 1 from pg_constraint
     where conrelid = 'public.mediumia_paypal_purchases'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%56800%') as achats_568_autorises;

-- E. Réalité : l'ancien parcours 34 € (20260925120000) a-t-il été appliqué ?
--    Attendu : 5 × null / false = jamais appliqué. C'est la preuve qu'il ne faut
--    PAS l'inscrire dans l'historique.
select to_regclass('public.mediumia_formation_payments') as registre,
       to_regclass('public.mediumia_formation_subscriptions') as abonnements,
       to_regclass('public.mediumia_formation_unlock_orders') as tout_debloquer,
       to_regclass('public.mediumia_paypal_plans') as plans,
       (select count(*) > 0 from pg_proc where proname = 'mediumia_set_path_entitlement') as fonction_parcours;

-- F. Dépendances de la migration espace élève 20260925150000 (PDF personnels,
--    Fondatrice, transition) : tout ce qu'elle utilise existe-t-il ?
--    Attendu : une ligne, toutes les colonnes à true. Elle n'utilise aucun objet
--    du parcours ni des paiements : elle peut passer avant ou après la 597.
select
  (select to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null) as storage_tables,
  (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'storage' and p.proname in ('foldername', 'extension')) as storage_fonctions,
  (select exists (select 1 from pg_index i
     where i.indrelid = 'public.mediumia_students'::regclass and i.indisunique and i.indnkeyatts = 1
       and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) = 'user_id')) as eleves_user_id_unique,
  (select count(*) = 8 from information_schema.columns
     where table_schema = 'public' and table_name = 'mediumia_entitlements'
       and column_name in ('user_id', 'type', 'origin_ref', 'access_started_at', 'access_expires_at', 'status', 'access_level', 'max_module')) as droits_colonnes,
  (select count(*) = 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'mediumia_entitlements' and column_name = 'updated_at') as droits_updated_at;

-- G. Réalité : la migration espace élève 20260925150000 a-t-elle déjà été appliquée ?
--    Attendu aujourd'hui : false / false / false (pas encore appliquée).
select
  (select count(*) > 0 from pg_proc where proname = 'mediumia_grant_founder') as fonction_fondatrice,
  (select count(*) > 0 from pg_proc where proname = 'mediumia_parcours_opening_transition') as fonction_transition,
  (select count(*) > 0 from storage.buckets where id = 'mediumia-personal-pdfs') as coffre_pdf_personnels;
