-- Prepared only. Service-role RPCs; no changes to prices, PayPal or classic packs.
-- One-time transactional migration: a second run fails at CREATE TABLE and rolls back.
-- Rollback, if needed before any attempt exists: drop these four functions, then
-- chronosphere_max_attempts. Once attempts exist, retain them for recovery.
begin;

create table public.chronosphere_max_attempts (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null,
  user_id uuid not null,
  nonce text not null check (length(nonce) between 8 and 120),
  request_json jsonb not null,
  request_hash text not null,
  draw_id uuid unique references public.chronosphere_pack_draws(id),
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (pack_id, nonce),
  foreign key (user_id, pack_id) references public.chronosphere_credit_packs(user_id, id)
);
alter table public.chronosphere_max_attempts enable row level security;
revoke all on public.chronosphere_max_attempts from public, anon, authenticated;
grant all on public.chronosphere_max_attempts to service_role;
create index on public.chronosphere_max_attempts(user_id, created_at desc);

create function public.begin_chronosphere_max_attempt(
  p_user_id uuid, p_pack_token_hash text, p_nonce text, p_request jsonb,
  p_previous_attempt_id uuid default null, p_legacy_request_hash text default null,
  p_replace_request boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.chronosphere_credit_packs%rowtype;
  a public.chronosphere_max_attempts%rowtype;
  d public.chronosphere_pack_draws%rowtype;
  v_id uuid := gen_random_uuid();
begin
  select * into p from public.chronosphere_credit_packs
    where pack_token_hash = p_pack_token_hash and user_id = p_user_id and product_type = 'max3' for update;
  if not found then raise exception 'max_access_denied'; end if;
  select * into a from public.chronosphere_max_attempts where pack_id = p.id and nonce = p_nonce;
  if found then
    -- Only a never-claimed or refunded attempt can accept corrected input.
    select * into d from public.chronosphere_pack_draws where id = a.draw_id for update;
    if p_replace_request and a.published_at is null and (a.draw_id is null or d.status = 'failed') then
      update public.chronosphere_max_attempts set request_json = p_request where id = a.id;
    end if;
    return a.id;
  end if;

  select x.* into d from public.chronosphere_pack_draws x where x.pack_id = p.id and x.status = 'processing'
    and not exists (select 1 from public.chronosphere_max_attempts m where m.draw_id = x.id)
    order by x.created_at limit 1;
  if found then
    if d.request_hash is distinct from p_legacy_request_hash then raise exception 'max_legacy_request_required'; end if;
    insert into public.chronosphere_max_attempts(id, pack_id, user_id, nonce, request_json, request_hash, draw_id)
      values (v_id, p.id, p_user_id, p_nonce, p_request, d.request_hash, d.id);
    return v_id;
  end if;

  -- Adopt pre-migration completed results missing their memory before reserving again.
  select x.* into d from public.chronosphere_pack_draws x
    where x.pack_id = p.id and x.status = 'completed'
      and not exists (select 1 from public.chronosphere_max_attempts m where m.draw_id = x.id)
      and not exists (select 1 from public.chronosphere_timeline_entries e where e.source_draw_table = 'chronosphere_pack_draws' and e.source_draw_id = x.id)
    order by x.created_at, x.id limit 1;
  if found then
    insert into public.chronosphere_max_attempts(id, pack_id, user_id, nonce, request_json, request_hash, draw_id)
      values (v_id, p.id, p_user_id, 'legacy-' || d.id,
        jsonb_build_object('profile', d.result_json->'profile', 'theme', d.result_json->>'theme', 'maxTimelineTitle', d.result_json->>'theme'),
        d.request_hash, d.id);
    return v_id;
  end if;

  select * into a from public.chronosphere_max_attempts where pack_id = p.id order by created_at desc, id desc limit 1;
  if found and (a.published_at is null or a.id is distinct from p_previous_attempt_id) then return a.id; end if;
  if p_nonce is null then return null; end if;
  if p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{8,120}$' then raise exception 'invalid_max_read_nonce'; end if;
  if p.credits_remaining <= 0 or p.status <> 'active' then raise exception 'max_no_credits'; end if;
  if nullif(p_request->>'maxTimelineId', '') is not null and not exists (
    select 1 from public.chronosphere_timelines where max_pack_id = p.id and user_id = p_user_id and id::text = p_request->>'maxTimelineId'
  ) then raise exception 'max_timeline_mismatch'; end if;
  insert into public.chronosphere_max_attempts(id, pack_id, user_id, nonce, request_json, request_hash)
    values (v_id, p.id, p_user_id, p_nonce, p_request, 'max-attempt:' || v_id);
  return v_id;
end $$;

create function public.read_chronosphere_max_attempt(p_user_id uuid, p_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.chronosphere_max_attempts%rowtype;
  p public.chronosphere_credit_packs%rowtype;
  d public.chronosphere_pack_draws%rowtype;
  t public.chronosphere_timelines%rowtype;
  entries jsonb;
begin
  select * into a from public.chronosphere_max_attempts
    where user_id = p_user_id and (p_attempt_id is null or id = p_attempt_id)
    order by created_at desc, id desc limit 1;
  if not found then return null; end if;
  select * into p from public.chronosphere_credit_packs where id = a.pack_id and user_id = p_user_id and product_type = 'max3';
  if not found then raise exception 'max_access_denied'; end if;
  select * into d from public.chronosphere_pack_draws where id = a.draw_id;
  select * into t from public.chronosphere_timelines where max_pack_id = p.id and user_id = p_user_id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence_number), '[]'::jsonb) into entries
    from public.chronosphere_timeline_entries e where e.timeline_id = t.id and e.user_id = p_user_id;
  return jsonb_build_object('attempt', to_jsonb(a), 'draw', case when d.id is null then null else to_jsonb(d) end,
    'pack', jsonb_build_object('id', p.id, 'created_at', p.created_at, 'captured_at', p.captured_at,
      'creditsRemaining', p.credits_remaining, 'creditsTotal', p.credits_total),
    'timeline', case when t.id is null then null else to_jsonb(t) end, 'entries', entries);
end $$;

create function public.claim_chronosphere_max_attempt(p_user_id uuid, p_attempt_id uuid, p_allow_reserve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.chronosphere_max_attempts%rowtype;
  p public.chronosphere_credit_packs%rowtype;
  d public.chronosphere_pack_draws%rowtype;
  outcome jsonb;
begin
  select * into a from public.chronosphere_max_attempts where id = p_attempt_id and user_id = p_user_id;
  if not found then raise exception 'max_access_denied'; end if;
  select * into p from public.chronosphere_credit_packs where id = a.pack_id and user_id = p_user_id and product_type = 'max3' for update;
  if not found then raise exception 'max_access_denied'; end if;
  select * into a from public.chronosphere_max_attempts where id = p_attempt_id and user_id = p_user_id for update;
  select * into d from public.chronosphere_pack_draws where id = a.draw_id;
  if not p_allow_reserve and (d.id is null or d.status = 'failed') then
    return jsonb_build_object('allowed', false, 'reason', 'expired');
  end if;
  outcome := public.consume_chronosphere_pack_credit(p.pack_token_hash, a.request_hash);
  if outcome->>'allowed' = 'true' then
    update public.chronosphere_max_attempts set draw_id = (outcome->>'draw_id')::uuid where id = a.id;
  end if;
  return outcome;
end $$;

create function public.publish_chronosphere_max_attempt(
  p_user_id uuid, p_attempt_id uuid, p_snapshot jsonb, p_comparison jsonb,
  p_previous_entry_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.chronosphere_max_attempts%rowtype;
  p public.chronosphere_credit_packs%rowtype;
  d public.chronosphere_pack_draws%rowtype;
  t public.chronosphere_timelines%rowtype;
  e public.chronosphere_timeline_entries%rowtype;
  previous_id uuid;
  sequence integer;
begin
  select * into a from public.chronosphere_max_attempts where id = p_attempt_id and user_id = p_user_id;
  if not found then raise exception 'max_access_denied'; end if;
  select * into p from public.chronosphere_credit_packs where id = a.pack_id and user_id = p_user_id and product_type = 'max3' for update;
  if not found then raise exception 'max_access_denied'; end if;
  select * into a from public.chronosphere_max_attempts where id = p_attempt_id and user_id = p_user_id for update;
  select * into d from public.chronosphere_pack_draws where id = a.draw_id and pack_id = p.id for update;
  if not found or d.status <> 'completed' then raise exception 'max_result_not_ready'; end if;
  select * into t from public.chronosphere_timelines where max_pack_id = p.id and user_id = p_user_id;
  if not found then
    insert into public.chronosphere_timelines(user_id, max_pack_id, title, theme, memory_consent_at)
      values (p_user_id, p.id,
        left(coalesce(nullif(a.request_json->>'maxTimelineTitle', ''), d.result_json->>'theme'), 160),
        d.result_json->>'theme', now()) returning * into t;
  end if;
  select * into e from public.chronosphere_timeline_entries
    where timeline_id = t.id and source_draw_table = 'chronosphere_pack_draws' and source_draw_id = d.id;
  if not found then
    select min(n) into sequence from generate_series(1, 3) n where not exists (
      select 1 from public.chronosphere_timeline_entries where timeline_id = t.id and sequence_number = n
    );
    if sequence is null then raise exception 'max_timeline_full'; end if;
    select id into previous_id from public.chronosphere_timeline_entries
      where timeline_id = t.id and sequence_number < sequence order by sequence_number desc limit 1;
    if previous_id is distinct from p_previous_entry_id then raise exception 'max_memory_retry'; end if;
    if p_snapshot->'sourceDraw'->>'id' is distinct from d.id::text then raise exception 'max_snapshot_mismatch'; end if;
    insert into public.chronosphere_timeline_entries(timeline_id, user_id, source_draw_table, source_draw_id, sequence_number, read_at, snapshot_json, comparison_json)
      values (t.id, p_user_id, 'chronosphere_pack_draws', d.id, sequence,
        (d.result_json->>'createdAt')::timestamptz, p_snapshot, p_comparison) returning * into e;
  end if;
  update public.chronosphere_timelines set
    status = case when (select count(*) from public.chronosphere_timeline_entries where timeline_id = t.id) >= 3 then 'closed' else 'active' end,
    updated_at = now() where id = t.id;
  -- A replay must not overwrite a subsequently edited profile.
  if a.published_at is null then
    insert into public.mediumia_profiles(user_id, full_name, birth_date, birth_time, birth_place, updated_at)
      values (p_user_id, d.result_json->'profile'->>'fullName',
        (d.result_json->'profile'->>'birthDate')::date, (d.result_json->'profile'->>'birthTime')::time,
        d.result_json->'profile'->>'birthPlace', now())
      on conflict (user_id) do update set full_name = excluded.full_name, birth_date = excluded.birth_date,
        birth_time = excluded.birth_time, birth_place = excluded.birth_place, updated_at = excluded.updated_at;
  end if;
  update public.chronosphere_max_attempts set published_at = coalesce(published_at, now()) where id = a.id;
  return jsonb_build_object('timelineId', t.id, 'timelineTitle', t.title, 'sequenceNumber', e.sequence_number);
end $$;

revoke all on function public.begin_chronosphere_max_attempt(uuid, text, text, jsonb, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.read_chronosphere_max_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_chronosphere_max_attempt(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.publish_chronosphere_max_attempt(uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.begin_chronosphere_max_attempt(uuid, text, text, jsonb, uuid, text, boolean) to service_role;
grant execute on function public.read_chronosphere_max_attempt(uuid, uuid) to service_role;
grant execute on function public.claim_chronosphere_max_attempt(uuid, uuid, boolean) to service_role;
grant execute on function public.publish_chronosphere_max_attempt(uuid, uuid, jsonb, jsonb, uuid) to service_role;
commit;
