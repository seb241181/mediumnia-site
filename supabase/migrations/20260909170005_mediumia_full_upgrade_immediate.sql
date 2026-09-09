-- Un achat Full remplace immédiatement un accès Discovery actif.
-- Un Full actif reste renouvelé à la suite de sa date d'expiration actuelle.
create or replace function public.mediumia_grant_purchase_atomic(
  p_user_id uuid,
  p_origin_ref text,
  p_duration_days integer default 365
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.mediumia_entitlements%rowtype;
  v_created public.mediumia_entitlements%rowtype;
  v_start timestamptz;
begin
  if p_user_id is null or p_origin_ref is null or length(trim(p_origin_ref)) < 8 then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  if p_duration_days < 1 or p_duration_days > 3650 then
    return jsonb_build_object('status', 'invalid_duration');
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  -- Serialize grants for one student so two concurrent renewals cannot overlap.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_existing
  from public.mediumia_entitlements
  where type = 'purchase' and origin_ref = trim(p_origin_ref)
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at,
      'access_level', v_existing.access_level,
      'max_module', v_existing.max_module
    );
  end if;

  insert into public.mediumia_students (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Discovery never delays Full. Only a currently active Full is renewed.
  select greatest(now(), coalesce(max(access_expires_at), now())) into v_start
  from public.mediumia_entitlements
  where user_id = p_user_id
    and status = 'active'
    and access_level = 'full'
    and max_module = 25
    and access_expires_at > now();

  begin
    insert into public.mediumia_entitlements (
      user_id,
      type,
      origin_ref,
      access_started_at,
      access_expires_at,
      status,
      access_level,
      max_module
    ) values (
      p_user_id,
      'purchase',
      trim(p_origin_ref),
      v_start,
      v_start + make_interval(days => p_duration_days),
      'active',
      'full',
      25
    )
    returning * into v_created;
  exception when unique_violation then
    select * into v_existing
    from public.mediumia_entitlements
    where type = 'purchase' and origin_ref = trim(p_origin_ref)
    limit 1;

    return jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at,
      'access_level', v_existing.access_level,
      'max_module', v_existing.max_module
    );
  end;

  return jsonb_build_object(
    'status', 'granted',
    'entitlement_id', v_created.id,
    'access_expires_at', v_created.access_expires_at,
    'access_level', v_created.access_level,
    'max_module', v_created.max_module
  );
end;
$$;

revoke all on function public.mediumia_grant_purchase_atomic(uuid, text, integer) from public;
revoke all on function public.mediumia_grant_purchase_atomic(uuid, text, integer) from anon;
revoke all on function public.mediumia_grant_purchase_atomic(uuid, text, integer) from authenticated;
grant execute on function public.mediumia_grant_purchase_atomic(uuid, text, integer) to service_role;
