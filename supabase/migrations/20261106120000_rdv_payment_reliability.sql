-- Fiabilité du paiement PayPal des rendez-vous (arrhes et règlement intégral).
-- Additif : aucune fonction existante n'est modifiée.
--
-- 1. Un refus PayPal certain (carte refusée…) remet la réservation provisoire en
--    attente de paiement au lieu de la laisser « en capture » pour toujours.
-- 2. Une nouvelle tentative du même client sur le même créneau remplace sa
--    tentative précédente au lieu d'être refusée comme « créneau déjà réservé ».
-- 3. Les captures restées sans réponse sont rapprochées de PayPal (lecture seule
--    chez PayPal : jamais de nouvelle capture), puis converties ou libérées.
-- 4. Les échecs de paiement sont journalisés sans donnée personnelle.

alter table public.rdv_paypal_payments
  add column if not exists capture_attempts integer not null default 0 check (capture_attempts >= 0);

-- Numéro de la tentative de capture en cours : la clé d'idempotence PayPal en
-- dépend, pour qu'un nouvel essai après un refus ne rejoue pas le refus.
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

-- Sortie d'une capture dont PayPal a confirmé qu'elle n'a rien encaissé.
--   p_next = 'payment_pending' : le client peut payer autrement (10 minutes).
--   p_next = 'expired'         : abandon constaté, le créneau est libéré.
-- Refuse tout paiement qui porte un identifiant de capture : un paiement
-- encaissé n'est jamais libéré.
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

-- Trace l'erreur d'un paiement sans changer son état (capture incertaine…).
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

-- Nouvelle tentative du même client (même e-mail) sur un créneau qu'il tient
-- déjà : ses réservations provisoires encore en attente de paiement sont
-- remplacées. Une tentative déjà en capture ou encaissée n'est jamais touchée,
-- et son ancienne commande PayPal ne peut plus être capturée (hold expiré).
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

-- Journal des échecs du parcours de paiement : aucune donnée personnelle
-- (ni nom, ni e-mail, ni identifiant PayPal complet), conservation 180 jours.
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
-- Un navigateur ne peut signaler qu'une fois chaque erreur d'un même paiement.
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
