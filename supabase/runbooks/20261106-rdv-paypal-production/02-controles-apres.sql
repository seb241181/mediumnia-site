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
select
  pg_temp.essai_rdv(null, null) as integral_presentiel_attendu_ESSAI_accepte,
  pg_temp.essai_rdv(null, 1) as montant_faux_attendu_refuse,
  (select position('''video''' in pg_get_functiondef('public.create_rdv_full_payment_hold'::regproc)) = 0) as creation_toutes_modalites,
  (select position('''video''' in pg_get_functiondef('public.enforce_mediumia_booking_reservation_payment'::regproc)) = 0) as protection_toutes_modalites,
  (select not has_function_privilege('anon', 'public.create_rdv_full_payment_hold(uuid,uuid,timestamptz,timestamptz,text,text,text,text,text,text,uuid,text,text,boolean)', 'execute')) as creation_reservee_serveur,
  (select not has_function_privilege('anon', 'public.release_rdv_deposit_capture(text,text,text)', 'execute')) as liberation_reservee_serveur,
  (to_regclass('public.rdv_checkout_events') is not null) as journal_present,
  (select count(*) from public.bookings where customer_email = 'controle@example.org') as essais_conserves_attendu_0;
