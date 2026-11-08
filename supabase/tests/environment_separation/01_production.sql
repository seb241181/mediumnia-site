-- Base « Production » locale : la garde refuse toute nouvelle ligne Sandbox.
\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ÉCHEC : %', label; end if; raise notice 'ok : %', label; end $$;
create or replace function pg_temp.refused(sql text, expected text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm = expected; end $$;

-- Données « historiques » d'avant la garde, dont des lignes Sandbox.
insert into public.booking_services values ('dab110fb-22b8-4158-aa8e-72d805e7f65c');
insert into public.bookings select from generate_series(1, 60);
insert into public.mediumia_paypal_purchases (id, paypal_env, status) values ('11111111-1111-4111-8111-111111111111', 'sandbox', 'provisioned');
insert into public.mediumia_entitlements (id, origin_ref, status) values ('22222222-2222-4222-8222-222222222222', 'paypal:sandbox:ORDER1', 'active');

do $$ begin
  perform pg_temp.check(public.mediumia_runtime_environment_value() is null, 'P1 migration appliquée sans marquage : garde inactive');
  insert into public.rdv_paypal_payments (paypal_env) values ('sandbox');
  perform pg_temp.check(true, 'P1 sans marquage : aucun changement de comportement (pas d''interruption)');
end $$;

set role service_role;
do $$ begin
  perform pg_temp.check(pg_temp.refused($q$insert into public.mediumia_runtime_environment (environment) values ('test')$q$, 'permission denied for table mediumia_runtime_environment'), 'P2 le serveur ne peut pas changer le marqueur');
end $$;
reset role;
