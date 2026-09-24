-- Explicit raffle eligibility for conference registrations.
-- Household members, the organizer and anyone involved in the draw can be kept
-- registered for the conference while being excluded from raffle participation.

alter table public.conference_registrations
  add column if not exists raffle_eligible boolean not null default true,
  add column if not exists raffle_exclusion_reason text;

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
  if not v_registration.raffle_eligible then
    return jsonb_build_object('ok', false, 'reason', 'raffle_not_eligible');
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
    and r.raffle_eligible
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
