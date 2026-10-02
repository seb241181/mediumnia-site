-- Schéma minimal pour rejouer, sur un PostgreSQL 16 jetable, les vrais fichiers :
-- docs/rdv-requests-migration.sql, docs/rdv-confirm-request-migration.sql et
-- supabase/migrations/20261002090000_lumia_rdv_intake.sql.
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.booking_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.booking_practitioners (id uuid primary key default gen_random_uuid(), slug text unique, owner_id uuid, buffer_before_min int default 0, buffer_after_min int default 0);
create table public.booking_services (
  id uuid primary key default gen_random_uuid(), practitioner_id uuid references public.booking_practitioners(id),
  slug text not null, title text not null, duration_min int not null, price_cents int, modality text[] not null default '{}', is_active boolean not null default true);
create table public.bookings (
  id uuid primary key default gen_random_uuid(), practitioner_id uuid references public.booking_practitioners(id), service_id uuid references public.booking_services(id),
  starts_at timestamptz not null, ends_at timestamptz not null, timezone text, customer_first_name text not null, customer_last_name text not null,
  customer_email text not null, customer_phone text, customer_message text, status text not null default 'confirmed',
  booking_source text not null default 'mediumia', google_event_id text, created_at timestamptz not null default now());
grant all on all tables in schema public to service_role;
