-- Make conference pass checkout reservation idempotent under concurrent creates.

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

  select * into v_event
  from public.conference_events
  where id = v_pass.event_id;

  if v_pass.redeemed_at is not null or v_pass.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  if v_pass.expires_at <= now() then
    update public.conference_passes
    set status = 'expired', updated_at = now()
    where id = v_pass.id and paypal_capture_id is null;

    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if not coalesce(v_event.pass_offer_enabled, false)
     or v_event.pass_offer_amount_cents is null then
    return jsonb_build_object('ok', false, 'reason', 'offer_disabled');
  end if;

  if p_paypal_env = 'live'
     and p_amount_cents <> v_event.pass_offer_amount_cents then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_paypal_env = 'sandbox'
     and p_amount_cents <> 100 then
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  if p_currency <> coalesce(v_event.pass_offer_currency, 'EUR') then
    return jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  end if;

  -- Same PayPal order replayed concurrently: return success without
  -- generating a second checkout_started analytics event.
  if v_pass.paypal_order_id = trim(p_paypal_order_id)
     and v_pass.status = 'reserved' then

    if v_pass.paypal_env is distinct from p_paypal_env
       or v_pass.amount_cents is distinct from p_amount_cents
       or v_pass.currency is distinct from p_currency
       or v_pass.reference_id is distinct from p_reference_id then
      return jsonb_build_object('ok', false, 'reason', 'pass_intent_mismatch');
    end if;

    return jsonb_build_object(
      'ok', true,
      'alreadyReserved', true,
      'passId', v_pass.id,
      'orderId', v_pass.paypal_order_id
    );
  end if;

  if v_pass.paypal_order_id is not null
     and v_pass.paypal_order_id <> trim(p_paypal_order_id) then
    if v_pass.paypal_capture_id is not null
       or v_pass.redeemed_at is not null
       or v_pass.status not in ('released', 'failed') then
      return jsonb_build_object(
        'ok', false,
        'reason', 'already_reserved',
        'orderId', v_pass.paypal_order_id
      );
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

  insert into public.conference_pass_events (
    event_id, pass_id, registration_id, event_name
  )
  values (
    v_pass.event_id, v_pass.id, v_pass.registration_id, 'checkout_started'
  );

  return jsonb_build_object(
    'ok', true,
    'alreadyReserved', false,
    'passId', v_pass.id,
    'orderId', trim(p_paypal_order_id)
  );
end;
$$;

revoke all on function public.reserve_conference_pass_checkout(
  text, text, text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.reserve_conference_pass_checkout(
  text, text, text, integer, text, text
) to service_role;
