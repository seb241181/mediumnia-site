-- CHRONOSPHERE 999: additive three-credit packs.
-- Historical chronosphere_paid_draws and its RPCs remain unchanged.
-- Tokens and email addresses are represented by hashes only.

create table if not exists chronosphere_credit_packs (
  id uuid primary key default gen_random_uuid(),
  pack_token_hash text not null unique,
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  paypal_env text not null check (paypal_env in ('sandbox', 'live')),
  amount_cents integer not null check (amount_cents in (100, 990)),
  currency text not null default 'EUR' check (currency = 'EUR'),
  credits_total integer not null default 3 check (credits_total = 3),
  credits_remaining integer not null default 0 check (credits_remaining between 0 and credits_total),
  status text not null default 'payment_pending' check (status in ('payment_pending', 'active', 'exhausted')),
  consent_version text not null,
  consent_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  constraint chronosphere_credit_packs_payment_state check (
    (status = 'payment_pending' and paypal_capture_id is null and captured_at is null and credits_remaining = 0)
    or (status = 'active' and paypal_capture_id is not null and captured_at is not null and credits_remaining between 1 and credits_total)
    or (status = 'exhausted' and paypal_capture_id is not null and captured_at is not null and credits_remaining = 0)
  )
);

create table if not exists chronosphere_pack_draws (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references chronosphere_credit_packs(id) on delete restrict,
  request_hash text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  result_json jsonb,
  failure_code text,
  processing_started_at timestamptz,
  processing_claim_id uuid,
  completed_at timestamptz,
  delivery_email_hash text,
  email_sent_at timestamptz,
  email_delivery_failure_code text,
  created_at timestamptz not null default now(),
  constraint chronosphere_pack_draws_request_key unique (pack_id, request_hash),
  constraint chronosphere_pack_draws_completion_state check (
    (status = 'processing' and processing_started_at is not null and processing_claim_id is not null and result_json is null)
    or (status = 'completed' and completed_at is not null and result_json is not null)
    or (status = 'failed' and failure_code is not null)
  )
);

create index if not exists chronosphere_pack_draws_pack_status_idx
  on chronosphere_pack_draws (pack_id, status);

alter table chronosphere_credit_packs enable row level security;
alter table chronosphere_pack_draws enable row level security;

-- The pack row is locked before the draw row in every credit-changing RPC.
-- This serializes all consumption and refund paths for one pack.
create or replace function consume_chronosphere_pack_credit(
  p_pack_token_hash text,
  p_request_hash text,
  p_processing_ttl_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack chronosphere_credit_packs%rowtype;
  v_draw chronosphere_pack_draws%rowtype;
  v_remaining integer;
  v_draw_exists boolean;
  v_claim_id uuid := gen_random_uuid();
begin
  select * into v_pack
  from chronosphere_credit_packs
  where pack_token_hash = p_pack_token_hash
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_token');
  end if;
  if v_pack.status = 'payment_pending' then
    return jsonb_build_object('allowed', false, 'reason', 'payment_pending');
  end if;

  select * into v_draw
  from chronosphere_pack_draws
  where pack_id = v_pack.id and request_hash = p_request_hash;
  v_draw_exists := found;

  if v_draw_exists and v_draw.status = 'completed' then
    return jsonb_build_object(
      'allowed', true,
      'cached', true,
      'draw_id', v_draw.id,
      'result_json', v_draw.result_json,
      'credits_remaining', v_pack.credits_remaining,
      'credits_total', v_pack.credits_total
    );
  end if;
  if v_draw_exists and v_draw.status = 'processing' then
    if v_draw.processing_started_at > now() - make_interval(secs => greatest(30, least(p_processing_ttl_seconds, 3600))) then
      return jsonb_build_object('allowed', false, 'reason', 'in_progress');
    end if;

    -- The original reservation already consumed one credit. A stale worker is
    -- replaced in place, with a new claim that prevents it from completing or
    -- refunding after this recovery succeeds.
    update chronosphere_pack_draws
    set processing_started_at = now(),
        processing_claim_id = v_claim_id
    where id = v_draw.id;
    return jsonb_build_object(
      'allowed', true,
      'cached', false,
      'recovered', true,
      'draw_id', v_draw.id,
      'claim_id', v_claim_id,
      'credits_remaining', v_pack.credits_remaining,
      'credits_total', v_pack.credits_total
    );
  end if;
  if v_pack.credits_remaining <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'no_credits');
  end if;

  v_remaining := v_pack.credits_remaining - 1;
  update chronosphere_credit_packs
  set credits_remaining = v_remaining,
      status = case when v_remaining = 0 then 'exhausted' else 'active' end
  where id = v_pack.id;

  if v_draw_exists then
    -- A failed attempt was already refunded. Retrying it reserves one credit again.
    update chronosphere_pack_draws
    set status = 'processing',
        result_json = null,
        failure_code = null,
        processing_started_at = now(),
        processing_claim_id = v_claim_id,
        completed_at = null,
        delivery_email_hash = null,
        email_sent_at = null,
        email_delivery_failure_code = null
    where id = v_draw.id;
  else
    insert into chronosphere_pack_draws (pack_id, request_hash, status, processing_started_at, processing_claim_id)
    values (v_pack.id, p_request_hash, 'processing', now(), v_claim_id)
    returning * into v_draw;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'cached', false,
    'draw_id', v_draw.id,
    'claim_id', v_claim_id,
    'credits_remaining', v_remaining,
    'credits_total', v_pack.credits_total
  );
end;
$$;

create or replace function complete_chronosphere_pack_draw(
  p_draw_id uuid,
  p_result_json jsonb,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draw chronosphere_pack_draws%rowtype;
begin
  select * into v_draw
  from chronosphere_pack_draws
  where id = p_draw_id
  for update;

  if not found then return false; end if;
  if v_draw.status = 'completed' then return v_draw.processing_claim_id = p_claim_id; end if;
  if v_draw.status <> 'processing' or v_draw.processing_claim_id <> p_claim_id then return false; end if;

  update chronosphere_pack_draws
  set status = 'completed',
      result_json = p_result_json,
      completed_at = now(),
      failure_code = null
  where id = p_draw_id;
  return true;
end;
$$;

create or replace function release_chronosphere_pack_credit(
  p_draw_id uuid,
  p_failure_code text,
  p_claim_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id uuid;
  v_pack chronosphere_credit_packs%rowtype;
  v_draw chronosphere_pack_draws%rowtype;
  v_remaining integer;
begin
  -- Read the owner first, then lock the pack before the draw to match consume.
  select pack_id into v_pack_id from chronosphere_pack_draws where id = p_draw_id;
  if not found then return jsonb_build_object('released', false, 'reason', 'draw_not_found'); end if;

  select * into v_pack from chronosphere_credit_packs where id = v_pack_id for update;
  select * into v_draw from chronosphere_pack_draws where id = p_draw_id for update;
  if v_draw.status <> 'processing' or v_draw.processing_claim_id <> p_claim_id then
    return jsonb_build_object('released', false, 'reason', 'draw_not_processing', 'credits_remaining', v_pack.credits_remaining);
  end if;

  v_remaining := least(v_pack.credits_total, v_pack.credits_remaining + 1);
  update chronosphere_pack_draws
  set status = 'failed',
      failure_code = left(coalesce(nullif(p_failure_code, ''), 'timeline_engine_failed'), 80),
      processing_started_at = null,
      processing_claim_id = null
  where id = v_draw.id;
  update chronosphere_credit_packs
  set credits_remaining = v_remaining,
      status = 'active'
  where id = v_pack.id;

  return jsonb_build_object('released', true, 'credits_remaining', v_remaining, 'credits_total', v_pack.credits_total);
end;
$$;

revoke execute on function consume_chronosphere_pack_credit(text, text, integer) from public, anon, authenticated;
revoke execute on function complete_chronosphere_pack_draw(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function release_chronosphere_pack_credit(uuid, text, uuid) from public, anon, authenticated;
grant execute on function consume_chronosphere_pack_credit(text, text, integer) to service_role;
grant execute on function complete_chronosphere_pack_draw(uuid, jsonb, uuid) to service_role;
grant execute on function release_chronosphere_pack_credit(uuid, text, uuid) to service_role;
