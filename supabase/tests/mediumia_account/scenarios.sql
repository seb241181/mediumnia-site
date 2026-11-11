-- Espace client MediumIA (lot 1) — scénarios d'accès et de consentement.
--
-- Un seul bloc : chaque vérification lève une erreur si le résultat diffère.
-- Le bloc se termine TOUJOURS par une exception, donc RIEN n'est conservé
-- (annulation complète). Succès = message « OK_ROLLBACK … ».
-- À jouer sur TEST ou sur une base locale jetable, jamais en Production.
do $$
declare
  u1 uuid := gen_random_uuid();  -- compte A (adresse confirmée)
  u2 uuid := gen_random_uuid();  -- compte B (adresse confirmée)
  u3 uuid := gen_random_uuid();  -- compte C (adresse NON confirmée)
  u4 uuid := gen_random_uuid();  -- compte D : son adresse est déjà l'adresse secondaire de B
  b1 uuid; b2 uuid; b3 uuid; b4 uuid;
  v_pract uuid; v_service uuid;
  r jsonb; j jsonb; n int := 0;
  h_ok text := repeat('a', 64); h_exp text := repeat('b', 64); h_unsub text := repeat('c', 64);
  sha text := repeat('d', 64);
begin
  select s.practitioner_id, s.id into v_pract, v_service from public.booking_services s order by s.created_at limit 1;

  insert into auth.users (id, email, email_confirmed_at) values
    (u1, 'lot1-a@mediumia.test', now()),
    (u2, 'lot1-b@mediumia.test', now()),
    (u3, 'lot1-c@mediumia.test', null),
    (u4, 'lot1-b-ancienne@mediumia.test', now());

  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    customer_phone, customer_message, starts_at, ends_at, booking_source, booked_price_cents, modality, video_channel)
  values (v_pract, v_service, 'Alice', 'Martin', '  LOT1-A@Mediumia.test ', '+33600000001', 'message privé',
    '2099-01-05 09:00+00', '2099-01-05 10:00+00', 'manual', 9000, 'video', 'whatsapp') returning id into b1;
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source, booked_price_cents)
  values (v_pract, v_service, 'Alice', 'Martin', 'lot1-b@mediumia.test',
    '2099-01-06 09:00+00', '2099-01-06 10:00+00', 'manual', 9000) returning id into b2;  -- homonyme, autre adresse
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source)
  values (v_pract, v_service, 'Chloé', 'Durand', 'lot1-c@mediumia.test',
    '2099-01-07 09:00+00', '2099-01-07 10:00+00', 'manual') returning id into b3;
  insert into public.bookings (practitioner_id, service_id, customer_first_name, customer_last_name, customer_email,
    starts_at, ends_at, booking_source)
  values (v_pract, v_service, 'Béa', 'Petit', 'lot1-b-ancienne@mediumia.test',
    '2099-01-08 09:00+00', '2099-01-08 10:00+00', 'manual') returning id into b4;

  -- ── Rattachement : seulement par adresse confirmée ──
  r := public.mediumia_account_sync_primary_email(u1);
  assert (r->>'ok')::boolean, 'A : adresse confirmée rattachée'; n := n + 1;
  r := public.mediumia_account_sync_primary_email(u1);
  assert (r->>'ok')::boolean, 'A : rejouable'; n := n + 1;
  assert (select count(*) = 1 from public.mediumia_account_emails where user_id = u1), 'A : une seule ligne'; n := n + 1;
  perform public.mediumia_account_sync_primary_email(u2);
  r := public.mediumia_account_sync_primary_email(u3);
  assert r->>'error' = 'email_not_verified', 'C : adresse non confirmée refusée'; n := n + 1;
  assert public.mediumia_account_sync_primary_email(null)->>'error' = 'invalid_user', 'compte nul refusé'; n := n + 1;

  -- ── Chacun ne voit que ses rendez-vous ──
  j := public.mediumia_account_bookings(u1);
  assert jsonb_array_length(j) = 1 and (j->0->>'id')::uuid = b1, 'A voit uniquement son rendez-vous (casse et espaces ignorés)'; n := n + 1;
  j := public.mediumia_account_bookings(u2);
  assert jsonb_array_length(j) = 1 and (j->0->>'id')::uuid = b2, 'B (homonyme de A) ne voit que le sien'; n := n + 1;
  assert public.mediumia_account_bookings(u3) = '[]'::jsonb, 'C non confirmé ne voit rien'; n := n + 1;
  assert public.mediumia_account_bookings(null) = '[]'::jsonb, 'compte nul : rien'; n := n + 1;
  assert public.mediumia_account_bookings(gen_random_uuid()) = '[]'::jsonb, 'compte inconnu : rien'; n := n + 1;

  -- ── Plusieurs adresses, sans fusion automatique ──
  insert into public.mediumia_account_emails (user_id, email, verified_at, verified_via)
  values (u2, 'lot1-b-ancienne@mediumia.test', now(), 'email_code');
  assert jsonb_array_length(public.mediumia_account_bookings(u2)) = 2, 'B retrouve aussi le rendez-vous de son ancienne adresse'; n := n + 1;
  r := public.mediumia_account_sync_primary_email(u4);
  assert r->>'error' = 'email_linked_to_other_account', 'D : adresse déjà rattachée à B, pas de fusion'; n := n + 1;
  assert public.mediumia_account_bookings(u4) = '[]'::jsonb, 'D ne voit pas les rendez-vous de B'; n := n + 1;

  -- ── Liste blanche de champs ──
  j := public.mediumia_account_bookings(u1)->0;
  assert not (j ?| array['customer_message', 'cancel_reason', 'google_meet_link', 'google_event_id', 'customer_email',
    'balance_owner_decision_note', 'cancellation_token_hash', 'balance_payment_token_hash', 'practitioner_id']),
    'aucun champ interne renvoyé'; n := n + 1;
  assert j->>'modality' = 'video' and j->>'video_channel' = 'whatsapp' and j->>'customer_phone' = '+33600000001',
    'mode, canal et téléphone de la réservation'; n := n + 1;
  j := public.mediumia_account_bookings(u2)->0;
  assert j->'video_channel' = 'null'::jsonb, 'canal inconnu : rien d''inventé'; n := n + 1;

  -- ── Montants : écritures réelles uniquement ──
  j := public.mediumia_account_bookings(u1)->0;
  assert (j->>'paid_cents')::int = 0 and (j->>'price_cents')::int = 9000 and not (j->>'payment_pending')::boolean,
    'rien d''encaissé au départ'; n := n + 1;
  insert into public.rdv_balance_payments (booking_id, client_checkout_id, paypal_order_id, paypal_env, amount_cents, currency, status)
  values (b1, gen_random_uuid(), 'LOT1-ORDER-PENDING', 'sandbox', 6000, 'EUR', 'order_pending');
  j := public.mediumia_account_bookings(u1)->0;
  assert (j->>'paid_cents')::int = 0 and (j->>'payment_pending')::boolean and jsonb_array_length(j->'entries') = 0,
    'paiement PayPal en attente : signalé, jamais compté'; n := n + 1;
  insert into public.rdv_financial_entries (practitioner_id, booking_id, service_id, source, entry_kind, direction, payment_method,
    occurred_at, gross_cents, net_cents, vat_cents, vat_rate_bps, vat_status, currency, note)
  values (v_pract, b1, v_service, 'mediumia', 'arrhes', 'income', 'paypal', now(), 3000, 3000, 0, 0, 'outside_scope', 'EUR', 'note interne');
  j := public.mediumia_account_bookings(u1)->0;
  assert (j->>'paid_cents')::int = 3000 and jsonb_array_length(j->'entries') = 1
    and j->'entries'->0->>'kind' = 'arrhes' and not (j->'entries'->0 ? 'note'), 'arrhes réelles comptées, note interne absente'; n := n + 1;
  assert (public.mediumia_account_bookings(u2)->0->>'paid_cents')::int = 0, 'les arrhes de A n''apparaissent pas chez B'; n := n + 1;

  -- ── Droits : rien pour anon / authenticated ──
  assert not has_function_privilege('anon', 'public.mediumia_account_bookings(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.mediumia_account_bookings(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.mediumia_account_sync_primary_email(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.confirm_mediumia_marketing_consent(text)', 'execute')
     and not has_function_privilege('anon', 'public.withdraw_mediumia_marketing_consent_by_token(text)', 'execute')
     and not has_function_privilege('authenticated',
       'public.record_mediumia_marketing_consent(text, uuid, text, text, boolean, text, text, uuid, uuid, text, timestamptz, text)', 'execute'),
    'fonctions réservées au serveur'; n := n + 1;
  assert not has_table_privilege('authenticated', 'public.mediumia_account_emails', 'select')
     and not has_table_privilege('authenticated', 'public.mediumia_marketing_subscriptions', 'select')
     and not has_table_privilege('anon', 'public.mediumia_marketing_consent_events', 'select'),
    'tables réservées au serveur'; n := n + 1;

  -- ── Consentement ──
  r := public.record_mediumia_marketing_consent('Lot1-A@mediumia.test', null, 'presented_not_given', 'booking', false, 'v1', sha, b1);
  assert r->>'status' = 'none' and r->>'outcome' = 'unchanged', 'case non cochée : non-abonné'; n := n + 1;
  assert (select explicit_refusal_at is null from public.mediumia_marketing_subscriptions where email = 'lot1-a@mediumia.test'),
    'absence de réponse ≠ refus explicite'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', null, 'opt_in', 'booking', false, 'v1', sha, b1);
  assert r->>'error' = 'confirm_token_required', 'adresse non prouvée : jeton de confirmation exigé'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', null, 'opt_in', 'booking', false, null, null);
  assert r->>'error' = 'consent_text_required', 'version du texte exigée'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', null, 'opt_in', 'booking', false, 'v1', sha, b1, null,
    h_ok, now() + interval '7 days', h_unsub);
  assert r->>'status' = 'pending', 'case cochée, adresse non prouvée : à confirmer'; n := n + 1;
  assert public.confirm_mediumia_marketing_consent(repeat('e', 64))->>'error' = 'invalid_token', 'mauvais jeton refusé'; n := n + 1;
  r := public.confirm_mediumia_marketing_consent(h_ok);
  assert r->>'status' = 'subscribed', 'confirmation : abonné'; n := n + 1;
  assert public.confirm_mediumia_marketing_consent(h_ok)->>'error' = 'invalid_token', 'jeton à usage unique'; n := n + 1;

  r := public.withdraw_mediumia_marketing_consent_by_token(h_unsub);
  assert r->>'status' = 'unsubscribed', 'désinscription par lien'; n := n + 1;
  r := public.withdraw_mediumia_marketing_consent_by_token(h_unsub);
  assert r->>'status' = 'unsubscribed' and r->>'outcome' = 'unchanged', 'désinscription rejouable'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', u1, 'opt_in', 'booking', true, 'v1', sha, b1);
  assert r->>'outcome' = 'blocked_unsubscribed' and r->>'status' = 'unsubscribed',
    'nouvelle réservation après désinscription : pas de réabonnement'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', null, 'opt_in', 'form', false, 'v1', sha, null, null,
    repeat('f', 64), now() + interval '7 days');
  assert r->>'outcome' = 'blocked_unsubscribed', 'formulaire après désinscription : pas de réabonnement'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-a@mediumia.test', u1, 'opt_in', 'account', true, 'v1', sha);
  assert r->>'status' = 'subscribed', 'réabonnement explicite depuis l''espace personnel'; n := n + 1;

  r := public.record_mediumia_marketing_consent('lot1-b@mediumia.test', u2, 'refused', 'account', true);
  assert r->>'status' = 'none' and r->>'outcome' = 'refusal_recorded', 'refus explicite : non-abonné'; n := n + 1;
  assert (select explicit_refusal_at is not null from public.mediumia_marketing_subscriptions where email = 'lot1-b@mediumia.test'),
    'refus explicite daté'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-b@mediumia.test', u2, 'opt_in', 'account', true, 'v1', sha);
  assert r->>'status' = 'subscribed', 'compte connecté : abonné sans double confirmation'; n := n + 1;
  r := public.record_mediumia_marketing_consent('lot1-b@mediumia.test', u2, 'refused', 'account', true);
  assert r->>'status' = 'unsubscribed', '« non » d''un abonné : désinscrit'; n := n + 1;

  perform public.record_mediumia_marketing_consent('lot1-c@mediumia.test', null, 'opt_in', 'booking', false, 'v1', sha, null, null,
    h_exp, now() + interval '1 second');
  update public.mediumia_marketing_subscriptions set confirm_token_expires_at = now() - interval '1 minute' where email = 'lot1-c@mediumia.test';
  assert public.confirm_mediumia_marketing_consent(h_exp)->>'error' = 'token_expired', 'jeton expiré refusé'; n := n + 1;
  assert (select status = 'pending' from public.mediumia_marketing_subscriptions where email = 'lot1-c@mediumia.test'),
    'jeton expiré : reste à confirmer, donc exclu des envois'; n := n + 1;
  assert (select count(*) = 1 from public.mediumia_marketing_subscriptions where status = 'subscribed' and email like 'lot1-%'),
    'liste autorisée = abonnés uniquement'; n := n + 1;

  -- ── Journal : une ligne par événement, jamais modifiable ──
  assert (select count(*) = 8 from public.mediumia_marketing_consent_events where email = 'lot1-a@mediumia.test'),
    'journal complet pour A'; n := n + 1;
  begin
    update public.mediumia_marketing_consent_events set outcome = 'subscribed' where email = 'lot1-a@mediumia.test';
    raise exception 'ÉCHEC : le journal a été modifié';
  exception when others then
    assert sqlerrm like '%append-only%', 'journal non modifiable : ' || sqlerrm; n := n + 1;
  end;
  begin
    delete from public.mediumia_marketing_consent_events where email = 'lot1-a@mediumia.test';
    raise exception 'ÉCHEC : le journal a été vidé';
  exception when others then
    assert sqlerrm like '%append-only%', 'journal non supprimable : ' || sqlerrm; n := n + 1;
  end;

  raise exception 'OK_ROLLBACK : % vérifications passées, rien n''est conservé', n;
end;
$$;
