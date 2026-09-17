create table if not exists public.conference_raffles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.conference_events(id) on delete cascade,
  prize_title text not null,
  prize_value_cents integer not null check (prize_value_cents > 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  status text not null default 'scheduled' check (status in ('draft','scheduled','open','closed','drawn','cancelled')),
  opens_at timestamptz,
  closes_at timestamptz,
  winner_registration_id uuid references public.conference_registrations(id) on delete set null,
  drawn_at timestamptz,
  rules_version text not null default '2026-09-14',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);

create table if not exists public.conference_raffle_entries (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.conference_raffles(id) on delete cascade,
  registration_id uuid not null references public.conference_registrations(id) on delete cascade,
  terms_accepted_at timestamptz not null default now(),
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (raffle_id, registration_id)
);

create index if not exists conference_raffle_entries_raffle_idx on public.conference_raffle_entries(raffle_id);
create index if not exists conference_raffle_entries_registration_idx on public.conference_raffle_entries(registration_id);

alter table public.conference_raffles enable row level security;
alter table public.conference_raffle_entries enable row level security;

revoke all on public.conference_raffles from anon, authenticated;
revoke all on public.conference_raffle_entries from anon, authenticated;
grant all on public.conference_raffles to service_role;
grant all on public.conference_raffle_entries to service_role;

create or replace function public.enter_conference_raffle(p_raffle_id uuid, p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  insert into public.conference_raffle_entries (raffle_id, registration_id)
  values (p_raffle_id, p_registration_id)
  on conflict (raffle_id, registration_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.draw_conference_raffle(p_raffle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raffle public.conference_raffles%rowtype;
  v_winner uuid;
begin
  select * into v_raffle from public.conference_raffles where id = p_raffle_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'raffle_not_found'); end if;

  if v_raffle.winner_registration_id is not null then
    return jsonb_build_object('ok', true, 'alreadyDrawn', true, 'winnerRegistrationId', v_raffle.winner_registration_id);
  end if;

  if v_raffle.closes_at is not null and now() < v_raffle.closes_at and v_raffle.status <> 'closed' then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_closed');
  end if;

  select e.registration_id
    into v_winner
  from public.conference_raffle_entries e
  join public.conference_registrations r on r.id = e.registration_id
  where e.raffle_id = p_raffle_id
    and r.event_id = v_raffle.event_id
    and r.attended_at is not null
    and r.status <> 'cancelled'
  order by gen_random_uuid()
  limit 1;

  if v_winner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_eligible_entries');
  end if;

  update public.conference_raffles
  set winner_registration_id = v_winner,
      drawn_at = now(),
      status = 'drawn',
      updated_at = now()
  where id = p_raffle_id;

  return jsonb_build_object('ok', true, 'winnerRegistrationId', v_winner);
end;
$$;

revoke all on function public.enter_conference_raffle(uuid, uuid) from public, anon, authenticated;
revoke all on function public.draw_conference_raffle(uuid) from public, anon, authenticated;
grant execute on function public.enter_conference_raffle(uuid, uuid) to service_role;
grant execute on function public.draw_conference_raffle(uuid) to service_role;

insert into public.conference_raffles (
  event_id, prize_title, prize_value_cents, currency, status, opens_at, closes_at, rules_version
)
select e.id,
       '1 accès complet à la formation MediumIA',
       59700,
       'EUR',
       'scheduled',
       '2026-10-23T17:50:00Z'::timestamptz,
       '2026-10-23T17:57:00Z'::timestamptz,
       '2026-09-14'
from public.conference_events e
where e.slug = 'premiere-conference-mediumia'
on conflict (event_id) do update
set prize_title = excluded.prize_title,
    prize_value_cents = excluded.prize_value_cents,
    currency = excluded.currency,
    status = case when public.conference_raffles.status = 'drawn' then public.conference_raffles.status else excluded.status end,
    opens_at = excluded.opens_at,
    closes_at = excluded.closes_at,
    rules_version = excluded.rules_version,
    updated_at = now();