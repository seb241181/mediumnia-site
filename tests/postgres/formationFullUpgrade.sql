\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;

create table auth.users (
  id uuid primary key
);

create sequence public.mediumia_license_number_seq;

create or replace function public.mediumia_next_license_number()
returns text
language sql
as $$
  select 'MED-' || lpad(nextval('public.mediumia_license_number_seq')::text, 6, '0');
$$;

create table public.mediumia_students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  license_number text not null default public.mediumia_next_license_number()
);

create table public.mediumia_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  type text not null,
  origin_ref text,
  access_started_at timestamptz not null,
  access_expires_at timestamptz not null,
  status text not null default 'active',
  access_level text not null default 'full',
  max_module integer not null default 25
);

create unique index idx_mediumia_purchase_origin_unique
  on public.mediumia_entitlements (origin_ref)
  where type = 'purchase';

create role anon;
create role authenticated;
create role service_role;

\ir ../../supabase/migrations/20260909170005_mediumia_full_upgrade_immediate.sql

do $test$
declare
  u_none uuid := '00000000-0000-4000-8000-000000000901';
  u_disc uuid := '00000000-0000-4000-8000-000000000902';
  u_full uuid := '00000000-0000-4000-8000-000000000903';
  u_replay uuid := '00000000-0000-4000-8000-000000000904';
  result jsonb;
  entitlement public.mediumia_entitlements%rowtype;
  prior_full_end timestamptz;
  first_entitlement_id uuid;
begin
  insert into auth.users (id)
  values (u_none), (u_disc), (u_full), (u_replay);

  result := public.mediumia_grant_purchase_atomic(u_none, 'test-full-none-20260909', 365);
  select * into entitlement
  from public.mediumia_entitlements
  where id = (result->>'entitlement_id')::uuid;

  if result->>'status' <> 'granted'
     or entitlement.access_level <> 'full'
     or entitlement.max_module <> 25
     or abs(extract(epoch from (entitlement.access_started_at - now()))) > 5
     or abs(extract(epoch from (
       entitlement.access_expires_at - entitlement.access_started_at - interval '365 days'
     ))) > 1 then
    raise exception 'no access -> Full failed: %', result;
  end if;

  insert into public.mediumia_entitlements (
    user_id, type, origin_ref, access_started_at, access_expires_at,
    status, access_level, max_module
  ) values (
    u_disc, 'purchase', 'test-discovery-active-20260909',
    now() - interval '1 day', now() + interval '30 days',
    'active', 'discovery', 1
  );

  result := public.mediumia_grant_purchase_atomic(
    u_disc, 'test-full-after-discovery-20260909', 365
  );
  select * into entitlement
  from public.mediumia_entitlements
  where id = (result->>'entitlement_id')::uuid;

  if abs(extract(epoch from (entitlement.access_started_at - now()))) > 5
     or abs(extract(epoch from (
       entitlement.access_expires_at - entitlement.access_started_at - interval '365 days'
     ))) > 1
     or entitlement.access_level <> 'full'
     or entitlement.max_module <> 25 then
    raise exception 'Discovery -> Full failed: %', result;
  end if;

  prior_full_end := now() + interval '100 days';
  insert into public.mediumia_entitlements (
    user_id, type, origin_ref, access_started_at, access_expires_at,
    status, access_level, max_module
  ) values (
    u_full, 'purchase', 'test-full-current-20260909',
    now() - interval '10 days', prior_full_end,
    'active', 'full', 25
  );

  result := public.mediumia_grant_purchase_atomic(u_full, 'test-full-renew-20260909', 365);
  select * into entitlement
  from public.mediumia_entitlements
  where id = (result->>'entitlement_id')::uuid;

  if abs(extract(epoch from (entitlement.access_started_at - prior_full_end))) > 1
     or abs(extract(epoch from (
       entitlement.access_expires_at - prior_full_end - interval '365 days'
     ))) > 1 then
    raise exception 'Full -> Full renewal failed: %', result;
  end if;

  result := public.mediumia_grant_purchase_atomic(u_replay, 'test-full-replay-20260909', 365);
  first_entitlement_id := (result->>'entitlement_id')::uuid;
  result := public.mediumia_grant_purchase_atomic(u_replay, 'test-full-replay-20260909', 365);

  if result->>'status' <> 'already_granted'
     or (result->>'entitlement_id')::uuid <> first_entitlement_id
     or (
       select count(*)
       from public.mediumia_entitlements
       where origin_ref = 'test-full-replay-20260909'
     ) <> 1 then
    raise exception 'payment replay failed: %', result;
  end if;
end
$test$;

select '4/4 PostgreSQL entitlement scenarios passed' as result;
