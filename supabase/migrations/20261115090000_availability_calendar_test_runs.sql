-- Operational state for the TEST-only informational availability calendar.
alter table public.availability_calendar_sync_config
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists last_error_code text;

create table if not exists public.availability_calendar_sync_runs (
  id uuid primary key,
  practitioner_id uuid not null references public.booking_practitioners(id) on delete cascade,
  source_calendar_id text not null,
  target_calendar_id text not null,
  status text not null check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  deleted_count integer not null default 0,
  error_code text
);
create index if not exists availability_calendar_sync_runs_recent
  on public.availability_calendar_sync_runs (practitioner_id, started_at desc);
alter table public.availability_calendar_sync_runs enable row level security;
revoke all on public.availability_calendar_sync_runs from anon, authenticated;
grant select, insert, update on public.availability_calendar_sync_runs to service_role;

create table if not exists public.availability_calendar_sync_locks (
  practitioner_id uuid primary key references public.booking_practitioners(id) on delete cascade,
  run_id uuid not null,
  locked_until timestamptz not null
);
alter table public.availability_calendar_sync_locks enable row level security;
revoke all on public.availability_calendar_sync_locks from anon, authenticated;
grant select, insert, update, delete on public.availability_calendar_sync_locks to service_role;

create or replace function public.claim_availability_calendar_sync_lock(
  p_practitioner_id uuid, p_run_id uuid, p_ttl_seconds integer default 120
) returns boolean language plpgsql security definer set search_path = public as $$
declare claimed boolean := false;
begin
  insert into public.availability_calendar_sync_locks (practitioner_id, run_id, locked_until)
  values (p_practitioner_id, p_run_id, now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 300))))
  on conflict (practitioner_id) do update
    set run_id = excluded.run_id, locked_until = excluded.locked_until
    where availability_calendar_sync_locks.locked_until < now()
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.release_availability_calendar_sync_lock(
  p_practitioner_id uuid, p_run_id uuid
) returns void language sql security definer set search_path = public as $$
  delete from public.availability_calendar_sync_locks
  where practitioner_id = p_practitioner_id and run_id = p_run_id;
$$;
revoke all on function public.claim_availability_calendar_sync_lock(uuid, uuid, integer) from public;
revoke all on function public.release_availability_calendar_sync_lock(uuid, uuid) from public;
grant execute on function public.claim_availability_calendar_sync_lock(uuid, uuid, integer) to service_role;
grant execute on function public.release_availability_calendar_sync_lock(uuid, uuid) to service_role;
