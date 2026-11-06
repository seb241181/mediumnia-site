-- Scénarios des bugs du 6/11/2026 et de leur correction. Toute assertion fausse
-- arrête le script (ON_ERROR_STOP) : « ok » final = tous les scénarios passent.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok : %', label;
end $$;

create or replace function pg_temp.hold(p_email text, p_checkout uuid, p_start timestamptz) returns jsonb language sql as $$
  select public.create_rdv_deposit_hold(
    (select id from public.booking_practitioners limit 1), (select id from public.booking_services limit 1),
    p_start, p_start + interval '60 minutes', 'in-person', 'Prénom', 'Nom', p_email, null, null,
    p_checkout, 'sandbox', 'rdv-arrhes-2026-09-24-v2', true)
$$;

create or replace function pg_temp.supersede(p_email text, p_checkout uuid, p_start timestamptz) returns integer language sql as $$
  select public.supersede_rdv_own_pending_holds((select id from public.booking_practitioners limit 1), p_start, p_start + interval '60 minutes', p_email, p_checkout)
$$;

insert into public.booking_practitioners (buffer_before_min, buffer_after_min) values (0, 0);
insert into public.booking_services (practitioner_id) select id from public.booking_practitioners;

-- ── S1. Reproduction du parcours de Linda : nouvel onglet = nouvel identifiant ──
do $$
declare r jsonb; v_slot timestamptz := '2026-12-01 14:00+00';
begin
  r := pg_temp.hold('cliente@example.org', '11111111-1111-4111-8111-111111111111', v_slot);
  perform pg_temp.check(r->>'ok' = 'true', 'S1 première tentative : réservation provisoire créée');
  update public.rdv_paypal_payments set paypal_order_id = 'ORDER-A1' where client_checkout_id = '11111111-1111-4111-8111-111111111111';

  -- Comportement actuel (bug) : la cliente se bloque elle-même.
  r := pg_temp.hold('cliente@example.org', '22222222-2222-4222-8222-222222222222', v_slot);
  perform pg_temp.check(r->>'error' = 'slot_unavailable', 'S1 BUG reproduit : sa 2e tentative est refusée « créneau déjà réservé »');

  -- Correction : sa tentative précédente est remplacée.
  perform pg_temp.check(pg_temp.supersede('CLIENTE@example.org ', '22222222-2222-4222-8222-222222222222', v_slot) = 1, 'S1 correctif : 1 tentative précédente remplacée (e-mail sans tenir compte de la casse)');
  r := pg_temp.hold('cliente@example.org', '22222222-2222-4222-8222-222222222222', v_slot);
  perform pg_temp.check(r->>'ok' = 'true' and r->>'existing' = 'false', 'S1 correctif : la nouvelle tentative obtient le créneau');
  perform pg_temp.check((select status from public.rdv_paypal_payments where paypal_order_id = 'ORDER-A1') = 'expired'
    and (select last_error_code from public.rdv_paypal_payments where paypal_order_id = 'ORDER-A1') = 'superseded_by_retry', 'S1 ancienne commande marquée remplacée');
  r := public.claim_rdv_deposit_capture('ORDER-A1');
  perform pg_temp.check(r->>'error' = 'hold_not_capturable', 'S1 l''ancienne commande PayPal ne peut plus être capturée : pas de double encaissement');
end $$;

-- ── S2. Un autre client ne peut pas prendre un créneau tenu ──
do $$
declare r jsonb; v_slot timestamptz := '2026-12-01 14:00+00';
begin
  perform pg_temp.check(pg_temp.supersede('autre@example.org', '33333333-3333-4333-8333-333333333333', v_slot) = 0, 'S2 un autre client ne remplace rien');
  r := pg_temp.hold('autre@example.org', '33333333-3333-4333-8333-333333333333', v_slot);
  perform pg_temp.check(r->>'error' = 'slot_unavailable', 'S2 le créneau reste protégé pour la cliente en cours de paiement');
end $$;

-- ── S3. Un paiement déjà en capture n'est jamais remplacé ──
do $$
declare r jsonb; v_slot timestamptz := '2026-12-01 14:00+00';
begin
  update public.rdv_paypal_payments set paypal_order_id = 'ORDER-A2' where client_checkout_id = '22222222-2222-4222-8222-222222222222';
  r := public.claim_rdv_deposit_capture('ORDER-A2');
  perform pg_temp.check(r->>'ok' = 'true', 'S3 capture réclamée');
  perform pg_temp.check(pg_temp.supersede('cliente@example.org', '44444444-4444-4444-8444-444444444444', v_slot) = 0, 'S3 la tentative en capture n''est pas remplacée');
  r := pg_temp.hold('cliente@example.org', '44444444-4444-4444-8444-444444444444', v_slot);
  perform pg_temp.check(r->>'error' = 'slot_unavailable', 'S3 pas de second paiement pendant une capture');
end $$;

-- ── S4. Refus PayPal certain : retour au paiement, nouvelle clé d'idempotence ──
do $$
declare r jsonb;
begin
  perform pg_temp.check(public.next_rdv_capture_attempt('ORDER-A2') = 1, 'S4 tentative de capture n°1');
  r := public.release_rdv_deposit_capture('ORDER-A2', 'payment_pending', 'paypal_instrument_declined');
  perform pg_temp.check(r->>'ok' = 'true', 'S4 refus : la réservation repasse en attente de paiement');
  perform pg_temp.check((select h.status = 'payment_pending' and h.expires_at between now() + interval '9 minutes' and now() + interval '11 minutes'
    from public.rdv_booking_holds h join public.rdv_paypal_payments p on p.hold_id = h.id where p.paypal_order_id = 'ORDER-A2'), 'S4 créneau gardé 10 minutes pour payer autrement');
  perform pg_temp.check((select status = 'order_pending' and last_error_code = 'paypal_instrument_declined' from public.rdv_paypal_payments where paypal_order_id = 'ORDER-A2'), 'S4 motif du refus enregistré');
  perform pg_temp.check(public.next_rdv_capture_attempt('ORDER-A2') is null, 'S4 aucun numéro de capture hors capture');
  r := public.claim_rdv_deposit_capture('ORDER-A2');
  perform pg_temp.check(r->>'ok' = 'true' and r->>'capturing' is null, 'S4 nouvel essai de capture accepté');
  perform pg_temp.check(public.next_rdv_capture_attempt('ORDER-A2') = 2, 'S4 tentative n°2 : nouvelle clé PayPal');
  update public.rdv_booking_holds h set expires_at = now() - interval '1 day'
    from public.rdv_paypal_payments p where p.hold_id = h.id and p.paypal_order_id = 'ORDER-A2';
  r := public.claim_rdv_deposit_capture('ORDER-A2');
  perform pg_temp.check(r->>'capturing' = 'true', 'S4 capture expirée : aucune nouvelle réclamation');
  perform pg_temp.check((select capture_attempts from public.rdv_paypal_payments where paypal_order_id = 'ORDER-A2') = 2,
    'S4 capture expirée : compteur inchangé');
end $$;

-- ── S5. Un paiement encaissé n'est jamais libéré ──
do $$
declare r jsonb;
begin
  update public.rdv_paypal_payments set paypal_capture_id = 'CAPTURE-A2' where paypal_order_id = 'ORDER-A2';
  r := public.release_rdv_deposit_capture('ORDER-A2', 'expired', 'capture_not_completed');
  perform pg_temp.check(r->>'error' = 'payment_already_captured', 'S5 libération refusée : identifiant de capture présent');
  perform pg_temp.check((select h.status from public.rdv_booking_holds h join public.rdv_paypal_payments p on p.hold_id = h.id where p.paypal_order_id = 'ORDER-A2') = 'payment_capturing', 'S5 la réservation reste bloquée pour rapprochement');
end $$;

-- ── S6. Capture restée sans réponse (cas du 3 novembre) ──
do $$
declare r jsonb; v_slot timestamptz := '2026-12-02 10:00+00';
begin
  r := pg_temp.hold('bloquee@example.org', '55555555-5555-4555-8555-555555555555', v_slot);
  update public.rdv_paypal_payments set paypal_order_id = 'ORDER-B1' where client_checkout_id = '55555555-5555-4555-8555-555555555555';
  r := public.claim_rdv_deposit_capture('ORDER-B1');
  update public.rdv_booking_holds h set expires_at = now() - interval '3 days' from public.rdv_paypal_payments p where p.hold_id = h.id and p.paypal_order_id = 'ORDER-B1';
  r := public.claim_rdv_deposit_capture('ORDER-B1');
  perform pg_temp.check(r->>'capturing' = 'true', 'S6 ancien paiement en capture jamais réclamé à nouveau');
  r := pg_temp.hold('suivante@example.org', '66666666-6666-4666-8666-666666666666', v_slot);
  perform pg_temp.check(r->>'error' = 'slot_unavailable', 'S6 BUG reproduit : créneau bloqué indéfiniment par une capture sans réponse');
  r := public.release_rdv_deposit_capture('ORDER-B1', 'expired', 'capture_not_completed');
  perform pg_temp.check(r->>'ok' = 'true', 'S6 rapprochement : PayPal n''a rien encaissé, réservation libérée');
  r := pg_temp.hold('suivante@example.org', '66666666-6666-4666-8666-666666666666', v_slot);
  perform pg_temp.check(r->>'ok' = 'true', 'S6 le créneau est de nouveau réservable');
  r := public.claim_rdv_deposit_capture('ORDER-B1');
  perform pg_temp.check(r->>'error' = 'hold_not_capturable', 'S6 l''ancienne commande ne peut plus être capturée');
end $$;

-- ── S7. Garde-fous ──
do $$
declare r jsonb;
begin
  r := public.release_rdv_deposit_capture('ORDER-B1', 'payment_pending', 'x');
  perform pg_temp.check(r->>'error' = 'not_capturing', 'S7 libération refusée hors capture');
  r := public.release_rdv_deposit_capture('ORDER-B1', 'converted', 'x');
  perform pg_temp.check(r->>'error' = 'invalid_next_status', 'S7 état cible invalide refusé');
  r := public.release_rdv_deposit_capture('INCONNU', 'expired', 'x');
  perform pg_temp.check(r->>'error' = 'payment_not_found', 'S7 commande inconnue');
end $$;

-- ── S8. Journal des échecs ──
do $$
begin
  insert into public.rdv_checkout_events (source, action, error_code, checkout_ref) values ('client', 'paypal', 'paypal_sdk_error', 'abcdef12');
  begin
    insert into public.rdv_checkout_events (source, action, error_code, checkout_ref) values ('client', 'paypal', 'paypal_sdk_error', 'abcdef12');
    raise exception 'ÉCHEC : S8 doublon client accepté';
  exception when unique_violation then raise notice 'ok : S8 une erreur client n''est enregistrée qu''une fois par paiement';
  end;
  insert into public.rdv_checkout_events (source, action, error_code, checkout_ref) values ('server', 'create', 'slot_unavailable', 'abcdef12');
  insert into public.rdv_checkout_events (source, action, error_code, checkout_ref) values ('server', 'create', 'slot_unavailable', 'abcdef12');
  begin
    insert into public.rdv_checkout_events (source, action, error_code, checkout_ref) values ('server', 'create', 'x', 'Linda@x');
    raise exception 'ÉCHEC : S8 référence non anonyme acceptée';
  exception when check_violation then raise notice 'ok : S8 seule une référence courte anonyme est acceptée';
  end;
end $$;

-- ── S9. Permissions ──
do $$
begin
  perform pg_temp.check(not has_function_privilege('anon', 'public.release_rdv_deposit_capture(text,text,text)', 'execute'), 'S9 visiteur : pas d''accès à la libération');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.supersede_rdv_own_pending_holds(uuid,timestamptz,timestamptz,text,uuid)', 'execute'), 'S9 compte connecté : pas d''accès au remplacement');
  perform pg_temp.check(not has_function_privilege('anon', 'public.claim_rdv_deposit_capture(text)', 'execute'), 'S9 visiteur : pas d''accès à la réclamation durcie');
  perform pg_temp.check(has_function_privilege('service_role', 'public.next_rdv_capture_attempt(text)', 'execute'), 'S9 serveur : accès autorisé');
  perform pg_temp.check(not has_table_privilege('anon', 'public.rdv_checkout_events', 'select'), 'S9 journal illisible pour les visiteurs');
end $$;

select 'ok' as resultat;
