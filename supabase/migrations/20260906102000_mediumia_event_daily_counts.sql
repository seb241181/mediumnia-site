create table if not exists public.mediumia_event_daily_counts (
  event_date date not null default current_date,
  event_name text not null,
  source text not null,
  event_count bigint not null default 0 check (event_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (event_date, event_name, source)
);

alter table public.mediumia_event_daily_counts enable row level security;

revoke all on table public.mediumia_event_daily_counts from anon, authenticated;
grant select, insert, update on table public.mediumia_event_daily_counts to service_role;

create or replace function public.increment_mediumia_event(
  p_event_name text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_name is null or p_event_name !~ '^[a-z0-9_]{3,64}$' then
    raise exception 'invalid_event_name';
  end if;

  if p_source is null or p_source !~ '^[a-z0-9:_-]{1,80}$' then
    raise exception 'invalid_source';
  end if;

  insert into public.mediumia_event_daily_counts (
    event_date,
    event_name,
    source,
    event_count,
    updated_at
  )
  values (
    current_date,
    p_event_name,
    p_source,
    1,
    now()
  )
  on conflict (event_date, event_name, source)
  do update set
    event_count = public.mediumia_event_daily_counts.event_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_mediumia_event(text, text) from public, anon, authenticated;
grant execute on function public.increment_mediumia_event(text, text) to service_role;

comment on table public.mediumia_event_daily_counts is
  'Aggregate MediumIA product funnel counters. No user identifier, IP, email, cookie or raw event record is stored.';
