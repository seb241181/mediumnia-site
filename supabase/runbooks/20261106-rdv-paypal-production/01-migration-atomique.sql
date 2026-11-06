-- 01 — Migration Production ATOMIQUE (une seule transaction : tout ou rien).
-- Ordre imposé : la protection des rendez-vous AVANT l'ouverture du paiement intégral en
-- présentiel, pour qu'aucun paiement intégral ne puisse être capturé sans pouvoir devenir
-- un rendez-vous. Puis la fiabilité du paiement (ajouts uniquement).
-- Ne pas appliquer sans GO Production explicite. Lancer d'abord 00-controles-avant.sql.

-- ── 1/3 · Protection des rendez-vous (20261106140000) ─────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_mediumia_booking_reservation_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.booking_services;
  v_valid BOOLEAN := false;
BEGIN
  IF NEW.booking_source <> 'mediumia' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_service FROM public.booking_services WHERE id = NEW.service_id;
  IF FOUND
    AND v_service.booking_mode = 'instant'
    AND v_service.reservation_payment_kind = 'arrhes'
  THEN
    v_valid := NEW.booked_price_cents IS NOT DISTINCT FROM v_service.price_cents
      AND (
        NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.reservation_payment_cents
        OR NEW.reservation_payment_cents IS NOT DISTINCT FROM v_service.price_cents
      );
    IF NOT v_valid THEN
      RAISE EXCEPTION 'reservation_payment_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_mediumia_booking_reservation_payment() FROM PUBLIC, anon, authenticated;

-- ── 2/3 · Paiement intégral toutes modalités (20260923200000) ────────────────

CREATE OR REPLACE FUNCTION public.create_rdv_full_payment_hold(
  p_practitioner_id UUID,
  p_service_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_selected_modality TEXT,
  p_customer_first_name TEXT,
  p_customer_last_name TEXT,
  p_customer_email TEXT,
  p_customer_phone TEXT,
  p_customer_message TEXT,
  p_client_checkout_id UUID,
  p_paypal_env TEXT,
  p_terms_version TEXT,
  p_early_performance_requested BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_rdv_full_payment_hold(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
revoke execute on function public.create_rdv_full_payment_hold(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, uuid, text, text, boolean) from public, anon, authenticated;

-- ── 3/3 · Fiabilité du paiement PayPal (20261106120000, ajouts uniquement) ───

alter table public.rdv_paypal_payments
  add column if not exists capture_attempts integer not null default 0 check (capture_attempts >= 0);

create or replace function public.next_rdv_capture_attempt(p_paypal_order_id text)
returns integer
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.rdv_paypal_payments
     set capture_attempts = capture_attempts + 1, updated_at = now()
   where paypal_order_id = p_paypal_order_id
     and status = 'capturing'
     and paypal_capture_id is null
  returning capture_attempts;
$$;

create or replace function public.release_rdv_deposit_capture(p_paypal_order_id text, p_next text, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hold public.rdv_booking_holds;
  v_payment public.rdv_paypal_payments;
begin
  if p_next not in ('payment_pending', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invalid_next_status');
  end if;

  select h.* into v_hold
    from public.rdv_paypal_payments p
    join public.rdv_booking_holds h on h.id = p.hold_id
   where p.paypal_order_id = p_paypal_order_id
   for update of h, p;
  if not found then return jsonb_build_object('ok', false, 'error', 'payment_not_found'); end if;
  select * into v_payment from public.rdv_paypal_payments where hold_id = v_hold.id;

  if v_payment.paypal_capture_id is not null or v_payment.status = 'captured' then
    return jsonb_build_object('ok', false, 'error', 'payment_already_captured');
  end if;
  if v_hold.status <> 'payment_capturing' or v_payment.status <> 'capturing' then
    return jsonb_build_object('ok', false, 'error', 'not_capturing', 'hold_status', v_hold.status);
  end if;

  if p_next = 'payment_pending' then
    update public.rdv_booking_holds
       set status = 'payment_pending', expires_at = now() + interval '10 minutes', updated_at = now()
     where id = v_hold.id;
    update public.rdv_paypal_payments
       set status = 'order_pending', last_error_code = left(p_error_code, 80), updated_at = now()
     where id = v_payment.id;
  else
    update public.rdv_booking_holds
       set status = 'expired', updated_at = now()
     where id = v_hold.id;
    update public.rdv_paypal_payments
       set status = 'expired', last_error_code = left(p_error_code, 80), updated_at = now()
     where id = v_payment.id;
  end if;

  return jsonb_build_object('ok', true, 'hold_id', v_hold.id, 'status', p_next);
end;
$$;

create or replace function public.note_rdv_payment_error(p_paypal_order_id text, p_error_code text)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.rdv_paypal_payments
     set last_error_code = left(p_error_code, 80), updated_at = now()
   where paypal_order_id = p_paypal_order_id;
$$;

create or replace function public.supersede_rdv_own_pending_holds(
  p_practitioner_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_customer_email text,
  p_client_checkout_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;

create table if not exists public.rdv_checkout_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('server', 'client')),
  action text not null check (length(action) <= 40),
  error_code text not null check (length(error_code) <= 80),
  http_status integer,
  checkout_ref text check (checkout_ref is null or checkout_ref ~ '^[0-9a-f]{8}$'),
  practitioner_id uuid,
  slot_starts_at timestamptz,
  client_kind text check (client_kind is null or client_kind in ('mobile', 'desktop', 'in_app', 'unknown'))
);
create index if not exists rdv_checkout_events_created_idx on public.rdv_checkout_events (created_at desc);
create unique index if not exists rdv_checkout_events_client_once_idx
  on public.rdv_checkout_events (checkout_ref, error_code)
  where source = 'client';

alter table public.rdv_checkout_events enable row level security;
revoke all on public.rdv_checkout_events from public, anon, authenticated;
grant select, insert, delete on public.rdv_checkout_events to service_role;

revoke all on function public.next_rdv_capture_attempt(text) from public, anon, authenticated;
revoke all on function public.release_rdv_deposit_capture(text, text, text) from public, anon, authenticated;
revoke all on function public.note_rdv_payment_error(text, text) from public, anon, authenticated;
revoke all on function public.supersede_rdv_own_pending_holds(uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.next_rdv_capture_attempt(text) to service_role;
grant execute on function public.release_rdv_deposit_capture(text, text, text) to service_role;
grant execute on function public.note_rdv_payment_error(text, text) to service_role;
grant execute on function public.supersede_rdv_own_pending_holds(uuid, timestamptz, timestamptz, text, uuid) to service_role;
