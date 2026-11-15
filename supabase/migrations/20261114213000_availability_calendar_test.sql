-- TEST-only configuration for the informational availability calendar.
-- No Production calendar id is ever stored by this migration.
create table if not exists public.availability_calendar_sync_config (
  practitioner_id uuid primary key references public.booking_practitioners(id) on delete cascade,
  target_calendar_id text not null check (target_calendar_id <> ''),
  source_calendar_id text not null check (source_calendar_id <> ''),
  enabled boolean not null default false,
  environment text not null check (environment = 'test'),
  updated_at timestamptz not null default now(),
  check (target_calendar_id <> source_calendar_id)
);

alter table public.availability_calendar_sync_config enable row level security;
revoke all on public.availability_calendar_sync_config from anon, authenticated;
grant select, insert, update, delete on public.availability_calendar_sync_config to service_role;
