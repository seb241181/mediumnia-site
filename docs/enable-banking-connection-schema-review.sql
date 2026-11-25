-- DESIGN DRAFT ONLY: NOT A DEPLOYED MIGRATION.
-- Review in TEST before generating a real migration via Supabase CLI.
-- The server must use service_role only, and no bank consent is activated until verified.
create table if not exists public.rdv_bank_connection_authorizations (
  state_hash text primary key,
  practitioner_id uuid not null references public.booking_practitioners(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','consumed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint bank_auth_state_hash_hex check (state_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists rdv_bank_connection_auth_expiry_idx
  on public.rdv_bank_connection_authorizations (expires_at);

create table if not exists public.rdv_bank_connections (
  practitioner_id uuid primary key references public.booking_practitioners(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'enable_banking'),
  aspsp_name text not null,
  session_id_enc text not null,
  account_uid_enc text not null,
  valid_until timestamptz not null,
  linked_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_sync_error text,
  status text not null check (status in ('review_required','active','revoked'))
);

-- Service-side access only: no browser client can query bank session metadata.
alter table public.rdv_bank_connection_authorizations enable row level security;
alter table public.rdv_bank_connections enable row level security;
revoke all on table public.rdv_bank_connection_authorizations from public, anon, authenticated;
revoke all on table public.rdv_bank_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.rdv_bank_connection_authorizations to service_role;
grant select, insert, update, delete on table public.rdv_bank_connections to service_role;

-- No policies are created for anon/authenticated roles. For service_role,
-- the API checks the Supabase JWT plus booking_practitioners.owner_id.
-- No bank transaction or client payment table is written by this draft.

-- Only minimal reviewed associations are stored, NOT full bank statements.
create table if not exists public.rdv_bank_reconciliation_candidates (
  request_id uuid primary key references public.rdv_bank_booking_requests(id) on delete cascade,
  practitioner_id uuid not null references public.booking_practitioners(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_hash text not null unique check (transaction_hash ~ '^[a-f0-9]{64}$'),
  amount_cents integer not null check (amount_cents > 0),
  booked_on date,
  status text not null default 'review_required' check (status in ('review_required','dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists rdv_bank_candidates_practitioner_idx
  on public.rdv_bank_reconciliation_candidates(practitioner_id, created_at desc);
alter table public.rdv_bank_reconciliation_candidates enable row level security;
revoke all on table public.rdv_bank_reconciliation_candidates from public, anon, authenticated;
grant select, insert, update, delete on table public.rdv_bank_reconciliation_candidates to service_role;

-- Additional preflight: verify the referenced request table/migrations exist in TEST.
-- Do not run this draft SQL against Production without migration and security review.
