-- TEST UNIQUEMENT. Étape B2-20 : objets présents en Production mais absents des migrations du dépôt.
-- Structure seule, aucune donnée. Fonctions = définitions exactes de Production (08/11/2026).
BEGIN;
DO $$
BEGIN
  -- Garde : ce script ne s'exécute QUE sur la base TEST.
  IF EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     OR NOT EXISTS (SELECT 1 FROM public.booking_practitioners WHERE slug = 'seb-test') THEN
    RAISE EXCEPTION 'pas_la_base_test : script refusé';
  END IF;
END $$;

-- Tables absentes du dépôt (définitions relues en Production le 08/11/2026, structure seule, aucune donnée).
CREATE TABLE IF NOT EXISTS public.mediumia_access_codes_v2 (
  code_digest TEXT PRIMARY KEY,
  assigned_email_digest TEXT NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level = ANY (ARRAY['discovery'::text, 'full'::text])),
  duration_days INTEGER NOT NULL CHECK (duration_days >= 1 AND duration_days <= 365),
  max_module INTEGER NOT NULL CHECK (max_module >= 1 AND max_module <= 25),
  claimed_by UUID REFERENCES public.mediumia_students(user_id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mediumia_access_codes_v2_level_scope_check CHECK ((access_level = 'discovery' AND max_module = 1) OR (access_level = 'full' AND max_module = 25))
);
CREATE INDEX IF NOT EXISTS idx_mediumia_access_codes_v2_email ON public.mediumia_access_codes_v2 (assigned_email_digest);
CREATE TABLE IF NOT EXISTS public.mediumia_valid_codes (
  code_hash TEXT PRIMARY KEY,
  duration_days INTEGER NOT NULL DEFAULT 365,
  assigned_email_hash TEXT,
  claimed_by UUID REFERENCES public.mediumia_students(user_id)
);
CREATE TABLE IF NOT EXISTS public.oracle_timeline_follow_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  paypal_order_id TEXT NOT NULL UNIQUE,
  paypal_capture_id TEXT NOT NULL UNIQUE,
  paypal_env TEXT NOT NULL CHECK (paypal_env = ANY (ARRAY['sandbox'::text, 'live'::text])),
  product_code TEXT NOT NULL DEFAULT 'chronosphere-follow-90',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'exhausted'::text, 'cancelled'::text, 'refunded'::text])),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  max_returns INTEGER NOT NULL DEFAULT 2 CHECK (max_returns >= 1 AND max_returns <= 20),
  used_returns INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used_returns >= 0 AND used_returns <= max_returns)
);
CREATE INDEX IF NOT EXISTS oracle_timeline_follow_plans_active_idx ON public.oracle_timeline_follow_plans (status, expires_at);
ALTER TABLE public.mediumia_access_codes_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mediumia_valid_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oracle_timeline_follow_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mediumia_access_codes_v2, public.mediumia_valid_codes, public.oracle_timeline_follow_plans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mediumia_access_codes_v2, public.mediumia_valid_codes, public.oracle_timeline_follow_plans TO service_role;
-- Colonne présente en Production, absente du dépôt.
ALTER TABLE public.mediumia_students ADD COLUMN IF NOT EXISTS legacy_code_hash TEXT;

-- Fonctions absentes du dépôt
-- mediumia_available_upgrade_credit(uuid)
CREATE OR REPLACE FUNCTION public.mediumia_available_upgrade_credit(p_user_id uuid)
 RETURNS TABLE(discovery_purchase_id uuid, credit_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.upgrade_credit_cents
  from public.mediumia_paypal_purchases p
  where p.user_id = p_user_id
    and p.product_code = 'discovery'
    and p.paypal_env = 'live'
    and p.status = 'provisioned'
    and p.amount_cents = 2900
    and p.upgrade_credit_cents = 2900
    and p.upgrade_credit_redeemed_at is null
  order by p.provisioned_at asc
  limit 1;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_available_upgrade_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_available_upgrade_credit(uuid) TO service_role;

-- mediumia_claim_access_code(text)
CREATE OR REPLACE FUNCTION public.mediumia_claim_access_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_email        text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_code_clean   text := upper(trim(coalesce(p_code, '')));
  v_code_digest  text;
  v_email_digest text;
  v_code         public.mediumia_access_codes_v2%ROWTYPE;
  v_expires      timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  IF v_email = '' THEN
    RETURN jsonb_build_object('status', 'email_required');
  END IF;

  IF length(v_code_clean) < 8 OR length(v_code_clean) > 64 THEN
    RETURN jsonb_build_object('status', 'invalid_code');
  END IF;

  v_code_digest := encode(extensions.digest(v_code_clean, 'sha256'), 'hex');
  v_email_digest := encode(extensions.digest(v_email, 'sha256'), 'hex');

  SELECT * INTO v_code
  FROM public.mediumia_access_codes_v2
  WHERE code_digest = v_code_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_code');
  END IF;

  IF v_code.assigned_email_digest <> v_email_digest THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;

  IF v_code.claimed_by IS NOT NULL THEN
    IF v_code.claimed_by = v_uid THEN
      SELECT e.access_expires_at INTO v_expires
      FROM public.mediumia_entitlements e
      WHERE e.user_id = v_uid
        AND e.origin_ref = 'v2:' || v_code_digest
        AND e.status = 'active'
      ORDER BY e.created_at DESC
      LIMIT 1;

      RETURN jsonb_build_object(
        'status', 'already_claimed_by_you',
        'access_level', v_code.access_level,
        'max_module', v_code.max_module,
        'access_expires_at', v_expires
      );
    END IF;

    RETURN jsonb_build_object('status', 'already_claimed');
  END IF;

  INSERT INTO public.mediumia_students (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  v_expires := now() + make_interval(days => v_code.duration_days);

  UPDATE public.mediumia_access_codes_v2
  SET claimed_by = v_uid,
      claimed_at = now()
  WHERE code_digest = v_code_digest;

  INSERT INTO public.mediumia_entitlements (
    user_id,
    type,
    origin_ref,
    access_started_at,
    access_expires_at,
    status,
    access_level,
    max_module
  ) VALUES (
    v_uid,
    'purchase',
    'v2:' || v_code_digest,
    now(),
    v_expires,
    'active',
    v_code.access_level,
    v_code.max_module
  );

  RETURN jsonb_build_object(
    'status', 'claimed',
    'access_level', v_code.access_level,
    'max_module', v_code.max_module,
    'access_expires_at', v_expires
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_claim_access_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_claim_access_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_claim_access_code(text) TO service_role;

-- mediumia_claim_code_atomic(uuid,text,text)
CREATE OR REPLACE FUNCTION public.mediumia_claim_code_atomic(p_user_id uuid, p_code_hash text, p_email_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student mediumia_students%ROWTYPE;
  v_code    mediumia_valid_codes%ROWTYPE;
BEGIN
  -- 1. Verrouiller et lire la ligne du code
  SELECT * INTO v_code
  FROM mediumia_valid_codes
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_code');
  END IF;

  -- 2. Vérifier que le code n'est pas déjà revendiqué
  IF v_code.claimed_by IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_claimed');
  END IF;

  -- 3. Vérifier assigned_email_hash si le code est réservé
  IF v_code.assigned_email_hash IS NOT NULL
     AND v_code.assigned_email_hash != p_email_hash THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;

  -- 4. Créer la fiche élève si absente
  --    (utilisateur auth.users inscrit avant la migration MediumIA)
  INSERT INTO mediumia_students (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- 5. Verrouiller et lire la fiche élève
  SELECT * INTO v_student
  FROM mediumia_students
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'student_not_found');
  END IF;

  -- 6. Vérifier que cet utilisateur n'a pas déjà un code rattaché
  IF v_student.legacy_code_hash IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_has_code');
  END IF;

  -- 7. Rattacher le hash à l'utilisateur
  UPDATE mediumia_students
  SET legacy_code_hash = p_code_hash
  WHERE user_id = p_user_id;

  -- 8. Marquer le code comme revendiqué
  UPDATE mediumia_valid_codes
  SET claimed_by = p_user_id
  WHERE code_hash = p_code_hash;

  -- 9. Créer l'entitlement avec dates calculées par PostgreSQL
  INSERT INTO mediumia_entitlements (
    user_id, type, origin_ref,
    access_started_at, access_expires_at, status
  ) VALUES (
    p_user_id,
    'legacy_code',
    p_code_hash,
    now(),
    now() + (v_code.duration_days || ' days')::interval,
    'active'
  );

  RETURN jsonb_build_object('status', 'claimed');
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_claim_code_atomic(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_claim_code_atomic(uuid,text,text) TO service_role;

-- mediumia_grant_founder(text)
CREATE OR REPLACE FUNCTION public.mediumia_grant_founder(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid;
  v_ref text;
  v_row public.mediumia_entitlements%rowtype;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    return jsonb_build_object('status', 'user_not_found');
  end if;
  v_ref := 'founder:' || v_user::text;
  insert into public.mediumia_students (user_id) values (v_user) on conflict (user_id) do nothing;

  select * into v_row from public.mediumia_entitlements where type = 'admin' and origin_ref = v_ref limit 1;
  if found then
    return jsonb_build_object('status', 'already_founder', 'entitlement_id', v_row.id);
  end if;

  insert into public.mediumia_entitlements (user_id, type, origin_ref, access_started_at, access_expires_at, status, access_level, max_module)
  values (v_user, 'admin', v_ref, now(), timestamptz '2999-12-31 00:00:00+00', 'active', 'full', 25)
  returning * into v_row;
  return jsonb_build_object('status', 'founder_granted', 'entitlement_id', v_row.id);
end;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_grant_founder(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_grant_founder(text) TO service_role;

-- mediumia_grant_purchase_access_atomic(uuid,text,integer,text,integer)
CREATE OR REPLACE FUNCTION public.mediumia_grant_purchase_access_atomic(p_user_id uuid, p_origin_ref text, p_duration_days integer, p_access_level text, p_max_module integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.mediumia_entitlements%rowtype;
  v_created public.mediumia_entitlements%rowtype;
  v_start timestamptz := now();
begin
  if p_user_id is null or p_origin_ref is null or length(trim(p_origin_ref)) < 8 then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  if not (
    (p_access_level = 'discovery' and p_max_module = 1 and p_duration_days = 30)
    or
    (p_access_level = 'full' and p_max_module = 25 and p_duration_days = 365)
  ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('status', 'user_not_found');
  end if;

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
      p_access_level,
      p_max_module
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
$function$;
REVOKE ALL ON FUNCTION public.mediumia_grant_purchase_access_atomic(uuid,text,integer,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_grant_purchase_access_atomic(uuid,text,integer,text,integer) TO service_role;

-- mediumia_handle_new_user()
CREATE OR REPLACE FUNCTION public.mediumia_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO mediumia_students (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_handle_new_user() TO service_role;

-- mediumia_parcours_opening_transition(timestamp with time zone,boolean)
CREATE OR REPLACE FUNCTION public.mediumia_parcours_opening_transition(p_opening timestamp with time zone, p_execute boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb;
  v_count integer;
  v_unfounded integer;
begin
  if p_opening is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;

  with eligible as (
    select e.id,
           case
             when e.origin_ref ~ '^paypal:live:[A-Za-z0-9_-]+$' then 'formation-complete'
             when e.origin_ref ~ '^conference-pass:live:[A-Za-z0-9_-]+$' then 'pass-conference'
             else 'code-historique-annuel'
           end as categorie,
           e.access_expires_at as fin_actuelle,
           greatest(e.access_expires_at, p_opening + interval '12 months') as nouvelle_fin
    from public.mediumia_entitlements e
    where e.status = 'active'
      and e.access_started_at <= p_opening
      and e.access_expires_at < p_opening + interval '12 months'
      and (
        (e.type = 'purchase' and e.access_level = 'full' and e.max_module = 25
          and e.origin_ref ~ '^paypal:live:[A-Za-z0-9_-]+$')
        or (e.type = 'purchase' and e.access_level = 'full' and e.max_module = 25
          and e.origin_ref ~ '^conference-pass:live:[A-Za-z0-9_-]+$')
        or (e.type = 'legacy_code' and e.access_level = 'full' and e.max_module = 25
          and e.access_expires_at - e.access_started_at >= interval '365 days' - interval '1 hour')
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'categorie', categorie, 'fin_actuelle', fin_actuelle, 'nouvelle_fin', nouvelle_fin) order by categorie, fin_actuelle), '[]'::jsonb)
  into v_rows
  from eligible;

  -- Contrôle en lecture seule : achat historique repris à la main dont la
  -- titulaire n'a pas encore reçu le statut Fondatrice (attendu : 0).
  select count(*) into v_unfounded
  from public.mediumia_entitlements e
  where e.type = 'purchase' and e.status = 'active'
    and e.origin_ref ~ '^legacy-paypal:'
    and not exists (
      select 1 from public.mediumia_entitlements f
      where f.user_id = e.user_id and f.type = 'admin' and f.status = 'active'
        and f.origin_ref = 'founder:' || e.user_id::text
    );

  if not p_execute then
    return jsonb_build_object('status', 'dry_run', 'would_extend', jsonb_array_length(v_rows), 'coach_until_floor', p_opening + interval '12 months', 'rows', v_rows, 'achat_historique_sans_fondatrice', v_unfounded);
  end if;

  update public.mediumia_entitlements e
  set access_expires_at = greatest(e.access_expires_at, p_opening + interval '12 months'),
      updated_at = now()
  where e.id in (select (r->>'id')::uuid from jsonb_array_elements(v_rows) r);
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'executed', 'extended', v_count, 'coach_until_floor', p_opening + interval '12 months', 'rows', v_rows, 'achat_historique_sans_fondatrice', v_unfounded);
end;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_parcours_opening_transition(timestamp with time zone,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_parcours_opening_transition(timestamp with time zone,boolean) TO service_role;

-- oracle_consume_follow_return(uuid,text)
CREATE OR REPLACE FUNCTION public.oracle_consume_follow_return(p_line_id uuid, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.oracle_consume_follow_return(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oracle_consume_follow_return(uuid,text) TO service_role;

-- Compartiment de stockage privé présent en Production (préparation des conférences).
INSERT INTO storage.buckets (id, name, public) VALUES ('conference-preparation', 'conference-preparation', false)
ON CONFLICT (id) DO NOTHING;

-- Création automatique du profil élève à l'inscription (déclencheur de Production).
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.mediumia_handle_new_user();
COMMIT;
