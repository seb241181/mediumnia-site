-- $1 scenario name only for readability
truncate public.rdv_paypal_payments, public.rdv_booking_holds, public.booking_slot_offers cascade;
insert into public.booking_practitioners(id, slug) values ('aaaaaaaa-0000-0000-0000-000000000001','sebastien-seguin') on conflict do nothing;
insert into public.booking_services(id, practitioner_id) values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.booking_slot_offers(id, practitioner_id, service_id, starts_at, ends_at, token_hash, expires_at)
values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour', repeat('a',64), now() + interval '2 hours');
insert into public.rdv_booking_holds(id, practitioner_id, service_id, starts_at, ends_at, expires_at, slot_offer_id)
values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '15 minutes', 'cccccccc-0000-0000-0000-000000000001');
insert into public.rdv_paypal_payments(hold_id, paypal_order_id, status) values ('dddddddd-0000-0000-0000-000000000001', 'ORDER1', 'order_created');
