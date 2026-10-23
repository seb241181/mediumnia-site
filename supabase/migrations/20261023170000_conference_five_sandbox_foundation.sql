-- Additive, server-only foundation for a single owner-approved conference offer.
-- No PROD migration permission. Apply to Supabase TEST first; live code hard-disabled.
create table if not exists public.conference_five_contracts (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.conference_registrations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  offer_code text not null default 'conference-pass-499-five-monthly'
    check (offer_code = 'conference-pass-499-five-monthly'),
  total_cents integer not null default 49900 check (total_cents = 49900),
  instalment_cents integer not null default 9980 check (instalment_cents = 9980),
  instalments integer not null default 5 check (instalments = 5),
  currency text not null default 'EUR' check (currency = 'EUR'),
  paypal_env text not null default 'sandbox' check (paypal_env = 'sandbox'),
  status text not null default 'invited'
    check (status in ('invited','creating','approval_pending','active','completed','suspended','cancelled','review_required')),
  meetings_approved boolean not null default false,
  terms_version text,
  terms_accepted_at timestamptz,
  paypal_plan_id text,
  paypal_subscription_id text unique,
  first_paid_at timestamptz,
  provider_last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists conference_five_one_active_user
  on public.conference_five_contracts(user_id)
  where status in ('invited','creating','approval_pending','active','suspended','review_required');
create index if not exists conference_five_contracts_user_idx
  on public.conference_five_contracts(user_id, created_at desc);

create table if not exists public.conference_five_transactions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.conference_five_contracts(id) on delete restrict,
  provider_id text not null unique,
  paypal_subscription_id text not null,
  paypal_env text not null default 'sandbox' check (paypal_env = 'sandbox'),
  kind text not null check (kind in ('capture','refund')),
  capture_id text not null,
  status text not null check (status in ('COMPLETED', 'PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  paid_at timestamptz not null,
  verified_at timestamptz not null default now()
);
create unique index if not exists conference_five_transactions_by_contract
  on public.conference_five_transactions(contract_id, provider_id);

create table if not exists public.conference_five_audit (
  id bigint generated always as identity primary key,
  contract_id uuid not null references public.conference_five_contracts(id) on delete restrict,
  event_name text not null check (length(event_name) between 2 and 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.conference_five_contracts enable row level security;
alter table public.conference_five_transactions enable row level security;
alter table public.conference_five_audit enable row level security;
revoke all on public.conference_five_contracts from public, anon, authenticated;
revoke all on public.conference_five_transactions from public, anon, authenticated;
revoke all on public.conference_five_audit from public, anon, authenticated;
grant select, insert, update on public.conference_five_contracts to service_role;
grant select, insert, update on public.conference_five_transactions to service_role;
grant select, insert on public.conference_five_audit to service_role;
grant usage, select on sequence public.conference_five_audit_id_seq to service_role;
comment on table public.conference_five_contracts is 'TEST first: one manually owner-approved, individual conference payment schedule. No browser access.';
comment on table public.conference_five_transactions is 'Provider-verified sandbox transaction snapshots, unique PayPal provider id; no user writes.';
