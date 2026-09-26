-- Base de répétition « type production » : ce que Supabase fournit (rôles, auth, storage)
-- et les tables existantes que touchent les migrations. Données anonymisées et fictives.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create function storage.extension(name text) returns text language sql as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
create table public.mediumia_students (id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id), display_name text, license_number text);
create table public.mediumia_entitlements (
  id uuid primary key default gen_random_uuid(), user_id uuid references public.mediumia_students(user_id),
  type text not null check (type in ('legacy_code','purchase','admin','trial')), origin_ref text,
  access_started_at timestamptz not null, access_expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  access_level text not null default 'full' check (access_level in ('discovery','full')),
  max_module int not null default 25 check (max_module between 1 and 25),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (type, origin_ref),
  constraint mediumia_entitlements_level_scope_check check ((access_level = 'discovery' and max_module = 1) or (access_level = 'full' and max_module = 25)));
create table public.mediumia_paypal_purchases (id uuid primary key default gen_random_uuid(), paypal_order_id text unique, paypal_capture_id text, user_id uuid, paypal_env text, amount_cents int, status text,
  product_code text not null default 'full', upgrade_credit_cents int not null default 0, upgrade_credit_redeemed_at timestamptz, upgrade_credit_redeemed_purchase_id uuid, captured_at timestamptz, provisioned_at timestamptz);
alter table public.mediumia_paypal_purchases add constraint mediumia_paypal_purchases_product_amount_check check (
  (paypal_env = 'sandbox' and amount_cents = 100) or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
  or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900));
insert into auth.users values
  ('11111111-1111-4111-8111-111111111111', 'claire@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'paul@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'owner@example.test');
insert into public.mediumia_students (user_id) select id from auth.users;
insert into public.mediumia_entitlements (user_id, type, origin_ref, access_started_at, access_expires_at, access_level, max_module) values
  ('33333333-3333-4333-8333-333333333333', 'admin', 'admin:owner', '2026-08-01', '2099-12-31', 'full', 25),
  ('11111111-1111-4111-8111-111111111111', 'purchase', 'paypal:live:discovery:DCL', '2026-09-27', '2026-10-27', 'discovery', 1),
  ('22222222-2222-4222-8222-222222222222', 'purchase', 'paypal:sandbox:FULLP', '2026-09-01', '2027-09-01', 'full', 25);
insert into public.mediumia_paypal_purchases (paypal_order_id, paypal_capture_id, user_id, paypal_env, amount_cents, status, product_code, upgrade_credit_cents, captured_at, provisioned_at) values
  ('OD1', 'DCL', '11111111-1111-4111-8111-111111111111', 'live', 2900, 'provisioned', 'discovery', 2900, '2026-09-27', '2026-09-27'),
  ('OS1', 'SD1', '22222222-2222-4222-8222-222222222222', 'sandbox', 100, 'provisioned', 'discovery', 2900, '2026-09-01', '2026-09-01'),
  ('OS2', 'SF1', '22222222-2222-4222-8222-222222222222', 'sandbox', 100, 'provisioned', 'full', 0, '2026-09-02', '2026-09-02'),
  ('OS3', 'SX1', '22222222-2222-4222-8222-222222222222', 'sandbox', 100, 'failed', 'full', 0, null, null);
