-- Données fictives uniquement.
truncate public.booking_request_intake_events, public.booking_requests, public.mediumia_customers, public.bookings, public.booking_services, public.booking_practitioners cascade;
insert into public.booking_practitioners(id, slug) values ('aaaaaaaa-0000-0000-0000-000000000001', 'sebastien-seguin'), ('aaaaaaaa-0000-0000-0000-000000000002', 'autre-praticien');
insert into public.booking_services(id, practitioner_id, slug, title, duration_min, price_cents, modality) values
 ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'guidance-visio', 'Guidance — Visio', 60, 7000, '{video}'),
 ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'guidance-presence', 'Guidance — En présence', 60, 7000, '{in-person}'),
 ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'desenvoutement', 'Désenvoûtement', 90, 15000, '{in-person}');
-- Clients connus (fictifs) : Claire (téléphone unique), deux personnes partageant un numéro.
insert into public.bookings(practitioner_id, service_id, starts_at, ends_at, customer_first_name, customer_last_name, customer_email, customer_phone, status) values
 ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now() - interval '30 days', now() - interval '30 days' + interval '1 hour','Claire','Exemple','claire@example.test','06 11 22 33 44','confirmed'),
 ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now() - interval '20 days', now() - interval '20 days' + interval '1 hour','Paul','Famille','paul@example.test','07 99 88 77 66','confirmed'),
 ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', now() - interval '10 days', now() - interval '10 days' + interval '1 hour','Julie','Famille','julie@example.test','+33 7 99 88 77 66','confirmed'),
 ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001', now() - interval '10 days', now() - interval '10 days' + interval '1 hour','Marc','Ailleurs','marc@example.test','06 55 55 55 55','confirmed');
