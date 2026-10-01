-- Données fictives (aucune donnée réelle). Client « Cliente Test ».
truncate public.rdv_payment_settlement_events, public.rdv_payment_refunds, public.rdv_deposit_transfers, public.rdv_financial_entries,
  public.rdv_balance_payments, public.rdv_paypal_payments, public.rdv_booking_holds, public.bookings, public.booking_services, public.booking_practitioners cascade;
insert into public.booking_practitioners(id, slug) values ('aaaaaaaa-0000-0000-0000-000000000001', 'praticien-test');
insert into public.booking_services(id, practitioner_id, title, modality, vat_rate_bps)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Consultation test', '{video}', 2000);
-- B1 annulé payé (live), B2 et B3 confirmés à venir payés (live), B4 annulé sans arrhes,
-- B5 confirmé d'un autre client, B6 annulé payé en sandbox, B7 confirmé (pas annulé) payé.
insert into public.bookings(id, practitioner_id, service_id, status, starts_at, customer_first_name, customer_last_name, customer_email, booked_price_cents, reservation_payment_cents)
values
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cancelled', now() + interval '100 days','Cliente','Test','cliente@example.test',6000,2000),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','confirmed', now() + interval '18 days','Cliente','Test','Cliente@Example.test',6000,2000),
 ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','confirmed', now() + interval '25 days','Cliente','Test','cliente@example.test',6000,2000),
 ('11111111-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cancelled', now() + interval '30 days','Sans','Arrhes','sans@example.test',6000,0),
 ('11111111-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','confirmed', now() + interval '20 days','Autre','Client','autre@example.test',6000,2000),
 ('11111111-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','cancelled', now() + interval '40 days','Bac','Asable','sandbox@example.test',6000,2000),
 ('11111111-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','confirmed', now() + interval '45 days','Cliente','Test','cliente@example.test',6000,2000);
insert into public.rdv_booking_holds(id, converted_booking_id) values
 ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002'),
 ('22222222-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000003'),
 ('22222222-0000-0000-0000-000000000005','11111111-0000-0000-0000-000000000005'),
 ('22222222-0000-0000-0000-000000000006','11111111-0000-0000-0000-000000000006'),
 ('22222222-0000-0000-0000-000000000007','11111111-0000-0000-0000-000000000007');
insert into public.rdv_paypal_payments(id, hold_id, paypal_order_id, paypal_capture_id, paypal_env, amount_cents, status, captured_at)
select ('33333333-0000-0000-0000-00000000000' || n)::uuid, ('22222222-0000-0000-0000-00000000000' || n)::uuid, 'ORDER' || n, 'CAPTURE' || n,
       case when n = 6 then 'sandbox' else 'live' end, 2000, 'captured', now() - interval '10 days'
from unnest(array[1,2,3,5,6,7]) n;
insert into public.rdv_financial_entries(practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method, occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, service_price_cents, external_payment_ref, note)
select 'aaaaaaaa-0000-0000-0000-000000000001', ('11111111-0000-0000-0000-00000000000' || n)::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', 'mediumia', 'arrhes', 'income', 'paypal',
       now() - interval '10 days', 2000, 1667, 333, 2000, 'taxable', 6000, 'CAPTURE' || n, 'Arrhes de réservation MediumIA'
from unnest(array[1,2,3,5,6,7]) n;
