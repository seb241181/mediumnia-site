-- MediumIA · Tarifs 397 / 297 · ROLLBACK de 20260925170000 (à n'utiliser que si le contrôle
-- après migration n'est pas conforme, et AVANT le merge de feat/tarif-397-297).
-- Remet exactement l'état précédent : 597 € / 499 € / lot 597 €, règles de montant d'origine,
-- fonction du Pass d'origine, suppression des colonnes et index de crédit (vides à ce stade).
-- Une seule transaction : si le garde-fou échoue, rien n'est modifié.

begin;

-- Garde-fou : refuse le retour arrière si le nouveau site a déjà vendu (397 €, 368 € ou crédit).
-- Dans ce cas : d'abord remettre l'ancien déploiement Vercel, puis nous en parler.
do $$
begin
  if exists (select 1 from public.mediumia_paypal_order_intents
             where amount_cents in (39700, 36800) or user_id is not null
                or upgrade_credit_purchase_id is not null or upgrade_credit_claimed_at is not null)
     or exists (select 1 from public.mediumia_paypal_purchases
                where amount_cents in (39700, 36800) or upgrade_credit_redeemed_at is not null)
  then
    raise exception 'rollback_refuse : des commandes au nouveau tarif existent déjà';
  end if;
end;
$$;

-- 1. Achat de la Formation complète : règles de montant d'origine.
drop index if exists public.ux_mediumia_order_intents_credit_claim;
drop index if exists public.ux_mediumia_purchases_credit_redeemed_by;

alter table public.mediumia_paypal_order_intents
  drop constraint if exists mediumia_paypal_order_intents_credit_check,
  drop constraint if exists mediumia_paypal_order_intents_amount_check;
alter table public.mediumia_paypal_order_intents
  add constraint mediumia_paypal_order_intents_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
  );
alter table public.mediumia_paypal_order_intents
  drop column if exists upgrade_credit_claimed_at,
  drop column if exists upgrade_credit_purchase_id,
  drop column if exists user_id;

alter table public.mediumia_paypal_purchases
  drop constraint if exists mediumia_paypal_purchases_product_amount_check;
alter table public.mediumia_paypal_purchases
  add constraint mediumia_paypal_purchases_product_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents = 59700)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
  );

-- 2. Conférence : prix normal 597 €, offre 499 €, lot 597 €.
alter table public.conference_events drop constraint if exists conference_events_pass_normal_amount_cents_check;
update public.conference_events set pass_normal_amount_cents = 59700, updated_at = now() where pass_normal_amount_cents <> 59700;
alter table public.conference_events alter column pass_normal_amount_cents set default 59700;
alter table public.conference_events
  add constraint conference_events_pass_normal_amount_cents_check check (pass_normal_amount_cents = 59700);

update public.conference_events
set pass_offer_amount_cents = 49900, updated_at = now()
where slug = 'premiere-conference-mediumia' and pass_offer_amount_cents = 29700;
-- Si le contrôle avant migration montrait un libellé d'offre et qu'il est vide maintenant,
-- le remettre à la main : update public.conference_events set pass_offer_label = '…' where slug = 'premiere-conference-mediumia';

update public.conference_raffles r
set prize_value_cents = 59700, updated_at = now()
from public.conference_events e
where r.event_id = e.id and e.slug = 'premiere-conference-mediumia'
  and r.status <> 'drawn' and r.prize_value_cents = 39700;

-- 3. Pass conférence : fonction d'origine.
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

revoke all on function public.validate_conference_pass(text) from public, anon, authenticated;
grant execute on function public.validate_conference_pass(text) to service_role;

commit;

-- Vérification : doit afficher 59700 / 49900 / 59700, comme avant la migration.
select e.slug, e.pass_normal_amount_cents, e.pass_offer_amount_cents, r.prize_value_cents, r.status
from public.conference_events e
left join public.conference_raffles r on r.event_id = e.id
where e.slug = 'premiere-conference-mediumia';
