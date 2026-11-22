-- Scénarios des règlements hors PayPal. Toute assertion fausse arrête le script
-- (ON_ERROR_STOP) : « ok » final = tous les scénarios passent.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok : %', label;
end $$;

-- Propriétaire A (agenda), propriétaire B (autre compte).
insert into public.rdv_balance_runtime_settings (singleton, auto_cancel_mode) values (true, 'owner_review');
insert into public.booking_practitioners (id, owner_id, slug, name)
  values ('00000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'praticien-a', 'A'),
         ('00000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002', 'praticien-b', 'B');
insert into public.booking_services (id, practitioner_id, slug, title, duration_min, price_cents, modality, reservation_payment_kind, reservation_payment_cents)
  values ('00000000-0000-4000-8000-00000000005e', '00000000-0000-4000-8000-0000000000a1', 'guidance-visio', 'Guidance — Visio', 60, 7000, '{video}', 'arrhes', 2000);

create or replace function pg_temp.booking(p_id uuid, p_token text) returns void language sql as $$
  insert into public.bookings (id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booked_price_cents, reservation_payment_cents, balance_payment_token_hash, balance_payment_token_expires_at, balance_late_payment_until)
  values (p_id, '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000005e', 'Cliente', 'Test', 'cliente@example.org',
    now() + interval '3 days', now() + interval '3 days 1 hour', 7000, 2000, p_token, now() + interval '2 days', now() + interval '2 days');
  insert into public.rdv_financial_entries (practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method, gross_cents, net_cents, vat_cents, vat_rate_bps, service_price_cents)
  values ('00000000-0000-4000-8000-0000000000a1', p_id, '00000000-0000-4000-8000-00000000005e', 'mediumia', 'arrhes', 'income', 'paypal', 2000, 1667, 333, 2000, 7000);
$$;

create or replace function pg_temp.ann(p_actor uuid, p_booking uuid, p_amount integer, p_req text) returns jsonb language sql as $$
  select public.announce_rdv_offline_payment(p_actor, p_booking, 'transfer', p_amount, 'Virement annoncé par la cliente', p_req)
$$;
create or replace function pg_temp.conf(p_actor uuid, p_booking uuid, p_method text, p_amount integer, p_on date, p_req text) returns jsonb language sql as $$
  select public.confirm_rdv_offline_payment(p_actor, p_booking, p_method, p_amount, p_on, 'VIR-123', null, p_req, null)
$$;

\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''

-- ── S1. Cas Marie France : visio, arrhes 20 €, solde 50 €, commande PayPal ouverte ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000001'; tok text := repeat('a', 64);
  a uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; b uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
begin
  perform pg_temp.booking(bk, tok);
  insert into public.rdv_balance_payments (booking_id, client_checkout_id, paypal_order_id, paypal_env, amount_cents, updated_at)
    values (bk, gen_random_uuid(), 'ORDER-8014', 'live', 5000, now() - interval '2 days');

  r := pg_temp.ann(b, bk, 5000, 'announce-other-owner-0001');
  perform pg_temp.check(r->>'error' = 'booking_not_found', 'S1 un autre compte ne peut rien déclarer sur ce rendez-vous');
  r := pg_temp.ann(a, bk, 6000, 'announce-too-much-000001');
  perform pg_temp.check(r->>'error' = 'amount_exceeds_due' and (r->>'due_cents')::int = 5000, 'S1 annonce supérieure au solde refusée (reste 50 €)');

  r := pg_temp.ann(a, bk, 5000, 'announce-mfb-0000000001');
  perform pg_temp.check(r->>'ok' = 'true' and r->'payment'->>'status' = 'announced', 'S1 virement de 50 € annoncé');
  r := pg_temp.ann(a, bk, 5000, 'announce-mfb-0000000001');
  perform pg_temp.check(r->>'replayed' = 'true', 'S1 même demande rejouée : aucune seconde annonce');
  r := pg_temp.ann(a, bk, 5000, 'announce-mfb-0000000002');
  perform pg_temp.check(r->>'error' = 'announcement_exists', 'S1 une seule annonce ouverte par rendez-vous');

  perform pg_temp.check((select count(*) from public.rdv_financial_entries where booking_id = bk) = 1, 'S1 annonce : aucune écriture comptable (solde non encaissé)');
  perform pg_temp.check((select balance_paid_at from public.bookings where id = bk) is null, 'S1 annonce : rendez-vous non soldé');
  perform pg_temp.check(public.rdv_balance_cancel_blocker(bk, now() + interval '2 days 1 minute') = 'offline_payment_announced', 'S1 annonce : annulation pour impayé suspendue');

  r := public.create_or_get_rdv_balance_payment(tok, gen_random_uuid(), 'live');
  perform pg_temp.check(r->>'error' = 'offline_payment_announced', 'S1 annonce : le lien PayPal ne propose pas de second paiement');
  r := public.claim_rdv_balance_capture('ORDER-8014');
  perform pg_temp.check(r->>'error' = 'offline_payment_announced', 'S1 annonce : capture de la commande ouverte refusée (aucun débit)');
  perform pg_temp.check((select status from public.rdv_balance_payments where booking_id = bk) = 'order_pending', 'S1 la commande PayPal n''est pas modifiée');
end $$;

-- ── S2. Garde-fous de la confirmation ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000001'; a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date + 2, 'confirm-future-00000001');
  perform pg_temp.check(r->>'error' = 'invalid_received_on', 'S2 date d''encaissement future refusée');
  r := pg_temp.conf(a, bk, 'transfer', 6000, (now() at time zone 'Europe/Paris')::date, 'confirm-too-much-000001');
  perform pg_temp.check(r->>'error' = 'amount_exceeds_due', 'S2 montant reçu supérieur au solde refusé');
  r := pg_temp.conf(a, bk, 'bitcoin', 5000, (now() at time zone 'Europe/Paris')::date, 'confirm-bad-method-0001');
  perform pg_temp.check(r->>'error' = 'invalid_payment_method', 'S2 moyen de paiement inconnu refusé');
  update public.rdv_balance_payments set status = 'capture_in_progress', capture_claimed_at = now() where booking_id = bk;
  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date, 'confirm-during-capture1');
  perform pg_temp.check(r->>'error' = 'paypal_capture_in_progress', 'S2 confirmation refusée pendant une capture PayPal : paiement à vérifier');
  update public.rdv_balance_payments set status = 'order_pending', capture_claimed_at = null where booking_id = bk;
  perform pg_temp.check((select count(*) from public.rdv_financial_entries where booking_id = bk) = 1, 'S2 aucun refus n''a laissé d''écriture');
end $$;

-- ── S3. Réception confirmée par le propriétaire ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000001'; a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  tok text := repeat('a', 64); e public.rdv_financial_entries;
begin
  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date - 1, 'confirm-mfb-00000000001');
  perform pg_temp.check(r->>'ok' = 'true' and r->>'settled' = 'true' and (r->>'due_cents')::int = 0, 'S3 virement de 50 € confirmé : rendez-vous soldé');
  perform pg_temp.check((select status from public.rdv_offline_payments where announce_request_id = 'announce-mfb-0000000001') = 'confirmed', 'S3 l''annonce devient le règlement confirmé');
  select * into e from public.rdv_financial_entries where booking_id = bk and payment_method = 'transfer';
  perform pg_temp.check(e.gross_cents = 5000 and e.net_cents = 4167 and e.vat_cents = 833 and e.source = 'mediumia' and e.entry_kind = 'balance'
    and e.external_payment_ref = 'offline:confirm-mfb-00000000001', 'S3 une écriture « solde » de 50 € par virement, TVA 20 % ventilée');
  perform pg_temp.check((select count(*) from public.rdv_financial_entries where booking_id = bk and payment_method = 'paypal') = 1, 'S3 aucune transaction PayPal créée ou modifiée');
  perform pg_temp.check(public.rdv_booking_paid_cents(bk) = 7000, 'S3 total réglé 70 € (20 € PayPal + 50 € virement)');
  perform pg_temp.check((select balance_paid_at is not null and balance_payment_token_hash = tok from public.bookings where id = bk), 'S3 rendez-vous soldé, lien de solde toujours lisible');
  perform pg_temp.check((select string_agg(event, ',' order by id) from public.rdv_offline_payment_events where booking_id = bk) = 'announced,confirmed', 'S3 historique : annoncé puis confirmé');

  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date - 1, 'confirm-mfb-00000000001');
  perform pg_temp.check(r->>'replayed' = 'true', 'S3 double clic : confirmation rejouée');
  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date, 'confirm-mfb-00000000002');
  perform pg_temp.check(r->>'error' = 'nothing_due', 'S3 seconde confirmation refusée : plus rien à régler');
  perform pg_temp.check((select count(*) from public.rdv_financial_entries where booking_id = bk) = 2, 'S3 pas de double comptabilisation');

  r := public.create_or_get_rdv_balance_payment(tok, gen_random_uuid(), 'live');
  perform pg_temp.check(r->>'already_paid' = 'true', 'S3 le lien de solde affiche « réglé »');
  r := public.claim_rdv_balance_capture('ORDER-8014');
  perform pg_temp.check(r->>'error' = 'balance_payment_expired', 'S3 la commande PayPal restée ouverte ne peut plus être capturée');
  perform pg_temp.check((select status from public.rdv_balance_payments where booking_id = bk) = 'order_pending', 'S3 order_pending ne remet pas en cause le virement confirmé');
end $$;

-- ── S4. Annonce retirée (virement jamais arrivé) ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000002'; a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  b uuid := 'bbbbbbbb-0000-4000-8000-000000000002'; tok text := repeat('b', 64); oid uuid;
begin
  perform pg_temp.booking(bk, tok);
  r := pg_temp.ann(a, bk, 5000, 'announce-withdraw-000001');
  oid := (r->'payment'->>'id')::uuid;
  r := public.withdraw_rdv_offline_payment(b, oid, 'test');
  perform pg_temp.check(r->>'error' = 'offline_payment_not_found', 'S4 un autre compte ne peut pas retirer l''annonce');
  r := public.withdraw_rdv_offline_payment(a, oid, 'Virement non reçu');
  perform pg_temp.check(r->'payment'->>'status' = 'withdrawn', 'S4 annonce retirée');
  r := public.withdraw_rdv_offline_payment(a, oid, 'Virement non reçu');
  perform pg_temp.check(r->>'replayed' = 'true', 'S4 retrait rejoué sans effet');
  perform pg_temp.check(public.rdv_balance_cancel_blocker(bk, now() + interval '2 days 1 minute') is distinct from 'offline_payment_announced', 'S4 après retrait : suivi normal du solde');
  r := public.create_or_get_rdv_balance_payment(tok, gen_random_uuid(), 'live');
  perform pg_temp.check(r->>'ok' = 'true' and (r->>'amount_cents')::int = 5000, 'S4 après retrait : le lien PayPal fonctionne de nouveau');
  r := pg_temp.ann(a, bk, 5000, 'announce-withdraw-000002');
  perform pg_temp.check(r->>'ok' = 'true', 'S4 une nouvelle annonce reste possible');
end $$;

-- ── S5. Règlement en deux fois sur place, sans annonce ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000003'; a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform pg_temp.booking(bk, repeat('c', 64));
  r := pg_temp.conf(a, bk, 'cash', 3000, (now() at time zone 'Europe/Paris')::date, 'confirm-partial-0000001');
  perform pg_temp.check(r->>'settled' = 'false' and (r->>'due_cents')::int = 2000, 'S5 30 € en espèces : reste 20 €');
  perform pg_temp.check((select balance_paid_at from public.bookings where id = bk) is null, 'S5 rendez-vous pas encore soldé');
  r := pg_temp.conf(a, bk, 'check', 2000, (now() at time zone 'Europe/Paris')::date, 'confirm-partial-0000002');
  perform pg_temp.check(r->>'settled' = 'true', 'S5 20 € par chèque : rendez-vous soldé');
end $$;

-- ── S6. Rendez-vous annulé ──
do $$
declare r jsonb; bk uuid := '11111111-0000-4000-8000-000000000004'; a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform pg_temp.booking(bk, repeat('d', 64));
  update public.bookings set status = 'cancelled' where id = bk;
  r := pg_temp.conf(a, bk, 'transfer', 5000, (now() at time zone 'Europe/Paris')::date, 'confirm-cancelled-00001');
  perform pg_temp.check(r->>'error' = 'booking_not_confirmed', 'S6 aucun règlement sur un rendez-vous annulé');
  r := pg_temp.ann(a, bk, 5000, 'announce-cancelled-0001');
  perform pg_temp.check(r->>'error' = 'booking_not_confirmed', 'S6 aucune annonce sur un rendez-vous annulé');
end $$;

-- ── S7. Permissions ──
do $$
begin
  perform pg_temp.check(not has_function_privilege('anon', 'public.confirm_rdv_offline_payment(uuid,uuid,text,integer,date,text,text,text,uuid)', 'execute'), 'S7 visiteur : pas d''accès à la confirmation');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.announce_rdv_offline_payment(uuid,uuid,text,integer,text,text)', 'execute'), 'S7 compte connecté : pas d''accès direct à l''annonce');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.withdraw_rdv_offline_payment(uuid,uuid,text)', 'execute'), 'S7 compte connecté : pas d''accès direct au retrait');
  perform pg_temp.check(has_function_privilege('service_role', 'public.confirm_rdv_offline_payment(uuid,uuid,text,integer,date,text,text,text,uuid)', 'execute'), 'S7 serveur : accès autorisé');
  perform pg_temp.check(not has_table_privilege('anon', 'public.rdv_offline_payments', 'select') and not has_table_privilege('authenticated', 'public.rdv_offline_payment_events', 'select'), 'S7 tables illisibles hors serveur');
  perform pg_temp.check(not has_table_privilege('service_role', 'public.rdv_offline_payment_events', 'update') and not has_table_privilege('service_role', 'public.rdv_offline_payment_events', 'delete'), 'S7 historique non modifiable, même par le serveur');
end $$;

-- Rendez-vous pour le test de concurrence (8 connexions).
select pg_temp.booking('11111111-0000-4000-8000-000000000008', repeat('e', 64));
select pg_temp.booking('11111111-0000-4000-8000-000000000009', repeat('f', 64));
insert into public.rdv_balance_payments (booking_id, client_checkout_id, paypal_order_id, paypal_env, amount_cents)
  values ('11111111-0000-4000-8000-000000000009', gen_random_uuid(), 'ORDER-RACE', 'live', 5000);

select 'ok' as resultat;
