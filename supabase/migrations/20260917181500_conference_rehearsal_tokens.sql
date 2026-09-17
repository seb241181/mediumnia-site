create table if not exists public.conference_rehearsal_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists conference_rehearsal_tokens_owner_expiry_idx
  on public.conference_rehearsal_tokens(owner_id, expires_at desc);

alter table public.conference_rehearsal_tokens enable row level security;
revoke all on public.conference_rehearsal_tokens from public, anon, authenticated;
grant all on public.conference_rehearsal_tokens to service_role;

comment on table public.conference_rehearsal_tokens is 'Hashed temporary access tokens for the MediumIA conference rehearsal copilot. Raw tokens are never stored.';
