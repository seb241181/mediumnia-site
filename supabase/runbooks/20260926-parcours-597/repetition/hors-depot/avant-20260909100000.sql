-- Manques constatés avant 20260909100000 (espace élève) : objets créés hors dépôt.
-- 1. mediumia_paypal_purchases (achats PayPal Formation / Découverte)
create table public.mediumia_paypal_purchases (
  id uuid primary key default gen_random_uuid(),
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  user_id uuid references auth.users(id) on delete set null,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  amount_cents integer not null,
  currency text not null default 'EUR',
  reference_id text,
  status text not null,
  payer_email text, payer_name text,
  duration_days integer,
  terms_version text, terms_accepted_at timestamptz, immediate_access_accepted_at timestamptz,
  entitlement_id uuid, failure_code text,
  pdf_download_token_hash text, pdf_download_expires_at timestamptz, pdf_download_count integer not null default 0,
  captured_at timestamptz, provisioned_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.mediumia_paypal_purchases enable row level security;
-- 2. mediumia_students : colonnes utilisées par le code et les migrations, jamais ajoutées par un fichier des dépôts
alter table public.mediumia_students add column if not exists display_name text, add column if not exists license_number text;
-- 3. Déclencheur de mise à jour de mediumia_paypal_purchases (référencé, jamais créé dans les dépôts)
create or replace function public.mediumia_paypal_purchase_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger mediumia_paypal_purchases_set_updated_at before update on public.mediumia_paypal_purchases for each row execute function public.mediumia_paypal_purchase_set_updated_at();
