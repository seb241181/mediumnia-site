alter table public.availability_calendar_sync_runs
  add column if not exists updated_count integer not null default 0;
