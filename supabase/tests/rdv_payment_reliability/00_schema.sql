-- Schéma minimal (colonnes utilisées) pour tester localement le paiement des RDV.
-- Aucune donnée de Production : uniquement des structures et des valeurs factices.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.booking_practitioners (
  id uuid primary key default gen_random_uuid(),
  buffer_before_min integer default 0,
  buffer_after_min integer default 0,
  max_per_day integer
);
create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.booking_practitioners(id),
  is_active boolean not null default true,
  booking_mode text not null default 'instant',
  reservation_payment_kind text not null default 'arrhes',
  reservation_payment_cents integer not null default 2000,
  price_cents integer not null default 7000,
  currency text not null default 'EUR',
  modality text[] not null default array['in-person'],
  duration_min integer not null default 60
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);
create table public.rdv_booking_holds (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null, service_id uuid not null,
  starts_at timestamptz not null, ends_at timestamptz not null, selected_modality text not null,
  customer_first_name text, customer_last_name text, customer_email text, customer_phone text, customer_message text,
  service_price_cents integer not null, reservation_payment_cents integer not null, currency text not null,
  status text not null check (status in ('payment_pending','payment_capturing','payment_captured','converted','expired','failed')),
  expires_at timestamptz, converted_booking_id uuid, terms_version text, terms_accepted_at timestamptz,
  early_performance_requested_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  payment_choice text not null default 'arrhes', slot_offer_id uuid,
  check ((status = 'payment_pending' and expires_at is not null) or status <> 'payment_pending')
);
create table public.rdv_paypal_payments (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null unique references public.rdv_booking_holds(id),
  paypal_order_id text unique, paypal_capture_id text unique,
  paypal_env text not null, amount_cents integer not null, currency text not null,
  status text not null check (status in ('order_pending','capturing','captured','expired','failed')),
  client_checkout_id uuid unique, captured_at timestamptz, last_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
