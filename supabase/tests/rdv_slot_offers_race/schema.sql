create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table public.booking_practitioners (id uuid primary key default gen_random_uuid(), slug text, buffer_before_min int default 0, buffer_after_min int default 0, max_per_day int);
create table public.booking_services (id uuid primary key default gen_random_uuid(), practitioner_id uuid references public.booking_practitioners(id));
create table public.bookings (id uuid primary key default gen_random_uuid(), practitioner_id uuid, status text, starts_at timestamptz, ends_at timestamptz);
create table public.rdv_booking_holds (id uuid primary key default gen_random_uuid(), practitioner_id uuid, service_id uuid, starts_at timestamptz, ends_at timestamptz,
  status text not null default 'payment_pending' check (status in ('payment_pending','payment_capturing','payment_captured','converted','expired','failed')),
  expires_at timestamptz, converted_booking_id uuid, updated_at timestamptz default now());
create table public.rdv_paypal_payments (id uuid primary key default gen_random_uuid(), hold_id uuid unique references public.rdv_booking_holds(id), paypal_order_id text unique, status text, paypal_capture_id text, last_error_code text);
grant all on all tables in schema public to service_role;
