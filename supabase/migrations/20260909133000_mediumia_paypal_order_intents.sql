-- Preuve serveur durable créée avant capture PayPal.
create table if not exists public.mediumia_paypal_order_intents (
  paypal_order_id text primary key,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  product_code text not null check (product_code in ('full', 'discovery')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'EUR'),
  reference_id text not null,
  access_level text not null check (access_level in ('full', 'discovery')),
  max_module integer not null check (max_module between 1 and 25),
  duration_days integer not null check (duration_days in (30, 365)),
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  immediate_access_accepted_at timestamptz not null,
  status text not null default 'created'
    check (status in ('created', 'captured', 'provisioning_failed', 'provisioned')),
  paypal_capture_id text unique,
  last_error text,
  captured_at timestamptz,
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (product_code = 'discovery' and access_level = 'discovery' and max_module = 1 and duration_days = 30)
    or
    (product_code = 'full' and access_level = 'full' and max_module = 25 and duration_days = 365)
  ),
  check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or
    (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
    or
    (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
  )
);

alter table public.mediumia_paypal_order_intents enable row level security;
revoke all on table public.mediumia_paypal_order_intents from public, anon, authenticated;
grant select, insert, update on table public.mediumia_paypal_order_intents to service_role;

create index if not exists idx_mediumia_paypal_order_intents_reconcile
  on public.mediumia_paypal_order_intents (status, updated_at)
  where status in ('captured', 'provisioning_failed');

comment on table public.mediumia_paypal_order_intents is
  'Preuve serveur immuable du produit, prix et consentement enregistrée avant toute capture PayPal.';
