-- Pass MediumIA post-conference checkout foundation.
-- Additive only: extends the existing conference_passes table and keeps events in draft.

alter table public.conference_events
  add column if not exists pass_offer_enabled boolean not null default false,
  add column if not exists pass_offer_amount_cents integer check (pass_offer_amount_cents is null or pass_offer_amount_cents > 0),
  add column if not exists pass_offer_currency text not null default 'EUR' check (pass_offer_currency = 'EUR'),
  add column if not exists pass_offer_label text,
  add column if not exists pass_normal_amount_cents integer not null default 59700 check (pass_normal_amount_cents = 59700);

update public.conference_events
set pass_duration_hours = 720,
    updated_at = now()
where slug = 'premiere-conference-mediumia'
  and pass_duration_hours <> 720;

alter table public.conference_passes
  add column if not exists status text not null default 'issued',
  add column if not exists issued_at timestamptz not null default now(),
  add column if not exists opened_at timestamptz,
  add column if not exists reserved_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists paypal_order_id text,
  add column if not exists paypal_capture_id text,
  add column if not exists paypal_env text check (paypal_env in ('sandbox', 'live')),
  add column if not exists amount_cents integer check (amount_cents is null or amount_cents > 0),
  add column if not exists currency text check (currency is null or currency = 'EUR'),
  add column if not exists reference_id text,
  add column if not exists entitlement_id uuid references public.mediumia_entitlements(id) on delete set null,
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.conference_passes
  drop constraint if exists conference_passes_status_check;

alter table public.conference_passes
  add constraint conference_passes_status_check
  check (status in ('issued','opened','reserved','captured','redeemed','expired','released','failed'));

create unique index if not exists conference_passes_paypal_order_uq
  on public.conference_passes(paypal_order_id)
  where paypal_order_id is not null;

create unique index if not exists conference_passes_paypal_capture_uq
  on public.conference_passes(paypal_capture_id)
  where paypal_capture_id is not null;

create index if not exists conference_passes_status_expiry_idx
  on public.conference_passes(status, expires_at);

create table if not exists public.conference_pass_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.conference_events(id) on delete cascade,
  pass_id uuid references public.conference_passes(id) on delete set null,
  registration_id uuid references public.conference_registrations(id) on delete set null,
  event_name text not null check (event_name in (
    'pass_issued',
    'pass_opened',
    'offer_viewed',
    'checkout_started',
    'payment_completed',
    'pass_redeemed',
    'pass_expired'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.conference_pass_events enable row level security;
revoke all on public.conference_pass_events from public, anon, authenticated;
grant select, insert, update on public.conference_pass_events to service_role;

create index if not exists conference_pass_events_event_name_idx
  on public.conference_pass_events(event_id, event_name, created_at desc);

create or replace function public.validate_conference_pass(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass public.conference_passes%rowtype;
  v_event public.conference_events%rowtype;
  v_registration public.conference_registrations%rowtype;
begin
  if p_token_hash is null or length(trim(p_token_hash)) <> 64 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pass');
  end if;

  select * into v_pass
  from public.conference_passes
  where token_hash = lower(trim(p_token_hash))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pass');
  end if;

  select * into v_event from public.conference_events where id = v_pass.event_id;
  select * into v_registration from public.conference_registrations where id = v_pass.registration_id;

  if v_pass.redeemed_at is not null or v_pass.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  if v_pass.expires_at <= now() then
    update public.conference_passes
    set status = 'expired', updated_at = now()
    where id = v_pass.id and status <> 'expired' and paypal_capture_id is null;

    insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
    values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'pass_expired')
    on conflict do nothing;

    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_registration.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'registration_cancelled');
  end if;

  if v_pass.opened_at is null then
    update public.conference_passes
    set opened_at = now(), status = case when status = 'issued' then 'opened' else status end, updated_at = now()
    where id = v_pass.id;

    insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
    values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'pass_opened');
  end if;

  insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
  values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'offer_viewed');

  return jsonb_build_object(
    'ok', true,
    'passId', v_pass.id,
    'eventSlug', v_event.slug,
    'eventTitle', v_event.title,
    'eventStartsAt', v_event.starts_at,
    'expiresAt', v_pass.expires_at,
    'firstName', v_registration.first_name,
    'normalAmountCents', coalesce(v_event.pass_normal_amount_cents, 59700),
    'offerEnabled', coalesce(v_event.pass_offer_enabled, false),
    'offerAmountCents', v_event.pass_offer_amount_cents,
    'currency', coalesce(v_event.pass_offer_currency, 'EUR'),
    'offerLabel', v_event.pass_offer_label,
    'status', v_pass.status
  );
end;
$$;

create or replace function public.reserve_conference_pass_checkout(
  p_token_hash text,
  p_paypal_order_id text,
  p_paypal_env text,
  p_amount_cents integer,
  p_currency text,
  p_reference_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass public.conference_passes%rowtype;
  v_event public.conference_events%rowtype;
begin
  if p_paypal_order_id is null or length(trim(p_paypal_order_id)) < 5 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_order_id');
  end if;

  select * into v_pass
  from public.conference_passes
  where token_hash = lower(trim(p_token_hash))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pass');
  end if;

  select * into v_event from public.conference_events where id = v_pass.event_id;

  if v_pass.redeemed_at is not null or v_pass.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  if v_pass.expires_at <= now() then
    update public.conference_passes
    set status = 'expired', updated_at = now()
    where id = v_pass.id and paypal_capture_id is null;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if not coalesce(v_event.pass_offer_enabled, false) or v_event.pass_offer_amount_cents is null then
    return jsonb_build_object('ok', false, 'reason', 'offer_disabled');
  end if;

  if p_paypal_env = 'live' and p_amount_cents <> v_event.pass_offer_amount_cents then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_paypal_env = 'sandbox' and p_amount_cents <> 100 then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_currency <> coalesce(v_event.pass_offer_currency, 'EUR') then
    return jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  end if;

  if v_pass.paypal_order_id is not null and v_pass.paypal_order_id <> trim(p_paypal_order_id) then
    if v_pass.paypal_capture_id is not null
       or v_pass.redeemed_at is not null
       or v_pass.status not in ('released', 'failed') then
      return jsonb_build_object('ok', false, 'reason', 'already_reserved', 'orderId', v_pass.paypal_order_id);
    end if;
  end if;

  update public.conference_passes
  set status = 'reserved',
      reserved_at = coalesce(reserved_at, now()),
      paypal_order_id = trim(p_paypal_order_id),
      paypal_env = p_paypal_env,
      amount_cents = p_amount_cents,
      currency = p_currency,
      reference_id = p_reference_id,
      released_at = null,
      last_error = null,
      updated_at = now()
  where id = v_pass.id;

  insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
  values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'checkout_started');

  return jsonb_build_object('ok', true, 'passId', v_pass.id, 'orderId', trim(p_paypal_order_id));
end;
$$;

create or replace function public.release_conference_pass_checkout(p_paypal_order_id text, p_reason text default 'payment_failed')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass public.conference_passes%rowtype;
begin
  select * into v_pass
  from public.conference_passes
  where paypal_order_id = trim(p_paypal_order_id)
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'pass_not_found'); end if;
  if v_pass.paypal_capture_id is not null or v_pass.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'captured_payment_requires_reconciliation');
  end if;

  update public.conference_passes
  set status = case when expires_at <= now() then 'expired' else 'released' end,
      released_at = now(),
      last_error = left(coalesce(p_reason, 'payment_failed'), 120),
      updated_at = now()
  where id = v_pass.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.redeem_conference_pass_after_payment(
  p_paypal_order_id text,
  p_paypal_capture_id text,
  p_user_id uuid,
  p_entitlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pass public.conference_passes%rowtype;
begin
  select * into v_pass
  from public.conference_passes
  where paypal_order_id = trim(p_paypal_order_id)
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'pass_not_found'); end if;

  if v_pass.paypal_capture_id is not null then
    if v_pass.paypal_capture_id = trim(p_paypal_capture_id) and v_pass.redeemed_at is not null then
      return jsonb_build_object('ok', true, 'alreadyRedeemed', true, 'passId', v_pass.id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'capture_mismatch');
  end if;

  if v_pass.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired_after_capture_requires_reconciliation');
  end if;

  update public.conference_passes
  set status = 'redeemed',
      paypal_capture_id = trim(p_paypal_capture_id),
      redeemed_at = now(),
      user_id = p_user_id,
      entitlement_id = p_entitlement_id,
      last_error = null,
      updated_at = now()
  where id = v_pass.id;

  insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
  values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'payment_completed');

  insert into public.conference_pass_events (event_id, pass_id, registration_id, event_name)
  values (v_pass.event_id, v_pass.id, v_pass.registration_id, 'pass_redeemed');

  return jsonb_build_object('ok', true, 'alreadyRedeemed', false, 'passId', v_pass.id);
end;
$$;

revoke all on function public.validate_conference_pass(text) from public, anon, authenticated;
revoke all on function public.reserve_conference_pass_checkout(text, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.release_conference_pass_checkout(text, text) from public, anon, authenticated;
revoke all on function public.redeem_conference_pass_after_payment(text, text, uuid, uuid) from public, anon, authenticated;

grant execute on function public.validate_conference_pass(text) to service_role;
grant execute on function public.reserve_conference_pass_checkout(text, text, text, integer, text, text) to service_role;
grant execute on function public.release_conference_pass_checkout(text, text) to service_role;
grant execute on function public.redeem_conference_pass_after_payment(text, text, uuid, uuid) to service_role;

comment on table public.conference_pass_events is 'Aggregate Pass MediumIA funnel events. PII stays in conference_registrations.';
