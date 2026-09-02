-- Paid draws for CHRONOSPHERE 999.
-- Stores payment audit trail + draw token hash + cached results.
-- No personal data (name, email, birth info) is stored here.
-- All operations use service_role only.

create table if not exists chronosphere_paid_draws (
  id uuid primary key default gen_random_uuid(),
  draw_token_hash text not null,
  paypal_order_id text not null,
  paypal_capture_id text not null,
  paypal_env text not null default 'sandbox',
  amount_cents integer not null,
  currency text not null default 'EUR',
  status text not null default 'ready'
    check (status in ('ready', 'processing', 'completed')),
  consent_version text not null,
  consent_accepted_at timestamptz not null,
  request_hash text,
  result_json jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  captured_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,

  constraint chronosphere_paid_draws_token_hash_key unique (draw_token_hash),
  constraint chronosphere_paid_draws_order_key unique (paypal_order_id),
  constraint chronosphere_paid_draws_capture_key unique (paypal_capture_id)
);

alter table chronosphere_paid_draws enable row level security;

-- Atomic draw-token consumption.
-- Returns { allowed, cached, draw_id, result_json, reason }.
-- SELECT … FOR UPDATE prevents two concurrent requests from both
-- transitioning the same row out of 'ready'.
create or replace function consume_chronosphere_draw_token(
  p_token_hash text,
  p_request_hash text,
  p_processing_ttl_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draw record;
  v_now timestamptz := now();
begin
  select * into v_draw
  from chronosphere_paid_draws
  where draw_token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_token');
  end if;

  if v_draw.status = 'completed' and v_draw.request_hash = p_request_hash then
    return jsonb_build_object(
      'allowed', true,
      'cached', true,
      'draw_id', v_draw.id,
      'result_json', v_draw.result_json
    );
  end if;

  if v_draw.status = 'completed' then
    return jsonb_build_object('allowed', false, 'reason', 'already_consumed');
  end if;

  if v_draw.status = 'processing'
     and v_draw.processing_started_at > v_now - make_interval(secs => p_processing_ttl_seconds) then
    return jsonb_build_object('allowed', false, 'reason', 'in_progress');
  end if;

  update chronosphere_paid_draws
  set status = 'processing',
      request_hash = p_request_hash,
      processing_started_at = v_now
  where id = v_draw.id;

  return jsonb_build_object('allowed', true, 'cached', false, 'draw_id', v_draw.id);
end;
$$;

-- Mark a draw as completed and store the cached result.
create or replace function complete_chronosphere_draw(
  p_draw_id uuid,
  p_result_json jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update chronosphere_paid_draws
  set status = 'completed',
      result_json = p_result_json,
      completed_at = now(),
      failure_code = null
  where id = p_draw_id
    and status = 'processing';

  return found;
end;
$$;
