create table public.oracle_free_draws (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint oracle_free_draws_email_hash_key unique (email_hash),
  constraint oracle_free_draws_email_hash_format_check
    check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint oracle_free_draws_status_check
    check (status in ('pending', 'completed')),
  constraint oracle_free_draws_completion_check
    check (
      (status = 'pending' and completed_at is null)
      or (status = 'completed' and completed_at is not null)
    )
);

alter table public.oracle_free_draws enable row level security;

revoke all on table public.oracle_free_draws from public, anon, authenticated;
grant select, insert, update, delete on table public.oracle_free_draws to service_role;
