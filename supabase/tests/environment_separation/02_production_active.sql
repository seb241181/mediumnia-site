\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ÉCHEC : %', label; end if; raise notice 'ok : %', label; end $$;
create or replace function pg_temp.refused(sql text, expected text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm = expected; end $$;

set role service_role;
do $$
declare t text;
begin
  perform pg_temp.check(public.mediumia_runtime_environment_value() = 'production', 'P3 base marquée production');
  foreach t in array array['rdv_paypal_payments','rdv_balance_payments','rdv_payment_refunds','rdv_deposit_transfers',
    'mediumia_paypal_purchases','mediumia_paypal_order_intents','mediumia_paypal_plans','mediumia_formation_payments',
    'mediumia_formation_subscriptions','mediumia_formation_unlock_orders','mediumia_email_questions','gift_cards','conference_passes'] loop
    perform pg_temp.check(pg_temp.refused(format('insert into public.%I (paypal_env) values (''sandbox'')', t), 'sandbox_payment_in_production'), 'P3 Sandbox refusé : ' || t);
    execute format('insert into public.%I (paypal_env) values (''live'')', t);
  end loop;
  perform pg_temp.check(true, 'P3 paiements Live acceptés sur les 13 tables');

  update public.mediumia_paypal_purchases set status = 'refunded' where id = '11111111-1111-4111-8111-111111111111';
  perform pg_temp.check(true, 'P4 ligne Sandbox historique : statut toujours modifiable (aucune donnée bloquée)');
  perform pg_temp.check(pg_temp.refused($q$update public.mediumia_paypal_purchases set paypal_env = 'sandbox' where paypal_env = 'live'$q$, 'sandbox_payment_in_production'), 'P4 passage d''une ligne Live en Sandbox refusé');

  perform pg_temp.check(pg_temp.refused($q$insert into public.mediumia_entitlements (origin_ref, status) values ('paypal:sandbox:ORDER2', 'active')$q$, 'sandbox_entitlement_in_production'), 'P5 droit Formation d''origine Sandbox refusé');
  perform pg_temp.check(pg_temp.refused($q$insert into public.mediumia_entitlements (origin_ref, status) values ('parcours:sandbox:SUB1', 'active')$q$, 'sandbox_entitlement_in_production'), 'P5 droit Parcours d''origine Sandbox refusé');
  insert into public.mediumia_entitlements (origin_ref, status) values ('paypal:live:ORDER3', 'active'), ('founder:1e39a893-eac3-4427-a5c6-22059d9f49ab', 'active');
  perform pg_temp.check(true, 'P5 droits Live et fondateur acceptés');
  update public.mediumia_entitlements set status = 'active' where id = '22222222-2222-4222-8222-222222222222';
  perform pg_temp.check(true, 'P5 droit Sandbox historique : inchangé et toujours modifiable (aucun droit révoqué)');

  insert into public.chronosphere_credit_packs (paypal_env) values ('sandbox');
  perform pg_temp.check(true, 'P6 tables ChronoSphère non concernées (chantier Codex)');
end $$;
reset role;

do $$ begin
  perform pg_temp.check(pg_temp.refused($q$update public.mediumia_runtime_environment set environment = 'test'$q$, 'runtime_environment_locked'), 'P7 marqueur production verrouillé (modification)');
  perform pg_temp.check(pg_temp.refused($q$delete from public.mediumia_runtime_environment$q$, 'runtime_environment_locked'), 'P7 marqueur production verrouillé (suppression)');
  perform pg_temp.check(not has_table_privilege('anon', 'public.mediumia_runtime_environment', 'select'), 'P8 marqueur illisible pour les visiteurs');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.mediumia_runtime_environment_value()', 'execute'), 'P8 fonction réservée au serveur');
  perform pg_temp.check((select count(*) from public.mediumia_paypal_purchases where paypal_env = 'sandbox') = 1, 'P9 aucune ligne existante supprimée');
end $$;
select 'ok' as resultat;
