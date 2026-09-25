-- Alignement tarifaire : Formation MediumIA complète à 397 € TTC (au lieu de 597 €),
-- offre spéciale conférence à 297 € TTC, lot du tirage au sort d'une valeur de 397 € TTC.
--
-- Migration additive, à appliquer manuellement par le propriétaire (SQL Editor Supabase).
-- Elle ne modifie aucune migration déjà appliquée et peut être relancée sans effet.
-- Aucun paiement, aucun accès et aucune inscription ne sont modifiés.

-- 1. Conférence : prix normal affiché 397 €, offre participants 297 €.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.conference_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%pass_normal_amount_cents%'
  loop
    execute format('alter table public.conference_events drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.conference_events
  alter column pass_normal_amount_cents set default 39700;

update public.conference_events
set pass_normal_amount_cents = 39700,
    updated_at = now()
where pass_normal_amount_cents <> 39700;

alter table public.conference_events
  add constraint conference_events_pass_normal_amount_cents_check
  check (pass_normal_amount_cents = 39700);

update public.conference_events
set pass_offer_amount_cents = 29700,
    updated_at = now()
where slug = 'premiere-conference-mediumia'
  and pass_offer_amount_cents is distinct from 29700;

-- Un libellé d'offre qui citerait un ancien montant repasse au libellé neutre.
update public.conference_events
set pass_offer_label = null,
    updated_at = now()
where slug = 'premiere-conference-mediumia'
  and pass_offer_label ~ '(597|499|399)';

-- 2. Tirage au sort : lot d'une valeur de 397 € TTC (tirage pas encore effectué uniquement).
update public.conference_raffles r
set prize_value_cents = 39700,
    updated_at = now()
from public.conference_events e
where r.event_id = e.id
  and e.slug = 'premiere-conference-mediumia'
  and r.status <> 'drawn'
  and r.prize_value_cents <> 39700;

-- 3. Pass conférence : valeur de repli alignée (la colonne est déjà renseignée).
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
    'normalAmountCents', coalesce(v_event.pass_normal_amount_cents, 39700),
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

-- 4. Achat de la Formation complète sur le site : montant live 397 €.
--    59700 reste toléré seulement pour les intentions de paiement déjà enregistrées :
--    une contrainte est revérifiée à chaque mise à jour de ligne, et le suivi d'une
--    ancienne commande échouerait sinon. Le site (nouvelle version) ne crée plus que
--    des intentions à 39700 et refuse toute capture live d'un autre montant.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.mediumia_paypal_order_intents'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%amount_cents = 2900%'
  loop
    execute format('alter table public.mediumia_paypal_order_intents drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.mediumia_paypal_order_intents
  add constraint mediumia_paypal_order_intents_amount_check check (
    (paypal_env = 'sandbox' and amount_cents = 100)
    or (paypal_env = 'live' and product_code = 'discovery' and amount_cents = 2900)
    or (paypal_env = 'live' and product_code = 'full' and amount_cents in (39700, 59700))
  );

-- Vérification : doit afficher 397 € / 297 € / 397 €.
select e.slug,
       e.pass_normal_amount_cents as prix_normal_cents,
       e.pass_offer_amount_cents as offre_conference_cents,
       e.pass_offer_label as libelle_offre,
       r.prize_value_cents as valeur_lot_cents,
       r.status as statut_tirage
from public.conference_events e
left join public.conference_raffles r on r.event_id = e.id
where e.slug = 'premiere-conference-mediumia';
