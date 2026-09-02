create table if not exists public.oracle_timeline_follow_plans (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null unique,
  token_hash text not null unique,
  paypal_order_id text not null unique,
  paypal_capture_id text not null unique,
  paypal_env text not null check (paypal_env in ('sandbox','live')),
  product_code text not null default 'chronosphere-follow-90',
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EUR',
  status text not null default 'active' check (status in ('active','expired','exhausted','cancelled','refunded')),
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_returns integer not null default 2 check (max_returns between 1 and 20),
  used_returns integer not null default 0 check (used_returns >= 0 and used_returns <= max_returns),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oracle_timeline_follow_plans_active_idx
  on public.oracle_timeline_follow_plans (status, expires_at);

alter table public.oracle_timeline_follow_plans enable row level security;
revoke all on public.oracle_timeline_follow_plans from anon, authenticated;

create or replace function public.oracle_consume_follow_return(
  p_line_id uuid,
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.oracle_timeline_follow_plans%rowtype;
begin
  if p_line_id is null or p_token_hash is null or length(p_token_hash) <> 64 then
    return jsonb_build_object('status','invalid');
  end if;

  select * into v_plan
  from public.oracle_timeline_follow_plans
  where line_id = p_line_id and token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('status','not_found');
  end if;

  if v_plan.status <> 'active' then
    return jsonb_build_object(
      'status', v_plan.status,
      'remaining', greatest(v_plan.max_returns - v_plan.used_returns, 0),
      'expires_at', v_plan.expires_at
    );
  end if;

  if v_plan.expires_at <= now() then
    update public.oracle_timeline_follow_plans
      set status = 'expired', updated_at = now()
      where id = v_plan.id;
    return jsonb_build_object('status','expired','remaining',0,'expires_at',v_plan.expires_at);
  end if;

  if v_plan.used_returns >= v_plan.max_returns then
    update public.oracle_timeline_follow_plans
      set status = 'exhausted', updated_at = now()
      where id = v_plan.id;
    return jsonb_build_object('status','exhausted','remaining',0,'expires_at',v_plan.expires_at);
  end if;

  update public.oracle_timeline_follow_plans
    set used_returns = used_returns + 1,
        status = case when used_returns + 1 >= max_returns then 'exhausted' else 'active' end,
        updated_at = now()
    where id = v_plan.id
    returning * into v_plan;

  return jsonb_build_object(
    'status','consumed',
    'plan_status',v_plan.status,
    'used_returns',v_plan.used_returns,
    'max_returns',v_plan.max_returns,
    'remaining',greatest(v_plan.max_returns - v_plan.used_returns,0),
    'expires_at',v_plan.expires_at
  );
end;
$$;

revoke all on function public.oracle_consume_follow_return(uuid,text) from public, anon, authenticated;
grant execute on function public.oracle_consume_follow_return(uuid,text) to service_role;
