-- Preparation only: this migration does not insert a Production calendar id,
-- enable a configuration, or schedule any task. Activation remains separate.
alter table public.availability_calendar_sync_config
  drop constraint if exists availability_calendar_sync_config_environment_check;

alter table public.availability_calendar_sync_config
  add constraint availability_calendar_sync_config_environment_check
  check (environment in ('test', 'production'));

-- The tables contain operational identifiers and timestamps only. Keep them
-- inaccessible through the public Data API even if a future grant is added.
alter table public.availability_calendar_sync_config force row level security;
alter table public.availability_calendar_sync_runs force row level security;
alter table public.availability_calendar_sync_locks force row level security;
