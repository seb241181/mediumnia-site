-- MediumIA global account profile.
-- Optional birth data used to prefill Chronosphere for authenticated users.

create table if not exists public.mediumia_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  birth_date date,
  birth_time time without time zone,
  birth_place text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mediumia_profiles_full_name_length check (full_name is null or char_length(full_name) <= 120),
  constraint mediumia_profiles_birth_place_length check (birth_place is null or char_length(birth_place) <= 180)
);

alter table public.mediumia_profiles enable row level security;

revoke all on table public.mediumia_profiles from anon;
grant select, insert, update, delete on table public.mediumia_profiles to authenticated;

drop policy if exists mediumia_profiles_select_own on public.mediumia_profiles;
create policy mediumia_profiles_select_own
  on public.mediumia_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists mediumia_profiles_insert_own on public.mediumia_profiles;
create policy mediumia_profiles_insert_own
  on public.mediumia_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists mediumia_profiles_update_own on public.mediumia_profiles;
create policy mediumia_profiles_update_own
  on public.mediumia_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists mediumia_profiles_delete_own on public.mediumia_profiles;
create policy mediumia_profiles_delete_own
  on public.mediumia_profiles
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
