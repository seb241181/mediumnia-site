-- Google Calendar OAuth support required by the isolated RDV PayPal Sandbox.
-- Additive and idempotent: no Production data is read or modified by this file.

create table if not exists public.booking_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  practitioner_id uuid not null unique
    references public.booking_practitioners(id) on delete cascade,
  google_email text not null,
  google_calendar_id text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  token_expiry timestamptz not null,
  is_active boolean not null default true
);

alter table public.booking_calendar_connections enable row level security;

revoke all on table public.booking_calendar_connections from anon;
revoke all on table public.booking_calendar_connections from authenticated;
grant select on table public.booking_calendar_connections to authenticated;
grant all on table public.booking_calendar_connections to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'booking_calendar_connections'
      and policyname = 'calendar_conn_owner_select'
  ) then
    create policy calendar_conn_owner_select
      on public.booking_calendar_connections
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.booking_practitioners bp
          where bp.id = practitioner_id
            and bp.owner_id = (select auth.uid())
        )
      );
  end if;
end
$$;

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  practitioner_slug text not null,
  practitioner_id uuid not null
    references public.booking_practitioners(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_states_expires
  on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;

revoke all on table public.oauth_states from anon;
revoke all on table public.oauth_states from authenticated;
grant all on table public.oauth_states to service_role;

create or replace function public.consume_oauth_state(p_state text)
returns table(practitioner_slug text, practitioner_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  delete from public.oauth_states
  where state = p_state
    and expires_at > now()
  returning
    oauth_states.practitioner_slug,
    oauth_states.practitioner_id,
    oauth_states.user_id;
end;
$$;

revoke execute on function public.consume_oauth_state(text) from public;
revoke execute on function public.consume_oauth_state(text) from anon;
revoke execute on function public.consume_oauth_state(text) from authenticated;
grant execute on function public.consume_oauth_state(text) to service_role;
