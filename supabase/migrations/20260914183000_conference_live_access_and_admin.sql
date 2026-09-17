alter table public.conference_registrations
  add column if not exists live_access_token_hash text,
  add column if not exists live_access_issued_at timestamptz,
  add column if not exists live_last_seen_at timestamptz;

create unique index if not exists conference_registrations_live_access_token_hash_uq
  on public.conference_registrations(live_access_token_hash)
  where live_access_token_hash is not null;

create index if not exists conference_registrations_live_seen_idx
  on public.conference_registrations(event_id, live_last_seen_at desc)
  where live_last_seen_at is not null;

create table if not exists public.conference_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.conference_admins enable row level security;
revoke all on public.conference_admins from anon, authenticated;
grant all on public.conference_admins to service_role;

create or replace function public.enter_conference_raffle(p_raffle_id uuid, p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_raffle public.conference_raffles%rowtype;
  v_registration public.conference_registrations%rowtype;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;

  if v_raffle.status not in ('scheduled','open') then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_open');
  end if;
  if v_raffle.opens_at is not null and now() < v_raffle.opens_at then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_open');
  end if;
  if v_raffle.closes_at is not null and now() > v_raffle.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'raffle_closed');
  end if;

  select * into v_registration from public.conference_registrations where id = p_registration_id;
  if not found or v_registration.event_id <> v_raffle.event_id then
    return jsonb_build_object('ok', false, 'reason', 'registration_invalid');
  end if;
  if v_registration.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'registration_cancelled');
  end if;
  if v_registration.attended_at is null then
    return jsonb_build_object('ok', false, 'reason', 'attendance_required');
  end if;
  if v_registration.live_last_seen_at is null or v_registration.live_last_seen_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'live_presence_required');
  end if;

  insert into public.conference_raffle_entries (raffle_id, registration_id)
  values (p_raffle_id, p_registration_id)
  on conflict (raffle_id, registration_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.enter_conference_raffle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enter_conference_raffle(uuid, uuid) to service_role;
