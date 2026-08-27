-- oracle_rate_limits : compteurs anti-abus par IP pseudonymisée (HMAC-SHA256).
-- Aucune IP brute n'est stockée. Seul service_role y accède.

create table public.oracle_rate_limits (
  ip_hash text not null,
  window_type text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint oracle_rate_limits_pkey
    primary key (ip_hash, window_type, window_start),
  constraint oracle_rate_limits_window_type_check
    check (window_type in ('hour', 'day')),
  constraint oracle_rate_limits_ip_hash_format_check
    check (ip_hash ~ '^[0-9a-f]{64}$')
);

alter table public.oracle_rate_limits enable row level security;

revoke all on table public.oracle_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.oracle_rate_limits to service_role;

-- consume_oracle_rate_limit : incrément atomique + vérification des limites.
-- Nettoie opportunément les compteurs > 48 h.
-- Retourne { "allowed": true } ou { "allowed": false, "reason": "hourly"|"daily" }.
create or replace function public.consume_oracle_rate_limit(
  p_ip_hash text,
  p_hourly_limit integer default 10,
  p_daily_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now);
  v_hour_count integer;
  v_day_count integer;
begin
  -- Nettoyage opportuniste des compteurs périmés (> 48 h)
  delete from public.oracle_rate_limits
  where updated_at < v_now - interval '48 hours';

  -- Upsert atomique : fenêtre horaire
  insert into public.oracle_rate_limits (ip_hash, window_type, window_start, request_count, updated_at)
  values (p_ip_hash, 'hour', v_hour_start, 1, v_now)
  on conflict (ip_hash, window_type, window_start)
  do update set
    request_count = oracle_rate_limits.request_count + 1,
    updated_at = v_now
  returning request_count into v_hour_count;

  if v_hour_count > p_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'hourly');
  end if;

  -- Upsert atomique : fenêtre journalière
  insert into public.oracle_rate_limits (ip_hash, window_type, window_start, request_count, updated_at)
  values (p_ip_hash, 'day', v_day_start, 1, v_now)
  on conflict (ip_hash, window_type, window_start)
  do update set
    request_count = oracle_rate_limits.request_count + 1,
    updated_at = v_now
  returning request_count into v_day_count;

  if v_day_count > p_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'daily');
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

revoke execute on function public.consume_oracle_rate_limit from public, anon, authenticated;
grant execute on function public.consume_oracle_rate_limit to service_role;
