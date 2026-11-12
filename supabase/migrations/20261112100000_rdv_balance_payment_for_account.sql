-- Règlement du solde depuis l'espace client MediumIA.
--
-- Aucun nouveau système de paiement : cette migration ajoute seulement une
-- seconde ENTRÉE vers le paiement de solde existant (rdv_balance_payments).
-- Les fonctions existantes ne sont pas modifiées :
--   attach_rdv_balance_paypal_order, claim_rdv_balance_capture,
--   finalize_rdv_balance_capture, release_rdv_balance_capture
-- restent seules à rattacher l'ordre PayPal, capturer et écrire en
-- comptabilité, avec leurs verrous et leurs contrôles de montant.
--
-- Différence avec create_or_get_rdv_balance_payment (lien reçu par e-mail) :
-- le rendez-vous est désigné par son identifiant et la preuve d'accès est une
-- adresse e-mail VÉRIFIÉE du compte (mediumia_account_emails), au lieu du
-- jeton du lien. Tous les autres contrôles sont identiques.

-- ── 1. Le rendez-vous appartient-il à une adresse vérifiée du compte ? ──────
create or replace function public.mediumia_account_owns_booking(p_user_id uuid, p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.bookings b
    join public.mediumia_account_emails e
      on e.email = lower(btrim(b.customer_email))
    where b.id = p_booking_id
      and e.user_id = p_user_id
  );
$$;

-- ── 2. Créer (ou retrouver) le paiement de solde pour un compte ─────────────
create or replace function public.create_or_get_rdv_balance_payment_for_account(
  p_user_id uuid,
  p_booking_id uuid,
  p_client_checkout_id uuid,
  p_paypal_env text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
  v_service public.booking_services;
  v_payment public.rdv_balance_payments;
  v_paid integer;
  v_due integer;
begin
  if p_user_id is null or p_booking_id is null or p_client_checkout_id is null
     or p_paypal_env is null or p_paypal_env not in ('sandbox', 'live') then
    return jsonb_build_object('ok', false, 'error', 'invalid_balance_payment_request');
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  -- Rendez-vous inconnu ou d'un autre compte : même réponse, rien n'est révélé.
  if not found or not public.mediumia_account_owns_booking(p_user_id, p_booking_id) then
    return jsonb_build_object('ok', false, 'error', 'booking_not_found');
  end if;

  if v_booking.status <> 'confirmed' or v_booking.booking_source <> 'mediumia' then
    return jsonb_build_object('ok', false, 'error', 'booking_not_payable');
  end if;

  if v_booking.balance_cancel_claimed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'balance_cancel_in_progress');
  end if;

  -- Même échéance que le lien : 48 h avant le rendez-vous, ou la fenêtre
  -- tardive accordée par le praticien.
  if now() >= coalesce(v_booking.balance_late_payment_until, v_booking.starts_at - interval '48 hours') then
    return jsonb_build_object('ok', false, 'error', 'balance_payment_expired');
  end if;

  select * into v_service from public.booking_services where id = v_booking.service_id;
  if not found or not ('video' = any(v_service.modality)) then
    return jsonb_build_object('ok', false, 'error', 'balance_video_only');
  end if;

  -- Reste réellement dû : écritures réelles (PayPal capturé, virements et
  -- règlements enregistrés, remboursements déduits).
  v_paid := public.rdv_booking_paid_cents(v_booking.id);
  v_due := greatest(coalesce(v_booking.booked_price_cents, 0) - v_paid, 0);
  if v_due <= 0 or v_booking.balance_paid_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_paid', true,
      'booking_id', v_booking.id,
      'amount_cents', 0,
      'currency', 'EUR'
    );
  end if;

  -- Un seul paiement de solde par rendez-vous, partagé avec le lien e-mail.
  select * into v_payment
  from public.rdv_balance_payments
  where booking_id = v_booking.id
  for update;

  if found then
    if v_payment.paypal_env <> p_paypal_env or v_payment.amount_cents <> v_due or v_payment.currency <> 'EUR' then
      return jsonb_build_object('ok', false, 'error', 'balance_payment_intent_mismatch');
    end if;
    if v_payment.status = 'order_pending' and v_payment.paypal_order_id is null then
      update public.rdv_balance_payments set updated_at = now() where id = v_payment.id;
    end if;
    return jsonb_build_object(
      'ok', true,
      'existing', true,
      'booking_id', v_booking.id,
      'payment_id', v_payment.id,
      'paypal_order_id', v_payment.paypal_order_id,
      'payment_status', v_payment.status,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'service_title', v_service.title,
      'starts_at', v_booking.starts_at,
      'customer_first_name', v_booking.customer_first_name
    );
  end if;

  insert into public.rdv_balance_payments(
    booking_id, client_checkout_id, paypal_env, amount_cents, currency
  ) values (
    v_booking.id, p_client_checkout_id, p_paypal_env, v_due, 'EUR'
  ) returning * into v_payment;

  return jsonb_build_object(
    'ok', true,
    'existing', false,
    'booking_id', v_booking.id,
    'payment_id', v_payment.id,
    'paypal_order_id', null,
    'payment_status', v_payment.status,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'service_title', v_service.title,
    'starts_at', v_booking.starts_at,
    'customer_first_name', v_booking.customer_first_name
  );
end;
$$;

revoke all on function public.mediumia_account_owns_booking(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_or_get_rdv_balance_payment_for_account(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mediumia_account_owns_booking(uuid, uuid) to service_role;
grant execute on function public.create_or_get_rdv_balance_payment_for_account(uuid, uuid, uuid, text) to service_role;
