-- 02 — Contrôles APRÈS. Les essais s'exécutent dans un bloc toujours annulé : aucune
-- donnée n'est conservée (vérifié par les compteurs en fin de requête).
create or replace function pg_temp.essai_rdv(p_booked integer, p_reserved integer) returns text language plpgsql as $$
declare v_service public.booking_services;
begin
  select * into v_service from public.booking_services
   where is_active and booking_mode = 'instant' and reservation_payment_kind = 'arrhes' and 'in-person' = any(modality) and price_cents > reservation_payment_cents
   order by id limit 1;
  if not found then return 'aucune prestation presentiel a arrhes'; end if;
  begin
    insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, starts_at, ends_at, timezone, status, booked_price_cents, reservation_payment_cents, booking_source)
    values (v_service.practitioner_id, v_service.id, 'Controle', 'Annule', 'controle@example.org', '2099-01-01 09:00+00', '2099-01-01 10:00+00', 'Europe/Paris', 'confirmed',
            coalesce(p_booked, v_service.price_cents), coalesce(p_reserved, v_service.price_cents), 'mediumia');
    raise exception 'ESSAI accepte';
  exception when others then
    return sqlerrm;
  end;
end $$;

create or replace function pg_temp.essai_hold_presentiel() returns text language plpgsql as $$
declare v_service public.booking_services; v_result jsonb;
begin
  select * into v_service from public.booking_services
   where is_active and booking_mode = 'instant' and reservation_payment_kind = 'arrhes'
     and 'in-person' = any(modality) and price_cents > reservation_payment_cents
   order by id limit 1;
  if not found then return 'aucune prestation presentiel a arrhes'; end if;
  begin
    v_result := public.create_rdv_full_payment_hold(
      v_service.practitioner_id, v_service.id, '2099-01-02 09:00+00', '2099-01-02 10:00+00',
      'in-person', 'Controle', 'Annule', 'controle@example.org', null, null,
      '11111111-1111-4111-8111-111111111111', 'sandbox', 'test-rdv', true);
    if v_result->>'ok' = 'true' and v_result->>'payment_option' = 'full' then
      raise exception 'ESSAI accepte';
    end if;
    return coalesce(v_result->>'error', 'creation_inattendue');
  exception when others then return sqlerrm;
  end;
end $$;

create or replace function pg_temp.controles_apres() returns text language plpgsql as $$
begin
  if pg_temp.essai_rdv(null, null) <> 'ESSAI accepte' then raise exception 'rdv_postflight_booking_full_failed'; end if;
  if pg_temp.essai_rdv(null, 1) <> 'reservation_payment_required' then raise exception 'rdv_postflight_booking_amount_guard_failed'; end if;
  if pg_temp.essai_hold_presentiel() <> 'ESSAI accepte' then raise exception 'rdv_postflight_hold_full_failed: %', pg_temp.essai_hold_presentiel(); end if;
  if position('p_selected_modality <> ''video''' in pg_get_functiondef('public.create_rdv_full_payment_hold'::regproc)) <> 0 then raise exception 'rdv_postflight_hold_video_only'; end if;
  if position('''video'' = ANY(v_service.modality)' in pg_get_functiondef('public.enforce_mediumia_booking_reservation_payment'::regproc)) <> 0 then raise exception 'rdv_postflight_guard_video_only'; end if;
  if has_function_privilege('anon', 'public.create_rdv_full_payment_hold(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,uuid,text,text,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.create_rdv_full_payment_hold(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,uuid,text,text,boolean)', 'execute')
    or has_function_privilege('anon', 'public.claim_rdv_deposit_capture(text)', 'execute')
    or has_function_privilege('authenticated', 'public.claim_rdv_deposit_capture(text)', 'execute')
    or has_function_privilege('anon', 'public.release_rdv_deposit_capture(text,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.claim_rdv_deposit_capture(text)', 'execute')
    or not has_function_privilege('service_role', 'public.release_rdv_deposit_capture(text,text,text)', 'execute')
  then raise exception 'rdv_postflight_permissions_failed'; end if;
  if to_regclass('public.rdv_checkout_events') is null then raise exception 'rdv_postflight_journal_missing'; end if;
  if (select count(*) from public.bookings where customer_email = 'controle@example.org') <> 0
    or (select count(*) from public.rdv_paypal_payments where client_checkout_id = '11111111-1111-4111-8111-111111111111') <> 0
  then raise exception 'rdv_postflight_test_data_persisted'; end if;
  return 'ok';
end $$;
select pg_temp.controles_apres() as resultat;
