-- MediumIA — rattrapage de la base TEST — B2-20 et B2-30 : objets hors dépôt et alignement des 29 fonctions sur la Production
-- Projet : MediumIA RDV PayPal Test (wnbwhnqiulsdjcvkuwos) UNIQUEMENT.
-- Fichier généré par generer.py (ne pas modifier à la main).
-- Tout ou rien : en cas d'erreur, rien n'est conservé. Refusé sur la Production,
-- refusé s'il a déjà été exécuté ou si l'étape précédente manque.
-- Inscrit dans l'historique : b2_20_objets_hors_depot, b2_30_alignement_fonctions.
begin;

do $garde$
begin
  if exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     or not exists (select 1 from public.booking_practitioners where slug = 'seb-test') then
    raise exception 'ARRET : cette base n''est pas TEST (wnbwhnqiulsdjcvkuwos). Rien n''a été modifié.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where name in ('b2_20_objets_hors_depot', 'b2_30_alignement_fonctions')) then
    raise exception 'ARRET : ce fichier a déjà été exécuté sur TEST. Rien n''a été modifié.';
  end if;
  if (select count(distinct name) from supabase_migrations.schema_migrations where name in ('b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents', 'b2_10_bloc2_pro_workspace_shadow_fk_indexes', 'b2_10_bloc3_document_shadow_a_rdv_appointment_reminder')) <> 3 then
    raise exception 'ARRET : une étape précédente manque. Rien n''a été modifié.';
  end if;
end $garde$;

-- >>> runbooks/20261108-environment-separation/test-rattrapage/20-objets-hors-depot.sql
-- TEST UNIQUEMENT. Étape B2-20 : objets présents en Production mais absents des migrations du dépôt.
-- Structure seule, aucune donnée. Fonctions = définitions exactes de Production (08/11/2026).
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

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200200', 'b2_20_objets_hors_depot', 'rattrapage-test');

-- >>> runbooks/20261108-environment-separation/test-rattrapage/30-alignement-fonctions.sql
-- TEST UNIQUEMENT. Étape B2-30 : alignement des 29 fonctions qui diffèrent entre TEST et Production
-- sur la définition exacte de Production (08/11/2026). Les fonctions propres à TEST ne sont pas supprimées.
DO $$
BEGIN
  -- Garde : ce script ne s'exécute QUE sur la base TEST.
  IF EXISTS (SELECT 1 FROM public.booking_services WHERE id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c')
     OR NOT EXISTS (SELECT 1 FROM public.booking_practitioners WHERE slug = 'seb-test') THEN
    RAISE EXCEPTION 'pas_la_base_test : script refusé';
  END IF;
END $$;

-- claim_rdv_balance_auto_cancel(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_auto_cancel(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
  v_service public.booking_services;
  v_payment public.rdv_balance_payments;
  v_paid INTEGER;
  v_blocker TEXT;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = v_booking.service_id;
  IF NOT FOUND OR NOT ('video' = ANY(v_service.modality)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_video_only');
  END IF;

  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  IF v_booking.status <> 'confirmed'
     OR v_booking.booking_source <> 'mediumia'
     OR v_booking.starts_at <= p_now
     OR v_booking.starts_at > p_now + INTERVAL '48 hours'
     OR COALESCE(v_booking.booked_price_cents, 0) <= v_paid
     OR v_booking.balance_paid_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_due_for_balance_cancel');
  END IF;

  SELECT * INTO v_payment FROM public.rdv_balance_payments WHERE booking_id = v_booking.id FOR UPDATE;
  IF FOUND AND v_payment.status IN ('captured', 'capture_in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_payment_in_progress');
  END IF;

  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     AND v_booking.balance_cancel_claimed_at > p_now - INTERVAL '15 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  END IF;
  IF v_booking.balance_google_resync_claimed_at IS NOT NULL
     AND v_booking.balance_google_resync_claimed_at > p_now - INTERVAL '5 minutes'
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'google_resync_in_progress');
  END IF;

  v_blocker := public.rdv_balance_cancel_blocker(v_booking.id, p_now);
  IF v_blocker IS NOT NULL THEN
    IF v_booking.balance_review_reason IS DISTINCT FROM v_blocker THEN
      UPDATE public.bookings
      SET balance_review_reason = v_blocker, balance_review_flagged_at = p_now, updated_at = now()
      WHERE id = v_booking.id;
      INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
      VALUES (v_booking.id, 'auto_cancel_blocked', jsonb_build_object('reason', v_blocker, 'at', p_now));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_blocked', 'reason', v_blocker);
  END IF;

  -- Repère durable posé AVANT la suppression Google : si le traitement
  -- s'interrompt, l'événement sera remis (rdv_balance_google_resync).
  UPDATE public.bookings
  SET balance_cancel_claimed_at = p_now,
      balance_google_resync_at = COALESCE(balance_google_resync_at, p_now),
      updated_at = now()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_auto_cancel(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_auto_cancel(uuid,timestamp with time zone) TO service_role;

-- claim_rdv_balance_google_resync(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_google_resync(p_booking_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.balance_google_resync_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_needed');
  END IF;
  -- Annulée entre-temps : la suppression de l'événement est voulue.
  IF v_booking.status <> 'confirmed' THEN
    UPDATE public.bookings
    SET balance_google_resync_at = NULL, balance_google_resync_claimed_at = NULL,
        balance_google_resync_review_at = NULL, updated_at = now()
    WHERE id = v_booking.id;
    RETURN jsonb_build_object('ok', false, 'error', 'not_needed');
  END IF;
  -- Rendez-vous déjà commencé : jamais d'écriture Google sur un créneau
  -- passé ; le repère est CONSERVÉ et devient un incident à traiter.
  IF v_booking.starts_at <= p_now THEN
    UPDATE public.bookings
    SET balance_google_resync_review_at = COALESCE(balance_google_resync_review_at, p_now),
        balance_google_resync_error = 'appointment_started',
        balance_google_resync_claimed_at = NULL,
        updated_at = now()
    WHERE id = v_booking.id;
    IF v_booking.balance_google_resync_review_at IS NULL THEN
      INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
      VALUES (v_booking.id, 'google_resync_overdue', jsonb_build_object('since', v_booking.balance_google_resync_at, 'starts_at', v_booking.starts_at));
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_started',
                              'first', v_booking.balance_google_resync_review_at IS NULL);
  END IF;
  -- Examen manuel : seul le propriétaire relance (reopen_rdv_balance_google_resync).
  IF v_booking.balance_google_resync_review_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_review');
  END IF;
  IF v_booking.balance_cancel_claimed_at IS NOT NULL
     AND v_booking.balance_cancel_claimed_at > p_now - INTERVAL '30 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cancel_in_progress');
  END IF;
  IF v_booking.balance_google_resync_claimed_at IS NOT NULL
     AND v_booking.balance_google_resync_claimed_at > p_now - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'resync_in_progress');
  END IF;
  UPDATE public.bookings
  SET balance_google_resync_claimed_at = p_now, updated_at = now()
  WHERE id = v_booking.id;
  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking.id,
                            'google_event_id', v_booking.google_event_id,
                            'since', v_booking.balance_google_resync_at,
                            'starts_at', v_booking.starts_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_google_resync(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_google_resync(uuid,timestamp with time zone) TO service_role;

-- claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.claim_rdv_balance_reminder(p_booking_id uuid, p_token_hash text, p_token_expires_at timestamp with time zone, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count BIGINT := 0;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 OR p_token_expires_at <= p_now THEN
    RETURN false;
  END IF;

  UPDATE public.bookings
  SET balance_payment_token_hash = p_token_hash,
      balance_payment_token_expires_at = p_token_expires_at,
      balance_reminder_claimed_at = p_now,
      updated_at = now()
  WHERE id = p_booking_id
    AND status = 'confirmed'
    AND booking_source = 'mediumia'
    AND balance_reminder_sent_at IS NULL
    AND (
      balance_reminder_claimed_at IS NULL
      OR balance_reminder_claimed_at <= p_now - INTERVAL '15 minutes'
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_balance_reminder(uuid,text,timestamp with time zone,timestamp with time zone) TO service_role;

-- claim_rdv_deposit_capture(text)
CREATE OR REPLACE FUNCTION public.claim_rdv_deposit_capture(p_paypal_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hold public.rdv_booking_holds;
  v_payment public.rdv_paypal_payments;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_conflict BOOLEAN;
  v_active_count INTEGER;
BEGIN
  SELECT h.* INTO v_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found'); END IF;

  SELECT * INTO v_payment FROM public.rdv_paypal_payments WHERE hold_id = v_hold.id;
  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

  IF v_hold.status = 'converted' THEN
    RETURN jsonb_build_object('ok', true, 'converted', true, 'booking_id', v_hold.converted_booking_id);
  END IF;
  IF v_hold.status = 'payment_captured' THEN
    RETURN jsonb_build_object('ok', true, 'captured', true, 'hold_id', v_hold.id);
  END IF;
  IF v_hold.status = 'payment_capturing' AND v_hold.expires_at > now() THEN
    RETURN jsonb_build_object('ok', true, 'capturing', true, 'hold_id', v_hold.id);
  END IF;
  IF v_hold.status NOT IN ('payment_pending', 'payment_capturing') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_not_capturable');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners WHERE id = v_hold.practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    IF v_hold.status = 'payment_capturing' OR v_payment.paypal_capture_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
    END IF;
    UPDATE public.rdv_booking_holds SET status = 'expired' WHERE id = v_hold.id;
    UPDATE public.rdv_paypal_payments SET status = 'expired', last_error_code = 'slot_unavailable' WHERE id = v_payment.id;
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT starts_at FROM public.bookings
      WHERE practitioner_id = v_hold.practitioner_id
        AND status = 'confirmed'
        AND starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT starts_at FROM public.rdv_booking_holds h
      WHERE practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (status IN ('payment_capturing', 'payment_captured') OR (status = 'payment_pending' AND expires_at > now()))
        AND starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      IF v_hold.status = 'payment_capturing' OR v_payment.paypal_capture_id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'paid_slot_reconciliation_required');
      END IF;
      UPDATE public.rdv_booking_holds SET status = 'expired' WHERE id = v_hold.id;
      UPDATE public.rdv_paypal_payments SET status = 'expired', last_error_code = 'daily_limit_reached' WHERE id = v_payment.id;
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  UPDATE public.rdv_booking_holds
  SET status = 'payment_capturing', expires_at = now() + INTERVAL '5 minutes'
  WHERE id = v_hold.id;
  UPDATE public.rdv_paypal_payments SET status = 'capturing' WHERE id = v_payment.id;

  RETURN jsonb_build_object('ok', true, 'hold_id', v_hold.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_rdv_deposit_capture(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rdv_deposit_capture(text) TO service_role;

-- complete_rdv_balance_google_resync(uuid,text,text)
CREATE OR REPLACE FUNCTION public.complete_rdv_balance_google_resync(p_booking_id uuid, p_google_status text, p_google_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  IF v_booking.balance_google_resync_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'replay', true); END IF;
  -- Une nouvelle annulation a commencé entre-temps : le repère lui appartient.
  IF v_booking.balance_cancel_claimed_at IS NOT NULL OR v_booking.status <> 'confirmed' THEN
    UPDATE public.bookings SET balance_google_resync_claimed_at = NULL, updated_at = now() WHERE id = v_booking.id;
    RETURN jsonb_build_object('ok', false, 'error', 'superseded');
  END IF;
  UPDATE public.bookings
  SET balance_google_resync_at = NULL,
      balance_google_resync_claimed_at = NULL,
      balance_google_resync_error = NULL,
      balance_google_resync_review_at = NULL,
      google_event_id = COALESCE(p_google_event_id, google_event_id),
      updated_at = now()
  WHERE id = v_booking.id;
  INSERT INTO public.rdv_balance_review_events(booking_id, event, detail)
  VALUES (v_booking.id, 'google_resynced', jsonb_build_object('google_status', left(p_google_status, 40), 'since', v_booking.balance_google_resync_at));
  RETURN jsonb_build_object('ok', true, 'replay', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_rdv_balance_google_resync(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_rdv_balance_google_resync(uuid,text,text) TO service_role;

-- consume_api_rate_limit(text,text,integer,integer)
CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(p_ip_hash text, p_endpoint text, p_hourly_limit integer DEFAULT 10, p_daily_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now);
  v_hour_count integer;
  v_day_count integer;
begin
  delete from public.api_rate_limits
  where endpoint = p_endpoint
    and updated_at < v_now - interval '48 hours';

  insert into public.api_rate_limits (ip_hash, endpoint, window_type, window_start, request_count, updated_at)
  values (p_ip_hash, p_endpoint, 'hour', v_hour_start, 1, v_now)
  on conflict (ip_hash, endpoint, window_type, window_start)
  do update set
    request_count = api_rate_limits.request_count + 1,
    updated_at = v_now
  returning request_count into v_hour_count;

  if v_hour_count > p_hourly_limit then
    return jsonb_build_object('allowed', false, 'reason', 'hourly');
  end if;

  insert into public.api_rate_limits (ip_hash, endpoint, window_type, window_start, request_count, updated_at)
  values (p_ip_hash, p_endpoint, 'day', v_day_start, 1, v_now)
  on conflict (ip_hash, endpoint, window_type, window_start)
  do update set
    request_count = api_rate_limits.request_count + 1,
    updated_at = v_now
  returning request_count into v_day_count;

  if v_day_count > p_daily_limit then
    return jsonb_build_object('allowed', false, 'reason', 'daily');
  end if;

  return jsonb_build_object('allowed', true);
end;
$function$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text,text,integer,integer) TO service_role;

-- consume_oauth_state(text)
CREATE OR REPLACE FUNCTION public.consume_oauth_state(p_state text)
 RETURNS TABLE(practitioner_slug text, practitioner_id uuid, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  DELETE FROM public.oauth_states
  WHERE state = p_state AND expires_at > now()
  RETURNING oauth_states.practitioner_slug, oauth_states.practitioner_id, oauth_states.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_oauth_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state(text) TO service_role;

-- convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text)
CREATE OR REPLACE FUNCTION public.convert_rdv_deposit_hold(p_paypal_order_id text, p_paypal_capture_id text, p_captured_at timestamp with time zone, p_paypal_env text, p_amount_cents integer, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hold public.rdv_booking_holds;
  v_payment public.rdv_paypal_payments;
  v_service public.booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_conflict BOOLEAN;
  v_booking_id UUID;
  v_net INTEGER;
  v_vat INTEGER;
BEGIN
  SELECT h.* INTO v_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.paypal_order_id = p_paypal_order_id
  FOR UPDATE OF h, p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  SELECT * INTO v_payment
  FROM public.rdv_paypal_payments
  WHERE hold_id = v_hold.id;

  IF v_hold.status = 'converted' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'converted', true,
      'booking_id', v_hold.converted_booking_id
    );
  END IF;

  IF v_payment.paypal_env <> p_paypal_env
    OR v_payment.amount_cents <> p_amount_cents
    OR v_payment.currency <> p_currency
    OR v_hold.reservation_payment_cents <> p_amount_cents
    OR v_hold.currency <> p_currency
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
  END IF;

  IF v_payment.paypal_capture_id IS NOT NULL
    AND v_payment.paypal_capture_id <> p_paypal_capture_id
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'capture_id_mismatch');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_hold.practitioner_id::text));

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = v_hold.service_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_found');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = v_hold.practitioner_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.practitioner_id = v_hold.practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1
    FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = v_hold.practitioner_id
      AND h.id <> v_hold.id
      AND (
        h.status IN ('payment_capturing', 'payment_captured')
        OR (h.status = 'payment_pending' AND h.expires_at > now())
      )
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
          < (v_hold.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
          > (v_hold.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF NOT v_conflict AND v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count
    FROM (
      SELECT b.starts_at
      FROM public.bookings b
      WHERE b.practitioner_id = v_hold.practitioner_id
        AND b.status = 'confirmed'
        AND b.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND b.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT h.starts_at
      FROM public.rdv_booking_holds h
      WHERE h.practitioner_id = v_hold.practitioner_id
        AND h.id <> v_hold.id
        AND (
          h.status IN ('payment_capturing', 'payment_captured')
          OR (h.status = 'payment_pending' AND h.expires_at > now())
        )
        AND h.starts_at >= date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND h.starts_at < (date_trunc('day', v_hold.starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;

    IF v_active_count >= v_max_per_day THEN
      v_conflict := true;
    END IF;
  END IF;

  IF v_conflict THEN
    UPDATE public.rdv_booking_holds
    SET status = 'payment_captured', expires_at = NULL
    WHERE id = v_hold.id;

    UPDATE public.rdv_paypal_payments
    SET status = 'captured',
        paypal_capture_id = COALESCE(paypal_capture_id, p_paypal_capture_id),
        captured_at = COALESCE(captured_at, p_captured_at, now()),
        last_error_code = 'paid_slot_reconciliation_required'
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'paid_slot_reconciliation_required',
      'payment_captured', true
    );
  END IF;

  INSERT INTO public.bookings (
    practitioner_id,
    service_id,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    customer_message,
    starts_at,
    ends_at,
    timezone,
    status,
    booked_price_cents,
    reservation_payment_cents,
    booking_source
  ) VALUES (
    v_hold.practitioner_id,
    v_hold.service_id,
    v_hold.customer_first_name,
    v_hold.customer_last_name,
    v_hold.customer_email,
    v_hold.customer_phone,
    v_hold.customer_message,
    v_hold.starts_at,
    v_hold.ends_at,
    'Europe/Paris',
    'confirmed',
    v_hold.service_price_cents,
    v_hold.reservation_payment_cents,
    'mediumia'
  ) RETURNING id INTO v_booking_id;

  v_net := ROUND((p_amount_cents::NUMERIC * 10000) / (10000 + v_service.vat_rate_bps))::INTEGER;
  v_vat := p_amount_cents - v_net;

  INSERT INTO public.rdv_financial_entries (
    practitioner_id,
    booking_id,
    service_id,
    source,
    entry_kind,
    direction,
    payment_method,
    occurred_at,
    gross_cents,
    net_cents,
    vat_cents,
    vat_rate_bps,
    vat_status,
    currency,
    service_price_cents,
    appointment_starts_at,
    customer_name,
    customer_email,
    external_payment_ref,
    note
  ) VALUES (
    v_hold.practitioner_id,
    v_booking_id,
    v_hold.service_id,
    'mediumia',
    'arrhes',
    'income',
    'paypal',
    COALESCE(p_captured_at, now()),
    p_amount_cents,
    v_net,
    v_vat,
    v_service.vat_rate_bps,
    'taxable',
    p_currency,
    v_hold.service_price_cents,
    v_hold.starts_at,
    trim(v_hold.customer_first_name || ' ' || v_hold.customer_last_name),
    v_hold.customer_email,
    p_paypal_capture_id,
    'Arrhes de réservation MediumIA'
  );

  UPDATE public.rdv_booking_holds
  SET status = 'converted',
      converted_booking_id = v_booking_id,
      expires_at = NULL
  WHERE id = v_hold.id;

  UPDATE public.rdv_paypal_payments
  SET status = 'captured',
      paypal_capture_id = p_paypal_capture_id,
      captured_at = COALESCE(p_captured_at, now()),
      last_error_code = NULL
  WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'converted', false,
    'booking_id', v_booking_id,
    'service_price_cents', v_hold.service_price_cents,
    'reservation_payment_cents', v_hold.reservation_payment_cents
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_rdv_deposit_hold(text,text,timestamp with time zone,text,integer,text) TO service_role;

-- create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.create_booking(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text DEFAULT NULL::text, p_customer_message text DEFAULT NULL::text, p_timezone text DEFAULT 'Europe/Paris'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_buffer_before  INTEGER;
  v_buffer_after   INTEGER;
  v_max_per_day    INTEGER;
  v_conflict       BOOLEAN;
  v_count_today    INTEGER;
  v_booking_id     UUID;
  v_buffer_before_interval INTERVAL;
  v_buffer_after_interval  INTERVAL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT buffer_before_min, buffer_after_min, max_per_day
    INTO v_buffer_before, v_buffer_after, v_max_per_day
    FROM booking_practitioners
   WHERE id = p_practitioner_id;

  v_buffer_before_interval := (COALESCE(v_buffer_before, 0) || ' minutes')::INTERVAL;
  v_buffer_after_interval  := (COALESCE(v_buffer_after,  0) || ' minutes')::INTERVAL;

  SELECT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status          = 'confirmed'
      AND (b.starts_at - v_buffer_before_interval) < (p_ends_at   + v_buffer_after_interval)
      AND (b.ends_at   + v_buffer_after_interval)  > (p_starts_at - v_buffer_before_interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN json_build_object(
      'conflict', true,
      'error', 'Ce créneau est déjà réservé (buffer inclus). Choisissez un autre horaire.'
    );
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count_today
      FROM bookings b
     WHERE b.practitioner_id = p_practitioner_id
       AND b.status          = 'confirmed'
       AND b.starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
       AND b.starts_at <  date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
                        + INTERVAL '1 day';

    IF v_count_today >= v_max_per_day THEN
      RETURN json_build_object(
        'conflict', true,
        'error', 'Nombre maximum de rendez-vous atteint pour ce jour.'
      );
    END IF;
  END IF;

  INSERT INTO bookings (
    practitioner_id, service_id,
    starts_at, ends_at, timezone,
    customer_first_name, customer_last_name, customer_email,
    customer_phone, customer_message,
    status
  ) VALUES (
    p_practitioner_id, p_service_id,
    p_starts_at, p_ends_at, p_timezone,
    p_customer_first_name, p_customer_last_name, p_customer_email,
    p_customer_phone, p_customer_message,
    'confirmed'
  )
  RETURNING id INTO v_booking_id;

  RETURN json_build_object(
    'conflict',    false,
    'booking_id',  v_booking_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text) TO service_role;

-- create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.create_rdv_deposit_hold(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_selected_modality text, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text, p_customer_message text, p_client_checkout_id uuid, p_paypal_env text, p_terms_version text, p_early_performance_requested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_hold public.rdv_booking_holds;
  v_service public.booking_services;
  v_before INTEGER;
  v_after INTEGER;
  v_max_per_day INTEGER;
  v_active_count INTEGER;
  v_hold_id UUID;
  v_expires_at TIMESTAMPTZ := now() + INTERVAL '15 minutes';
  v_conflict BOOLEAN;
BEGIN
  IF p_paypal_env NOT IN ('sandbox', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_paypal_env');
  END IF;
  IF p_selected_modality NOT IN ('video', 'in-person') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality');
  END IF;
  IF p_terms_version IS NULL OR length(trim(p_terms_version)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'terms_required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  SELECT h.* INTO v_existing_hold
  FROM public.rdv_paypal_payments p
  JOIN public.rdv_booking_holds h ON h.id = p.hold_id
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE OF h, p;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'hold_id', v_existing_hold.id,
      'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at,
      'amount_cents', v_existing_hold.reservation_payment_cents,
      'service_price_cents', v_existing_hold.service_price_cents,
      'currency', v_existing_hold.currency
    );
  END IF;

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;

  IF NOT FOUND
    OR v_service.booking_mode <> 'instant'
    OR v_service.reservation_payment_kind <> 'arrhes'
    OR v_service.reservation_payment_cents <= 0
    OR v_service.price_cents IS NULL
    OR v_service.reservation_payment_cents > v_service.price_cents
    OR v_service.currency <> 'EUR'
    OR NOT (p_selected_modality = ANY(v_service.modality))
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;

  IF p_ends_at <> p_starts_at + make_interval(mins => v_service.duration_min) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_service_duration');
  END IF;

  SELECT buffer_before_min, buffer_after_min, max_per_day
  INTO v_before, v_after, v_max_per_day
  FROM public.booking_practitioners
  WHERE id = p_practitioner_id;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.practitioner_id = p_practitioner_id
      AND b.status = 'confirmed'
      AND (b.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (b.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) OR EXISTS (
    SELECT 1 FROM public.rdv_booking_holds h
    WHERE h.practitioner_id = p_practitioner_id
      AND (h.status IN ('payment_capturing', 'payment_captured') OR (h.status = 'payment_pending' AND h.expires_at > now()))
      AND (h.starts_at - (COALESCE(v_before, 0) || ' minutes')::interval) < (p_ends_at + (COALESCE(v_after, 0) || ' minutes')::interval)
      AND (h.ends_at + (COALESCE(v_after, 0) || ' minutes')::interval) > (p_starts_at - (COALESCE(v_before, 0) || ' minutes')::interval)
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_unavailable');
  END IF;

  IF v_max_per_day IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM (
      SELECT starts_at FROM public.bookings
      WHERE practitioner_id = p_practitioner_id
        AND status = 'confirmed'
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
      UNION ALL
      SELECT starts_at FROM public.rdv_booking_holds
      WHERE practitioner_id = p_practitioner_id
        AND (status IN ('payment_capturing', 'payment_captured') OR (status = 'payment_pending' AND expires_at > now()))
        AND starts_at >= date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris'
        AND starts_at < (date_trunc('day', p_starts_at AT TIME ZONE 'Europe/Paris') + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris'
    ) active_slots;
    IF v_active_count >= v_max_per_day THEN
      RETURN jsonb_build_object('ok', false, 'error', 'daily_limit_reached');
    END IF;
  END IF;

  INSERT INTO public.rdv_booking_holds (
    practitioner_id, service_id, starts_at, ends_at, selected_modality,
    customer_first_name, customer_last_name, customer_email, customer_phone, customer_message,
    service_price_cents, reservation_payment_cents, currency, status, expires_at,
    terms_version, terms_accepted_at, early_performance_requested_at
  ) VALUES (
    p_practitioner_id, p_service_id, p_starts_at, p_ends_at, p_selected_modality,
    trim(p_customer_first_name), trim(p_customer_last_name), lower(trim(p_customer_email)), nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_message), ''),
    v_service.price_cents, v_service.reservation_payment_cents, v_service.currency, 'payment_pending', v_expires_at,
    trim(p_terms_version), now(), CASE WHEN p_early_performance_requested THEN now() ELSE NULL END
  ) RETURNING id INTO v_hold_id;

  INSERT INTO public.rdv_paypal_payments (
    hold_id, paypal_env, amount_cents, currency, client_checkout_id, status
  ) VALUES (
    v_hold_id, p_paypal_env, v_service.reservation_payment_cents, v_service.currency, p_client_checkout_id, 'order_pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'existing', false,
    'hold_id', v_hold_id,
    'status', 'payment_pending',
    'expires_at', v_expires_at,
    'amount_cents', v_service.reservation_payment_cents,
    'service_price_cents', v_service.price_cents,
    'currency', v_service.currency
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rdv_deposit_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) TO service_role;

-- create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.create_rdv_full_payment_hold(p_practitioner_id uuid, p_service_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_selected_modality text, p_customer_first_name text, p_customer_last_name text, p_customer_email text, p_customer_phone text, p_customer_message text, p_client_checkout_id uuid, p_paypal_env text, p_terms_version text, p_early_performance_requested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_service public.booking_services;
  v_hold_id UUID;
  v_existing_hold public.rdv_booking_holds;
  v_existing_payment public.rdv_paypal_payments;
BEGIN
  IF p_selected_modality NOT IN ('video', 'in-person') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_modality');
  END IF;

  SELECT * INTO v_service
  FROM public.booking_services
  WHERE id = p_service_id
    AND practitioner_id = p_practitioner_id
    AND is_active = true;

  IF NOT FOUND
    OR v_service.booking_mode <> 'instant'
    OR v_service.reservation_payment_kind <> 'arrhes'
    OR v_service.price_cents IS NULL
    OR v_service.price_cents <= 0
    OR v_service.currency <> 'EUR'
    OR NOT (p_selected_modality = ANY(v_service.modality))
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_not_payable_online');
  END IF;

  -- Sérialise création et retries pour un même praticien, comme le socle arrhes.
  PERFORM pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  -- Idempotence : si ce checkout existe déjà pour un paiement intégral identique,
  -- on renvoie simplement la même intention au lieu de tenter de changer son montant.
  SELECT p.* INTO v_existing_payment
  FROM public.rdv_paypal_payments p
  WHERE p.client_checkout_id = p_client_checkout_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO v_existing_hold
    FROM public.rdv_booking_holds
    WHERE id = v_existing_payment.hold_id
    FOR UPDATE;

    IF v_existing_hold.id IS NULL
      OR v_existing_hold.practitioner_id <> p_practitioner_id
      OR v_existing_hold.service_id <> p_service_id
      OR v_existing_hold.starts_at <> p_starts_at
      OR v_existing_hold.ends_at <> p_ends_at
      OR v_existing_hold.selected_modality <> p_selected_modality
      OR v_existing_payment.payment_option <> 'full'
      OR v_existing_hold.payment_choice <> 'full_payment'
      OR v_existing_payment.amount_cents <> v_service.price_cents
      OR v_existing_hold.reservation_payment_cents <> v_service.price_cents
      OR v_existing_hold.service_price_cents <> v_service.price_cents
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_choice_locked');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'existing', true,
      'hold_id', v_existing_hold.id,
      'status', v_existing_hold.status,
      'expires_at', v_existing_hold.expires_at,
      'amount_cents', v_existing_payment.amount_cents,
      'service_price_cents', v_existing_hold.service_price_cents,
      'currency', v_existing_hold.currency,
      'payment_choice', 'full_payment',
      'payment_option', 'full'
    );
  END IF;

  -- Nouveau checkout : réutilise les protections éprouvées du parcours arrhes,
  -- puis transforme l'intention en paiement intégral avant toute création PayPal.
  v_result := public.create_rdv_deposit_hold(
    p_practitioner_id,
    p_service_id,
    p_starts_at,
    p_ends_at,
    p_selected_modality,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_email,
    p_customer_phone,
    p_customer_message,
    p_client_checkout_id,
    p_paypal_env,
    p_terms_version,
    p_early_performance_requested
  );

  IF NOT COALESCE((v_result->>'ok')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_hold_id := NULLIF(v_result->>'hold_id', '')::UUID;
  IF v_hold_id IS NULL THEN
    RETURN v_result;
  END IF;

  UPDATE public.rdv_booking_holds
  SET reservation_payment_cents = v_service.price_cents,
      payment_choice = 'full_payment'
  WHERE id = v_hold_id;

  UPDATE public.rdv_paypal_payments
  SET amount_cents = v_service.price_cents,
      payment_option = 'full'
  WHERE hold_id = v_hold_id
    AND paypal_order_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_choice_locked');
  END IF;

  RETURN v_result || jsonb_build_object(
    'amount_cents', v_service.price_cents,
    'service_price_cents', v_service.price_cents,
    'payment_choice', 'full_payment',
    'payment_option', 'full'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_rdv_full_payment_hold(uuid,uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,text,text,uuid,text,text,boolean) TO service_role;

-- draw_conference_raffle(uuid)
CREATE OR REPLACE FUNCTION public.draw_conference_raffle(p_raffle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.draw_conference_raffle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_conference_raffle(uuid) TO service_role;

-- enter_conference_raffle(uuid,uuid)
CREATE OR REPLACE FUNCTION public.enter_conference_raffle(p_raffle_id uuid, p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.enter_conference_raffle(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enter_conference_raffle(uuid,uuid) TO service_role;

-- mediumia_find_user_id_by_email(text)
CREATE OR REPLACE FUNCTION public.mediumia_find_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT u.id
  FROM auth.users AS u
  WHERE lower(u.email) = lower(trim(p_email))
  ORDER BY u.created_at ASC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_find_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_find_user_id_by_email(text) TO service_role;

-- mediumia_grant_purchase_atomic(uuid,text,integer)
CREATE OR REPLACE FUNCTION public.mediumia_grant_purchase_atomic(p_user_id uuid, p_origin_ref text, p_duration_days integer DEFAULT 365)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.mediumia_entitlements%ROWTYPE;
  v_created public.mediumia_entitlements%ROWTYPE;
  v_start timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_origin_ref IS NULL OR length(trim(p_origin_ref)) < 8 THEN
    RETURN jsonb_build_object('status', 'invalid_input');
  END IF;

  IF p_duration_days < 1 OR p_duration_days > 3650 THEN
    RETURN jsonb_build_object('status', 'invalid_duration');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  SELECT * INTO v_existing
  FROM public.mediumia_entitlements
  WHERE type = 'purchase' AND origin_ref = trim(p_origin_ref)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at
    );
  END IF;

  INSERT INTO public.mediumia_students (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT GREATEST(
    now(),
    COALESCE(MAX(access_expires_at), now())
  ) INTO v_start
  FROM public.mediumia_entitlements
  WHERE user_id = p_user_id
    AND status = 'active'
    AND access_level = 'full'
    AND access_expires_at > now();

  BEGIN
    INSERT INTO public.mediumia_entitlements (
      user_id, type, origin_ref,
      access_started_at, access_expires_at, status
    ) VALUES (
      p_user_id,
      'purchase',
      trim(p_origin_ref),
      v_start,
      v_start + (p_duration_days || ' days')::interval,
      'active'
    )
    RETURNING * INTO v_created;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.mediumia_entitlements
    WHERE type = 'purchase' AND origin_ref = trim(p_origin_ref)
    LIMIT 1;

    RETURN jsonb_build_object(
      'status', 'already_granted',
      'entitlement_id', v_existing.id,
      'access_expires_at', v_existing.access_expires_at
    );
  END;

  RETURN jsonb_build_object(
    'status', 'granted',
    'entitlement_id', v_created.id,
    'access_expires_at', v_created.access_expires_at
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_grant_purchase_atomic(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_grant_purchase_atomic(uuid,text,integer) TO service_role;

-- mediumia_mark_pdf_download(text)
CREATE OR REPLACE FUNCTION public.mediumia_mark_pdf_download(p_token_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.mediumia_paypal_purchases
  set pdf_downloaded_at = now(),
      pdf_download_count = pdf_download_count + 1,
      updated_at = now()
  where pdf_download_token_hash = p_token_hash
    and status = 'provisioned'
    and pdf_download_expires_at > now();
end;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_mark_pdf_download(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_mark_pdf_download(text) TO service_role;

-- mediumia_next_license_number()
CREATE OR REPLACE FUNCTION public.mediumia_next_license_number()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select 'MID-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.mediumia_license_seq')::text, 6, '0');
$function$;
REVOKE ALL ON FUNCTION public.mediumia_next_license_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_next_license_number() TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_next_license_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_next_license_number() TO service_role;

-- mediumia_paypal_purchase_set_updated_at()
CREATE OR REPLACE FUNCTION public.mediumia_paypal_purchase_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_paypal_purchase_set_updated_at() TO service_role;

-- mediumia_pdf_token_is_valid(text)
CREATE OR REPLACE FUNCTION public.mediumia_pdf_token_is_valid(p_token_hash text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.mediumia_paypal_purchases p
    where p.pdf_download_token_hash = p_token_hash
      and p.status = 'provisioned'
      and p.user_id is not null
      and p.pdf_download_expires_at > now()
  );
$function$;
REVOKE ALL ON FUNCTION public.mediumia_pdf_token_is_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_pdf_token_is_valid(text) TO service_role;

-- mediumia_resolve_pdf_download(text)
CREATE OR REPLACE FUNCTION public.mediumia_resolve_pdf_download(p_token_hash text)
 RETURNS TABLE(purchase_id uuid, user_id uuid, display_name text, license_number text, expires_at timestamp with time zone, download_count integer, product_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    p.user_id,
    coalesce(nullif(s.display_name, ''), nullif(p.payer_name, '')),
    s.license_number,
    p.pdf_download_expires_at,
    p.pdf_download_count,
    p.product_code
  from public.mediumia_paypal_purchases p
  join public.mediumia_students s on s.user_id = p.user_id
  where p.pdf_download_token_hash = p_token_hash
    and p.status = 'provisioned'
    and p.pdf_download_expires_at > now()
  limit 1;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_resolve_pdf_download(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_resolve_pdf_download(text) TO service_role;

-- mediumia_set_updated_at()
CREATE OR REPLACE FUNCTION public.mediumia_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.mediumia_set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mediumia_set_updated_at() TO service_role;

-- rdv_amount_breakdown(integer,integer)
CREATE OR REPLACE FUNCTION public.rdv_amount_breakdown(p_gross_cents integer, p_vat_rate_bps integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
  v_net INTEGER;
  v_vat INTEGER;
BEGIN
  IF p_gross_cents <= 0 OR p_vat_rate_bps < 0 OR p_vat_rate_bps > 10000 THEN
    RAISE EXCEPTION 'invalid_amount_breakdown';
  END IF;
  v_net := ROUND((p_gross_cents::NUMERIC * 10000) / (10000 + p_vat_rate_bps))::INTEGER;
  v_vat := p_gross_cents - v_net;
  RETURN jsonb_build_object('gross_cents', p_gross_cents, 'net_cents', v_net, 'vat_cents', v_vat, 'vat_rate_bps', p_vat_rate_bps);
END;
$function$;
REVOKE ALL ON FUNCTION public.rdv_amount_breakdown(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rdv_amount_breakdown(integer,integer) TO service_role;

-- set_updated_at()
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ begin new.updated_at = now(); return new; end; $function$;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;

-- supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid)
CREATE OR REPLACE FUNCTION public.supersede_rdv_own_pending_holds(p_practitioner_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_customer_email text, p_client_checkout_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_before integer;
  v_after integer;
  v_ids uuid[];
begin
  if p_customer_email is null or length(trim(p_customer_email)) < 3 then return 0; end if;
  -- Même verrou que la création de réservation provisoire et la capture.
  perform pg_advisory_xact_lock(hashtext(p_practitioner_id::text));

  select buffer_before_min, buffer_after_min into v_before, v_after
    from public.booking_practitioners where id = p_practitioner_id;

  with mine as (
    select h.id
      from public.rdv_booking_holds h
      join public.rdv_paypal_payments p on p.hold_id = h.id
     where h.practitioner_id = p_practitioner_id
       and h.status = 'payment_pending'
       and lower(trim(h.customer_email)) = lower(trim(p_customer_email))
       and p.client_checkout_id is distinct from p_client_checkout_id
       and p.paypal_capture_id is null
       and p.status = 'order_pending'
       and (h.starts_at - (coalesce(v_before, 0) || ' minutes')::interval) < (p_ends_at + (coalesce(v_after, 0) || ' minutes')::interval)
       and (h.ends_at + (coalesce(v_after, 0) || ' minutes')::interval) > (p_starts_at - (coalesce(v_before, 0) || ' minutes')::interval)
     for update of h, p
  ), expired_holds as (
    update public.rdv_booking_holds h
       set status = 'expired', updated_at = now()
      from mine
     where h.id = mine.id
    returning h.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from expired_holds;

  update public.rdv_paypal_payments
     set status = 'expired', last_error_code = 'superseded_by_retry', updated_at = now()
   where hold_id = any(v_ids);

  return coalesce(array_length(v_ids, 1), 0);
end;
$function$;
REVOKE ALL ON FUNCTION public.supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_rdv_own_pending_holds(uuid,timestamp with time zone,timestamp with time zone,text,uuid) TO service_role;

-- sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.sync_student_state(p_expected_revision bigint, p_progression jsonb DEFAULT '{}'::jsonb, p_exercices jsonb DEFAULT '{}'::jsonb, p_journal jsonb DEFAULT '[]'::jsonb, p_chat jsonb DEFAULT '[]'::jsonb, p_prefs jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current  mediumia_student_state%ROWTYPE;
  v_new_rev  bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM mediumia_students WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'student_not_found';
  END IF;

  SELECT * INTO v_current
  FROM mediumia_student_state
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO mediumia_student_state
      (user_id, schema_version, progression, exercices, journal, chat, prefs, revision)
    VALUES
      (auth.uid(), 1, p_progression, p_exercices, p_journal, p_chat, p_prefs, 1);

    RETURN jsonb_build_object('status', 'created', 'revision', 1);
  END IF;

  IF v_current.revision != p_expected_revision THEN
    RETURN jsonb_build_object(
      'status',   'conflict',
      'revision', v_current.revision,
      'cloud',    jsonb_build_object(
        'progression', v_current.progression,
        'exercices',   v_current.exercices,
        'journal',     v_current.journal,
        'chat',        v_current.chat,
        'prefs',       v_current.prefs,
        'updated_at',  v_current.updated_at
      )
    );
  END IF;

  v_new_rev := v_current.revision + 1;

  UPDATE mediumia_student_state
  SET progression = p_progression,
      exercices   = p_exercices,
      journal     = p_journal,
      chat        = p_chat,
      prefs       = p_prefs,
      revision    = v_new_rev
  WHERE user_id = auth.uid();

  RETURN jsonb_build_object('status', 'ok', 'revision', v_new_rev);
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_state(bigint,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;

-- consume_oracle_rate_limit(text,integer,integer) (définition de Production, modifiée après sa migration du dépôt)
CREATE OR REPLACE FUNCTION public.consume_oracle_rate_limit(p_ip_hash text, p_hourly_limit integer DEFAULT 10, p_daily_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_hour_start timestamptz := date_trunc('hour', v_now);
  v_day_start timestamptz := date_trunc('day', v_now);
  v_hour_count integer;
  v_day_count integer;
begin
  delete from public.oracle_rate_limits
  where updated_at < v_now - interval '48 hours';

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
$function$;
REVOKE ALL ON FUNCTION public.consume_oracle_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oracle_rate_limit(text,integer,integer) TO service_role;

-- consume_public_assistant_quota(uuid,text,integer,integer,integer) (définition de Production, modifiée après sa migration du dépôt)
CREATE OR REPLACE FUNCTION public.consume_public_assistant_quota(p_agent_id uuid, p_visitor_hash text, p_monthly_limit integer, p_visitor_hourly_limit integer, p_visitor_daily_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.consume_public_assistant_quota(uuid,text,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_assistant_quota(uuid,text,integer,integer,integer) TO service_role;

-- pro_approve_document_version(uuid,uuid,uuid) (définition de Production, modifiée après sa migration du dépôt)
CREATE OR REPLACE FUNCTION public.pro_approve_document_version(p_version_id uuid, p_actor_user_id uuid, p_request_id uuid)
 RETURNS TABLE(document_id uuid, version_id uuid, approved_for_ai boolean, replayed boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_document_id uuid;
  v_workspace_id uuid;
  v_version public.pro_document_versions%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'request_id_required';
  end if;
  select v.document_id into v_document_id
  from public.pro_document_versions v
  where v.id = p_version_id;
  select d.workspace_id into v_workspace_id
  from public.pro_documents d
  where d.id = v_document_id
  for update;
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'document_version_not_found';
  end if;

  perform mediumia_private.pro_assert_workspace_actor(
    v_workspace_id,
    p_actor_user_id,
    array['owner', 'admin', 'editor']::text[]
  );

  select v.* into v_version
  from public.pro_document_versions v
  where v.id = p_version_id
  for update;

  if exists (
    select 1
    from public.pro_document_versions v
    where v.workspace_id = v_workspace_id
      and v.approval_request_id = p_request_id
      and v.id <> p_version_id
  ) then
    raise exception using errcode = 'P0001', message = 'request_id_conflict';
  end if;

  if v_version.approved_for_ai then
    return query select v_document_id, p_version_id, true, true;
    return;
  end if;
  if v_version.extraction_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'document_version_not_ready';
  end if;
  if v_version.published_at is not null then
    raise exception using errcode = 'P0001', message = 'published_version_immutable';
  end if;

  update public.pro_document_versions v
  set approved_for_ai = true,
      approved_at = now(),
      approved_by = p_actor_user_id,
      approval_origin = 'explicit',
      approval_request_id = p_request_id,
      state_revision = v.state_revision + 1
  where v.id = p_version_id;

  perform mediumia_private.pro_write_audit(
    v_workspace_id,
    'user',
    p_actor_user_id,
    'document_version_approved',
    'document_version',
    p_version_id,
    null,
    v_document_id,
    p_version_id,
    p_request_id,
    '{}'::jsonb
  );

  return query select v_document_id, p_version_id, true, false;
end;
$function$;
REVOKE ALL ON FUNCTION public.pro_approve_document_version(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_approve_document_version(uuid,uuid,uuid) TO service_role;

-- pro_reconcile_legacy_document(uuid,uuid) (définition de Production, modifiée après sa migration du dépôt)
CREATE OR REPLACE FUNCTION public.pro_reconcile_legacy_document(p_document_id uuid, p_request_id uuid)
 RETURNS TABLE(document_id uuid, version_id uuid, reconciliation_action text, replayed boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_legacy public.agent_documents%rowtype;
  v_document public.pro_documents%rowtype;
  v_version_id uuid;
  v_version_number integer;
  v_created_by uuid;
  v_sync_hash text;
  v_extraction_status text;
  v_ready boolean;
  v_approved boolean;
  v_queue_revision bigint;
  v_queue_last_request_id uuid;
begin
  if p_document_id is null or p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_reconciliation_request';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_document_id::text, 18641)
  );

  select d.* into v_document
  from public.pro_documents d
  where d.id = p_document_id
  for update;

  select d.* into v_legacy
  from public.agent_documents d
  where d.id = p_document_id
  for update;

  if v_legacy.id is null then
    if v_document.id is not null then
      update public.pro_documents d
      set lifecycle_status = 'deleting',
          ai_enabled = false,
          state_revision = d.state_revision + 1
      where d.id = p_document_id
        and d.lifecycle_status not in ('deleting', 'deleted');

      update public.pro_document_agent_access a
      set revoked_at = coalesce(a.revoked_at, now()),
          revoked_reason = coalesce(a.revoked_reason, 'legacy_document_missing')
      where a.workspace_id = v_document.workspace_id
        and a.document_id = p_document_id
        and a.revoked_at is null;

      insert into public.pro_document_storage_jobs(
        workspace_id,
        document_id,
        document_version_id,
        storage_bucket,
        storage_path,
        request_id
      )
      select
        v.workspace_id,
        v.document_id,
        v.id,
        v.storage_bucket,
        v.storage_path,
        p_request_id
      from public.pro_document_versions v
      where v.workspace_id = v_document.workspace_id
        and v.document_id = p_document_id
        and v.storage_bucket is not null
        and v.storage_path is not null
      on conflict (workspace_id, document_version_id, operation) do nothing;

      perform mediumia_private.pro_write_audit(
        v_document.workspace_id,
        'system',
        null,
        'legacy_document_missing',
        'document',
        p_document_id,
        null,
        p_document_id,
        v_document.current_version_id,
        p_request_id,
        '{}'::jsonb
      );
    end if;

    delete from public.pro_document_sync_queue q
    where q.document_id = p_document_id;

    return query select p_document_id, null::uuid, 'legacy_missing'::text, false;
    return;
  end if;

  select q.dirty_revision, q.last_request_id
    into v_queue_revision, v_queue_last_request_id
  from public.pro_document_sync_queue q
  where q.workspace_id = v_legacy.workspace_id
    and q.document_id = p_document_id;

  select case when exists (
    select 1
    from public.pro_workspace_members wm
    where wm.workspace_id = v_legacy.workspace_id
      and wm.user_id = v_legacy.owner_id
  ) then v_legacy.owner_id else null end
  into v_created_by;

  select md5(concat_ws(
    '|',
    v_legacy.workspace_id::text,
    v_legacy.agent_id::text,
    v_legacy.name,
    v_legacy.source_type,
    coalesce(v_legacy.storage_bucket, ''),
    coalesce(v_legacy.storage_path, ''),
    coalesce(v_legacy.mime_type, ''),
    coalesce(v_legacy.size_bytes::text, ''),
    v_legacy.status,
    v_legacy.approved_for_ai::text,
    v_legacy.sensitivity,
    coalesce((
      select string_agg(c.chunk_index::text || ':' || md5(c.content), ',' order by c.chunk_index)
      from public.agent_document_chunks c
      where c.document_id = v_legacy.id
        and c.agent_id = v_legacy.agent_id
        and c.owner_id = v_legacy.owner_id
    ), '')
  )) into v_sync_hash;

  if v_document.id is not null and v_document.legacy_sync_hash = v_sync_hash then
    delete from public.pro_document_sync_queue q
    where q.workspace_id = v_legacy.workspace_id
      and q.document_id = p_document_id
      and v_queue_revision is not null
      and q.dirty_revision = v_queue_revision;
    return query select p_document_id, v_document.current_version_id, 'already_synced'::text, true;
    return;
  end if;

  if v_document.id is not null then
    if v_queue_last_request_id = p_request_id then
      return query select
        p_document_id,
        v_document.current_version_id,
        'divergence'::text,
        true;
      return;
    end if;

    if exists (
      select 1
      from public.pro_audit_events a
      where a.workspace_id = v_legacy.workspace_id
        and a.request_id = p_request_id
    ) then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    insert into public.pro_document_sync_queue(
      workspace_id,
      document_id,
      dirty_revision,
      dirty_at,
      reason,
      attempts,
      next_attempt_at,
      locked_at,
      last_error_code,
      last_request_id
    ) values (
      v_legacy.workspace_id,
      p_document_id,
      1,
      now(),
      'legacy_shadow_divergence',
      1,
      now() + interval '30 seconds',
      null,
      'legacy_shadow_divergence',
      p_request_id
    )
    on conflict on constraint pro_document_sync_queue_pkey do update set
      attempts = public.pro_document_sync_queue.attempts + 1,
      next_attempt_at = now() + make_interval(
        secs => least(
          3600,
          30 * power(2, least(public.pro_document_sync_queue.attempts, 6))::integer
        )
      ),
      locked_at = null,
      last_error_code = 'legacy_shadow_divergence',
      last_request_id = p_request_id;

    perform mediumia_private.pro_write_audit(
      v_legacy.workspace_id,
      'system',
      null,
      'legacy_document_divergence',
      'document',
      p_document_id,
      v_legacy.agent_id,
      p_document_id,
      v_document.current_version_id,
      p_request_id,
      jsonb_build_object('queue_revision', coalesce(v_queue_revision, 1))
    );

    return query select
      p_document_id,
      v_document.current_version_id,
      'divergence'::text,
      false;
    return;
  end if;

  v_ready := v_legacy.status = 'ready';
  v_approved := v_ready and v_legacy.approved_for_ai;
  v_extraction_status := case v_legacy.status
    when 'ready' then 'ready'
    when 'error' then 'failed'
    when 'uploaded' then 'uploaded'
    when 'processing' then 'uploaded'
    when 'archived' then 'failed'
    else 'failed'
  end;

  insert into public.pro_documents(
    id,
    workspace_id,
    name,
    lifecycle_status,
    sensitivity,
    ai_enabled,
    created_by,
    legacy_sync_hash,
    legacy_synced_at,
    created_at,
    updated_at
  ) values (
    v_legacy.id,
    v_legacy.workspace_id,
    v_legacy.name,
    case when v_legacy.status = 'archived' then 'archived' else 'active' end,
    v_legacy.sensitivity,
    false,
    v_created_by,
    v_sync_hash,
    now(),
    v_legacy.created_at,
    v_legacy.updated_at
  );
  v_version_number := greatest(1, v_legacy.version);

  v_version_id := gen_random_uuid();
  insert into public.pro_document_versions(
    id,
    workspace_id,
    document_id,
    version_number,
    source_type,
    storage_bucket,
    storage_path,
    mime_type,
    size_bytes,
    extraction_status,
    extracted_at,
    approved_for_ai,
    approved_at,
    approved_by,
    approval_origin,
    published_at,
    publication_origin,
    error_code,
    metadata,
    created_by,
    created_at,
    updated_at
  ) values (
    v_version_id,
    v_legacy.workspace_id,
    v_legacy.id,
    v_version_number,
    v_legacy.source_type,
    v_legacy.storage_bucket,
    v_legacy.storage_path,
    v_legacy.mime_type,
    v_legacy.size_bytes,
    v_extraction_status,
    case when v_ready then coalesce(v_legacy.updated_at, now()) else null end,
    v_approved,
    case when v_approved then v_legacy.approved_at else null end,
    null,
    case when v_approved then 'legacy_state' else null end,
    null,
    null,
    v_legacy.error_message,
    coalesce(v_legacy.metadata, '{}'::jsonb)
      || jsonb_build_object('legacy_document_version', v_legacy.version),
    v_created_by,
    v_legacy.created_at,
    v_legacy.updated_at
  );

  insert into public.pro_document_chunks(
    workspace_id, document_id, document_version_id, chunk_index, content, created_at
  )
  select
    c.workspace_id,
    c.document_id,
    v_version_id,
    c.chunk_index,
    c.content,
    c.created_at
  from public.agent_document_chunks c
  where c.document_id = v_legacy.id
    and c.agent_id = v_legacy.agent_id
    and c.owner_id = v_legacy.owner_id
  order by c.chunk_index;

  insert into public.pro_document_agent_access(
    workspace_id,
    document_id,
    agent_id,
    grant_source,
    granted_by,
    granted_at
  ) values (
    v_legacy.workspace_id,
    v_legacy.id,
    v_legacy.agent_id,
    'legacy_backfill',
    null,
    now()
  )
  on conflict do nothing;

  if v_approved then
    update public.pro_document_versions v
    set published_at = now(),
        publication_origin = 'legacy_backfill',
        state_revision = v.state_revision + 1
    where v.id = v_version_id;

    update public.pro_documents d
    set current_version_id = v_version_id,
        ai_enabled = true,
        legacy_sync_hash = v_sync_hash,
        legacy_synced_at = now(),
        state_revision = d.state_revision + 1
    where d.id = p_document_id;
  else
    update public.pro_documents d
    set legacy_sync_hash = v_sync_hash,
        legacy_synced_at = now()
    where d.id = p_document_id;
  end if;

  perform mediumia_private.pro_write_audit(
    v_legacy.workspace_id,
    'system',
    null,
    'legacy_document_reconciled',
    'document',
    p_document_id,
    v_legacy.agent_id,
    p_document_id,
    v_version_id,
    p_request_id,
    jsonb_build_object(
      'version_number', v_version_number,
      'approval_origin', case when v_approved then 'legacy_state' else null end,
      'legacy_approved_at_present', v_legacy.approved_at is not null,
      'publication_origin', case when v_approved then 'legacy_backfill' else null end
    )
  );

  delete from public.pro_document_sync_queue q
  where q.workspace_id = v_legacy.workspace_id
    and q.document_id = p_document_id
    and v_queue_revision is not null
    and q.dirty_revision = v_queue_revision;

  return query select p_document_id, v_version_id, 'synchronized'::text, false;
end;
$function$;
REVOKE ALL ON FUNCTION public.pro_reconcile_legacy_document(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_reconcile_legacy_document(uuid,uuid) TO service_role;

insert into supabase_migrations.schema_migrations (version, name, created_by) values ('20261108200300', 'b2_30_alignement_fonctions', 'rattrapage-test');

commit;

select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
