-- Règlement du solde depuis l'espace client — scénarios.
--
-- Un seul bloc : chaque vérification lève une erreur si le résultat diffère.
-- Le bloc se termine TOUJOURS par une exception, donc RIEN n'est conservé.
-- Succès = message « OK_ROLLBACK … ». À jouer sur TEST, jamais en Production.
do $$
declare
  ua uuid := gen_random_uuid();  -- compte A, propriétaire
  ub uuid := gen_random_uuid();  -- compte B, étranger
  b1 uuid; b2 uuid; b3 uuid; b4 uuid;
  v_pract uuid; v_service uuid;
  r jsonb; p1 uuid; n int := 0;
  h text := repeat('e', 64);
begin
  select s.practitioner_id, s.id into v_pract, v_service
  from public.booking_services s where 'video' = any(s.modality) order by s.created_at limit 1;
  assert v_service is not null, 'une prestation à distance existe';

  insert into auth.users (id, email, email_confirmed_at) values
    (ua, 'solde-a@mediumia.test', now()), (ub, 'solde-b@mediumia.test', now());
  perform public.mediumia_account_sync_primary_email(ua);
  perform public.mediumia_account_sync_primary_email(ub);

  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source, booked_price_cents, modality)
  values (v_pract, v_service, 'Alice', 'Martin', ' Solde-A@Mediumia.test ', '2099-02-05 09:00+00', '2099-02-05 10:00+00', 'mediumia', 9000, 'video')
  returning id into b1;
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source, booked_price_cents, modality)
  values (v_pract, v_service, 'Alice', 'Martin', 'solde-a@mediumia.test', '2099-02-06 09:00+00', '2099-02-06 10:00+00', 'mediumia', 9000, 'video')
  returning id into b2;
  -- Dans moins de 48 h : échéance dépassée.
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source, booked_price_cents, modality)
  values (v_pract, v_service, 'Alice', 'Martin', 'solde-a@mediumia.test', now() + interval '24 hours', now() + interval '25 hours', 'mediumia', 9000, 'video')
  returning id into b3;
  -- Rendez-vous saisi à la main : pas de paiement en ligne.
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source, booked_price_cents, modality)
  values (v_pract, v_service, 'Alice', 'Martin', 'solde-a@mediumia.test', '2099-02-08 09:00+00', '2099-02-08 10:00+00', 'manual', 9000, 'video')
  returning id into b4;

  insert into public.rdv_financial_entries (practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency)
  select v_pract, b, v_service, 'mediumia', 'arrhes', 'income', 'paypal', now(), 3000, 3000, 0, 0, 'outside_scope', 'EUR'
  from unnest(array[b1, b2, b3, b4]) as b;

  -- ── Propriété du rendez-vous ──
  assert public.mediumia_account_owns_booking(ua, b1), 'A possède son rendez-vous (adresse normalisée)'; n := n + 1;
  assert not public.mediumia_account_owns_booking(ub, b1), 'B ne possède pas le rendez-vous de A'; n := n + 1;
  assert not public.mediumia_account_owns_booking(ua, gen_random_uuid()), 'rendez-vous inconnu'; n := n + 1;

  -- ── Création : reste réellement dû ──
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'sandbox');
  assert (r->>'ok')::boolean and not (r->>'existing')::boolean and (r->>'amount_cents')::int = 6000, 'A : solde de 60 € (90 − 30 d''arrhes)'; n := n + 1;
  p1 := (r->>'payment_id')::uuid;

  -- Rejouer : même paiement, pas de second.
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'sandbox');
  assert (r->>'existing')::boolean and (r->>'payment_id')::uuid = p1, 'rejouable : même paiement'; n := n + 1;
  assert (select count(*) = 1 from public.rdv_balance_payments where booking_id = b1), 'un seul paiement de solde'; n := n + 1;

  -- Autre compte, ou requête incomplète : refus sans rien révéler.
  r := public.create_or_get_rdv_balance_payment_for_account(ub, b1, gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'booking_not_found', 'B refusé sur le rendez-vous de A'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, gen_random_uuid(), gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'booking_not_found', 'rendez-vous inconnu : même réponse'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'autre');
  assert r->>'error' = 'invalid_balance_payment_request', 'environnement PayPal invalide'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'live');
  assert r->>'error' = 'balance_payment_intent_mismatch', 'un paiement Sandbox n''est pas repris en réel'; n := n + 1;

  -- Le lien e-mail et l'espace partagent le même paiement.
  update public.bookings set balance_payment_token_hash = h, balance_payment_token_expires_at = now() + interval '1 day' where id = b1;
  r := public.create_or_get_rdv_balance_payment(h, gen_random_uuid(), 'sandbox');
  assert (r->>'existing')::boolean and (r->>'payment_id')::uuid = p1, 'le lien e-mail retrouve le paiement créé depuis l''espace'; n := n + 1;

  -- ── Parcours existant inchangé : rattachement, capture, finalisation ──
  r := public.attach_rdv_balance_paypal_order(p1, 'ORDRE-ESPACE-TEST-1');
  assert (r->>'ok')::boolean, 'ordre PayPal rattaché'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'sandbox');
  assert r->>'paypal_order_id' = 'ORDRE-ESPACE-TEST-1', 'tentative en cours reprise, pas de second ordre'; n := n + 1;
  r := public.claim_rdv_balance_capture('ORDRE-ESPACE-TEST-1');
  assert (r->>'ok')::boolean and (r->>'amount_cents')::int = 6000, 'capture réservée'; n := n + 1;
  r := public.claim_rdv_balance_capture('ORDRE-ESPACE-TEST-1');
  assert r->>'error' = 'balance_capture_in_progress', 'seconde capture simultanée refusée'; n := n + 1;
  r := public.finalize_rdv_balance_capture('ORDRE-ESPACE-TEST-1', 'CAPTURE-ESPACE-TEST-1', now(), 'sandbox', 6000, 'EUR');
  assert (r->>'ok')::boolean and not (r->>'already_captured')::boolean, 'solde encaissé'; n := n + 1;
  r := public.finalize_rdv_balance_capture('ORDRE-ESPACE-TEST-1', 'CAPTURE-ESPACE-TEST-1', now(), 'sandbox', 6000, 'EUR');
  assert (r->>'already_captured')::boolean, 'finalisation rejouée sans effet'; n := n + 1;
  assert (select count(*) = 1 and sum(gross_cents) = 6000 from public.rdv_financial_entries where booking_id = b1 and entry_kind = 'balance'),
    'une seule écriture de solde'; n := n + 1;
  assert public.rdv_booking_paid_cents(b1) = 9000, 'rendez-vous entièrement réglé'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b1, gen_random_uuid(), 'sandbox');
  assert (r->>'already_paid')::boolean and (r->>'amount_cents')::int = 0, 'plus rien à payer depuis l''espace'; n := n + 1;

  -- ── Virement enregistré entre-temps : jamais de double encaissement ──
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b2, gen_random_uuid(), 'sandbox');
  assert (r->>'amount_cents')::int = 6000, 'b2 : solde de 60 €'; n := n + 1;
  insert into public.rdv_financial_entries (practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency)
  values (v_pract, b2, v_service, 'mediumia', 'balance', 'income', 'transfer', now(), 2000, 2000, 0, 0, 'outside_scope', 'EUR');
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b2, gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'balance_payment_intent_mismatch', 'virement partiel : l''ancien montant n''est plus encaissable'; n := n + 1;
  insert into public.rdv_financial_entries (practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency)
  values (v_pract, b2, v_service, 'mediumia', 'balance', 'income', 'transfer', now(), 4000, 4000, 0, 0, 'outside_scope', 'EUR');
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b2, gen_random_uuid(), 'sandbox');
  assert (r->>'already_paid')::boolean, 'virement complet : plus rien à payer'; n := n + 1;

  -- ── Rendez-vous non payables ──
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b3, gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'balance_payment_expired', 'moins de 48 h : échéance dépassée'; n := n + 1;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b4, gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'booking_not_payable', 'rendez-vous saisi à la main : pas de paiement en ligne'; n := n + 1;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = b4;
  r := public.create_or_get_rdv_balance_payment_for_account(ua, b4, gen_random_uuid(), 'sandbox');
  assert r->>'error' = 'booking_not_payable', 'rendez-vous annulé'; n := n + 1;
  assert (select count(*) = 0 from public.rdv_balance_payments where booking_id in (b3, b4)), 'aucun paiement créé pour un refus'; n := n + 1;

  -- ── Droits : serveur uniquement ──
  assert not has_function_privilege('anon', 'public.create_or_get_rdv_balance_payment_for_account(uuid, uuid, uuid, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.create_or_get_rdv_balance_payment_for_account(uuid, uuid, uuid, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.mediumia_account_owns_booking(uuid, uuid)', 'execute')
     and has_function_privilege('service_role', 'public.create_or_get_rdv_balance_payment_for_account(uuid, uuid, uuid, text)', 'execute'),
    'fonctions réservées au serveur'; n := n + 1;

  raise exception 'OK_ROLLBACK % vérifications', n;
end $$;
