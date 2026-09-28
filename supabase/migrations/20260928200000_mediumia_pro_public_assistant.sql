-- MediumIA Pro — étape 2 : l'assistant répond aux visiteurs sur la fiche Réseau.
--
-- 1. Quota : 300 réponses par mois et par assistant (mois civil, heure de
--    Paris), plus une limite par visiteur (par heure et par jour) contre les abus.
--    Le visiteur n'est connu que par une empreinte HMAC calculée côté serveur :
--    aucune adresse IP n'est stockée, et ces empreintes sont effacées après 2 jours.
-- 2. Mise en ligne : seul le serveur (validation par l'administrateur dans le
--    Pilotage) passe public_enabled à true ; on garde la date et l'auteur.
--
-- Additif : aucune donnée existante n'est modifiée. Aucun message de visiteur
-- n'est enregistré en base. Tout est réservé au service_role.

create table if not exists public.pro_public_assistant_usage (
  agent_id uuid not null references public.agents(id) on delete cascade,
  scope text not null check (scope in ('agent_month', 'visitor_hour', 'visitor_day')),
  subject text not null check (subject = 'all' or subject ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  consumed_units integer not null default 0 check (consumed_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (agent_id, scope, subject, window_start)
);

create index if not exists pro_public_assistant_usage_cleanup_idx
  on public.pro_public_assistant_usage(scope, window_start);

alter table public.pro_public_assistant_usage enable row level security;
revoke all on table public.pro_public_assistant_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.pro_public_assistant_usage to service_role;

comment on table public.pro_public_assistant_usage is
  'Compteurs de l''assistant public des fiches Réseau. Aucune IP, aucun message : empreintes HMAC effacées après 2 jours.';

create or replace function public.consume_public_assistant_quota(
  p_agent_id uuid,
  p_visitor_hash text,
  p_monthly_limit integer,
  p_visitor_hourly_limit integer,
  p_visitor_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_month_used integer := 0;
  v_hour_used integer := 0;
  v_day_used integer := 0;
begin
  if p_agent_id is null
     or p_visitor_hash is null or p_visitor_hash !~ '^[0-9a-f]{64}$'
     or p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 100000
     or p_visitor_hourly_limit is null or p_visitor_hourly_limit < 1
     or p_visitor_daily_limit is null or p_visitor_daily_limit < p_visitor_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_quota_request');
  end if;

  perform 1 from public.agents where id = p_agent_id and status = 'active';
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'agent_unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public-assistant:' || p_agent_id::text, 0));

  -- Les empreintes de visiteurs ne servent qu'au jour même : on les efface vite.
  delete from public.pro_public_assistant_usage
  where scope in ('visitor_hour', 'visitor_day')
    and window_start < v_now - interval '2 days';

  select coalesce(sum(consumed_units), 0) into v_month_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'agent_month' and subject = 'all' and window_start = v_month_start;

  select coalesce(sum(consumed_units), 0) into v_hour_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'visitor_hour' and subject = p_visitor_hash and window_start = v_hour_start;

  select coalesce(sum(consumed_units), 0) into v_day_used
  from public.pro_public_assistant_usage
  where agent_id = p_agent_id and scope = 'visitor_day' and subject = p_visitor_hash and window_start = v_day_start;

  if v_month_used + 1 > p_monthly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'monthly', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;
  if v_hour_used + 1 > p_visitor_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'visitor_hourly', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;
  if v_day_used + 1 > p_visitor_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'visitor_daily', 'monthly_used', v_month_used, 'monthly_limit', p_monthly_limit);
  end if;

  insert into public.pro_public_assistant_usage (agent_id, scope, subject, window_start, consumed_units, updated_at)
  values
    (p_agent_id, 'agent_month', 'all', v_month_start, 1, v_now),
    (p_agent_id, 'visitor_hour', p_visitor_hash, v_hour_start, 1, v_now),
    (p_agent_id, 'visitor_day', p_visitor_hash, v_day_start, 1, v_now)
  on conflict (agent_id, scope, subject, window_start)
  do update set
    consumed_units = public.pro_public_assistant_usage.consumed_units + 1,
    updated_at = excluded.updated_at;

  return jsonb_build_object('allowed', true, 'monthly_used', v_month_used + 1, 'monthly_limit', p_monthly_limit);
end;
$$;

revoke all on function public.consume_public_assistant_quota(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_assistant_quota(uuid, text, integer, integer, integer)
  to service_role;

alter table public.agents
  add column if not exists public_enabled_at timestamptz,
  add column if not exists public_enabled_by uuid references auth.users(id) on delete set null;

-- Vérification après exécution (attendu : 1 table, 1 fonction, 2 colonnes) :
-- select count(*) from information_schema.tables
--   where table_schema = 'public' and table_name = 'pro_public_assistant_usage';
-- select count(*) from pg_proc where proname = 'consume_public_assistant_quota';
-- select count(*) from information_schema.columns
--   where table_schema = 'public' and table_name = 'agents'
--     and column_name in ('public_enabled_at', 'public_enabled_by');
