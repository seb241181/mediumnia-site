-- Ce que la plateforme Supabase fournit avant toute migration du projet
-- (rôles, schémas auth / storage / extensions, pg_cron, pg_net). Simulation minimale
-- pour reconstruire une base neuve hors Supabase ; aucune table MediumIA ici.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;
set search_path = "$user", public, extensions;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz, is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
create schema storage;
create table storage.buckets (id text primary key, name text not null, owner uuid, owner_id text, public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text, path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant usage on schema storage to anon, authenticated, service_role;
