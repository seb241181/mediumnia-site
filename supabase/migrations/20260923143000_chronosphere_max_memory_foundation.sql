-- ChronoSphère MAX — memory foundation.
-- Prepared migration only: do not apply to production before product validation.
-- V2 purchases, packs and payments remain unchanged.

create table if not exists public.chronosphere_timelines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  theme text not null,
  status text not null default 'active'
    check (status in ('active', 'closed', 'archived')),
  memory_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronosphere_timelines_title_length check (char_length(title) between 2 and 160),
  constraint chronosphere_timelines_theme_length check (char_length(theme) between 2 and 120),
  constraint chronosphere_timelines_user_id_id_key unique (user_id, id)
);

create index if not exists chronosphere_timelines_user_status_updated_idx
  on public.chronosphere_timelines (user_id, status, updated_at desc);

create table if not exists public.chronosphere_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  timeline_id uuid not null,
  user_id uuid not null,
  source_draw_table text not null
    check (source_draw_table in ('chronosphere_paid_draws', 'chronosphere_pack_draws')),
  source_draw_id uuid not null,
  sequence_number integer not null check (sequence_number > 0),
  read_at timestamptz not null default now(),
  snapshot_json jsonb not null,
  comparison_json jsonb,
  created_at timestamptz not null default now(),
  constraint chronosphere_timeline_entries_timeline_user_fk
    foreign key (user_id, timeline_id)
    references public.chronosphere_timelines (user_id, id)
    on delete cascade,
  constraint chronosphere_timeline_entries_sequence_key
    unique (timeline_id, sequence_number),
  constraint chronosphere_timeline_entries_source_key
    unique (timeline_id, source_draw_table, source_draw_id),
  constraint chronosphere_timeline_entries_snapshot_version_check
    check (snapshot_json->>'schemaVersion' = 'chronosphere-max-snapshot-v1'),
  constraint chronosphere_timeline_entries_snapshot_no_profile_check
    check (
      not snapshot_json ? 'profile'
      and not snapshot_json ? 'birthDate'
      and not snapshot_json ? 'birthTime'
      and not snapshot_json ? 'birthPlace'
      and not snapshot_json ? 'latitude'
      and not snapshot_json ? 'longitude'
      and not snapshot_json ? 'email'
      and not snapshot_json ? 'deliveryEmail'
      and not snapshot_json ? 'token'
      and not snapshot_json ? 'drawToken'
      and not snapshot_json ? 'packToken'
    ),
  constraint chronosphere_timeline_entries_comparison_version_check
    check (
      comparison_json is null
      or comparison_json->>'schemaVersion' = 'chronosphere-max-comparison-v1'
    )
);

create index if not exists chronosphere_timeline_entries_timeline_sequence_idx
  on public.chronosphere_timeline_entries (timeline_id, sequence_number);

create index if not exists chronosphere_timeline_entries_user_read_idx
  on public.chronosphere_timeline_entries (user_id, read_at desc);

alter table public.chronosphere_timelines enable row level security;
alter table public.chronosphere_timeline_entries enable row level security;

revoke all on table public.chronosphere_timelines from public, anon;
revoke all on table public.chronosphere_timeline_entries from public, anon;
grant select, insert, update, delete on table public.chronosphere_timelines to authenticated;
grant select, insert, update, delete on table public.chronosphere_timeline_entries to authenticated;

drop policy if exists chronosphere_timelines_select_own on public.chronosphere_timelines;
create policy chronosphere_timelines_select_own
  on public.chronosphere_timelines
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timelines_insert_own on public.chronosphere_timelines;
create policy chronosphere_timelines_insert_own
  on public.chronosphere_timelines
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timelines_update_own on public.chronosphere_timelines;
create policy chronosphere_timelines_update_own
  on public.chronosphere_timelines
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timelines_delete_own on public.chronosphere_timelines;
create policy chronosphere_timelines_delete_own
  on public.chronosphere_timelines
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timeline_entries_select_own on public.chronosphere_timeline_entries;
create policy chronosphere_timeline_entries_select_own
  on public.chronosphere_timeline_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timeline_entries_insert_own on public.chronosphere_timeline_entries;
create policy chronosphere_timeline_entries_insert_own
  on public.chronosphere_timeline_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timeline_entries_update_own on public.chronosphere_timeline_entries;
create policy chronosphere_timeline_entries_update_own
  on public.chronosphere_timeline_entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists chronosphere_timeline_entries_delete_own on public.chronosphere_timeline_entries;
create policy chronosphere_timeline_entries_delete_own
  on public.chronosphere_timeline_entries
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
