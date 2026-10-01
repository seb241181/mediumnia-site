-- Schéma minimal (colonnes réellement utilisées) pour rejouer la migration
-- 20260930230000_rdv_deposit_settlements.sql sur un PostgreSQL 16 jetable.
create extension if not exists pgcrypto;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.booking_practitioners (id uuid primary key default gen_random_uuid(), slug text, owner_id uuid);
create table public.booking_services (id uuid primary key default gen_random_uuid(), practitioner_id uuid references public.booking_practitioners(id), title text, modality text[], vat_rate_bps int not null default 0);
create table public.bookings (
  id uuid primary key default gen_random_uuid(), practitioner_id uuid references public.booking_practitioners(id), service_id uuid references public.booking_services(id),
  status text not null, starts_at timestamptz, ends_at timestamptz, customer_first_name text, customer_last_name text, customer_email text,
  booked_price_cents int, reservation_payment_cents int, booking_source text default 'mediumia', cancelled_at timestamptz, cancel_reason text,
  balance_paid_at timestamptz, balance_payment_token_hash text, balance_payment_token_expires_at timestamptz, balance_cancel_claimed_at timestamptz,
  updated_at timestamptz default now());
create table public.rdv_booking_holds (id uuid primary key default gen_random_uuid(), status text not null default 'converted', converted_booking_id uuid references public.bookings(id));
create table public.rdv_paypal_payments (
  id uuid primary key default gen_random_uuid(), hold_id uuid not null unique references public.rdv_booking_holds(id) on delete cascade,
  paypal_order_id text unique, paypal_capture_id text unique, paypal_env text not null check (paypal_env in ('sandbox','live')),
  amount_cents int not null check (amount_cents > 0), currency text not null default 'EUR',
  status text not null default 'order_pending' check (status in ('order_pending','capturing','captured','expired','failed')),
  captured_at timestamptz, last_error_code text);
create table public.rdv_balance_payments (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.bookings(id),
  client_checkout_id uuid not null default gen_random_uuid(), paypal_order_id text unique, paypal_capture_id text unique,
  paypal_env text not null, amount_cents int not null check (amount_cents > 0), currency text not null default 'EUR',
  status text not null default 'order_pending' check (status in ('order_pending','capture_in_progress','captured','failed')),
  last_error_code text, updated_at timestamptz default now());
-- Grand livre : définition réelle (20260916190000 + contraintes de 20260924120000).
CREATE TABLE public.rdv_financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES public.booking_practitioners(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE RESTRICT,
  service_id UUID REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('mediumia', 'reservio', 'manual')),
  entry_kind TEXT NOT NULL CONSTRAINT rdv_financial_entries_entry_kind_check CHECK (entry_kind IN ('arrhes', 'balance', 'full_payment', 'refund', 'arrhes_retained', 'adjustment', 'gift_card_sale')),
  direction TEXT NOT NULL CHECK (direction IN ('income', 'refund')),
  payment_method TEXT NOT NULL CONSTRAINT rdv_financial_entries_payment_method_check CHECK (payment_method IN ('paypal', 'card', 'cash', 'check', 'transfer', 'other', 'gift_card')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gross_cents INTEGER NOT NULL CHECK (gross_cents > 0),
  net_cents INTEGER NOT NULL CHECK (net_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000),
  vat_status TEXT NOT NULL DEFAULT 'taxable' CHECK (vat_status IN ('taxable', 'outside_scope', 'review')),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  service_price_cents INTEGER CHECK (service_price_cents IS NULL OR service_price_cents > 0),
  appointment_starts_at TIMESTAMPTZ, customer_name TEXT, customer_email TEXT,
  external_booking_ref TEXT, external_payment_ref TEXT, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_cents + vat_cents = gross_cents));
CREATE UNIQUE INDEX uq_rdv_financial_entries_external_payment_ref ON public.rdv_financial_entries (source, external_payment_ref) WHERE external_payment_ref IS NOT NULL;
-- Fonctions réelles reprises à l'identique.
CREATE OR REPLACE FUNCTION public.rdv_booking_paid_cents(p_booking_id UUID) RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(CASE direction WHEN 'income' THEN gross_cents WHEN 'refund' THEN -gross_cents ELSE 0 END), 0)::INTEGER
  FROM public.rdv_financial_entries WHERE booking_id = p_booking_id AND source = 'mediumia'; $$;
CREATE OR REPLACE FUNCTION public.normalize_mediumia_rdv_financial_kind() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source = 'mediumia' AND NEW.direction = 'income' AND NEW.payment_method = 'paypal' AND NEW.entry_kind = 'arrhes'
    AND NEW.service_price_cents IS NOT NULL AND NEW.gross_cents = NEW.service_price_cents THEN
    NEW.entry_kind := 'full_payment'; NEW.note := 'Paiement intégral du rendez-vous MediumIA';
  END IF; RETURN NEW;
END; $$;
CREATE TRIGGER rdv_financial_normalize_full_payment BEFORE INSERT ON public.rdv_financial_entries FOR EACH ROW EXECUTE FUNCTION public.normalize_mediumia_rdv_financial_kind();
grant all on all tables in schema public to service_role;
