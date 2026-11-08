\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ÉCHEC : %', label; end if; raise notice 'ok : %', label; end $$;
set role service_role;
do $$ begin
  perform pg_temp.check(public.mediumia_runtime_environment_value() = 'test', 'T1 base marquée test');
  insert into public.mediumia_paypal_purchases (paypal_env) values ('sandbox');
  insert into public.mediumia_entitlements (origin_ref, status) values ('paypal:sandbox:ORDERT', 'active');
  perform pg_temp.check(true, 'T1 achats et droits Sandbox acceptés en TEST');
end $$;
reset role;
select 'ok' as resultat;
