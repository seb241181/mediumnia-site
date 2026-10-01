-- Scénarios séquentiels. Chaque bloc échoue bruyamment (RAISE) si le résultat n'est pas celui attendu.
\set ON_ERROR_STOP on
set role service_role;
\set P '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B1 '''11111111-0000-0000-0000-000000000001'''
\set B2 '''11111111-0000-0000-0000-000000000002'''
\set B3 '''11111111-0000-0000-0000-000000000003'''
\set B4 '''11111111-0000-0000-0000-000000000004'''
\set B5 '''11111111-0000-0000-0000-000000000005'''
\set B6 '''11111111-0000-0000-0000-000000000006'''
\set B7 '''11111111-0000-0000-0000-000000000007'''

create temp table t_check(label text, ok boolean);
create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if; raise notice 'OK  %', label; end $$;
create or replace function pg_temp.total() returns int language sql as $$
  select coalesce(sum(case direction when 'income' then gross_cents else -gross_cents end),0)::int from public.rdv_financial_entries $$;

\echo '== 1. Sans arrhes / RDV non annulé / environnement =='
select pg_temp.ok('RDV sans arrhes → no_paypal_deposit', (public.begin_rdv_payment_refund(:B4, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'no_paypal_deposit');
select pg_temp.ok('RDV confirmé → booking_not_cancelled', (public.begin_rdv_payment_refund(:B7, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'booking_not_cancelled');
select pg_temp.ok('Paiement live depuis la sandbox → paypal_environment_mismatch', (public.begin_rdv_payment_refund(:B1, :P, null, 'sandbox', gen_random_uuid(), null)->>'error') = 'paypal_environment_mismatch');
select pg_temp.ok('Paiement sandbox depuis la prod → paypal_environment_mismatch', (public.begin_rdv_payment_refund(:B6, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'paypal_environment_mismatch');
select pg_temp.ok('Autre praticien → booking_not_found', (public.begin_rdv_payment_refund(:B1, gen_random_uuid(), null, 'live', gen_random_uuid(), null)->>'error') = 'booking_not_found');
select pg_temp.ok('Montant supérieur au paiement → refund_amount_invalid', (public.begin_rdv_payment_refund(:B1, :P, 2001, 'live', gen_random_uuid(), null)->>'error') = 'refund_amount_invalid');
select pg_temp.ok('Aucune ligne créée par les refus', (select count(*) from public.rdv_payment_refunds) = 0);

\echo '== 2. Remboursement total, double clic, rejeu =='
select pg_temp.ok('Total avant = 120 €', pg_temp.total() = 12000);
select public.begin_rdv_payment_refund(:B1, :P, null, 'live', 'dddddddd-0000-0000-0000-000000000001', null) as r1 \gset
select pg_temp.ok('Demande créée, montant 20 € fixé côté serveur', (:'r1'::jsonb->>'ok')::boolean and (:'r1'::jsonb->'refund'->>'amount_cents')::int = 2000 and (:'r1'::jsonb->'refund'->>'paypal_capture_id') = 'CAPTURE1');
select pg_temp.ok('Double clic (même clé) → rejeu, même demande', (public.begin_rdv_payment_refund(:B1, :P, null, 'live', 'dddddddd-0000-0000-0000-000000000001', null)->>'replay')::boolean);
select pg_temp.ok('Double clic (autre clé) → refund_in_progress', (public.begin_rdv_payment_refund(:B1, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'refund_in_progress');
select pg_temp.ok('Transfert pendant le remboursement → refusé', (public.transfer_rdv_deposit(:B1, :B2, :P, gen_random_uuid(), null)->>'error') = 'settlement_not_open');
select pg_temp.ok('Une seule demande', (select count(*) from public.rdv_payment_refunds) = 1);
select pg_temp.ok('État : refund_pending', (select settlement_status from public.rdv_paypal_payments where paypal_order_id = 'ORDER1') = 'refund_pending');
select pg_temp.ok('Pas d''écriture comptable tant que PayPal n''a pas confirmé', pg_temp.total() = 12000);
select pg_temp.ok('Résultat completed', (public.record_rdv_payment_refund_result((:'r1'::jsonb->'refund'->>'id')::uuid, 'completed', 'REFUND1', 'COMPLETED', null)->>'status') = 'completed');
select pg_temp.ok('Rejeu du résultat completed → idempotent', (public.record_rdv_payment_refund_result((:'r1'::jsonb->'refund'->>'id')::uuid, 'completed', 'REFUND1', 'COMPLETED', null)->>'already')::boolean);
select pg_temp.ok('Après completed : failed refusé', (public.record_rdv_payment_refund_result((:'r1'::jsonb->'refund'->>'id')::uuid, 'failed', null, null, 'x')->>'error') = 'refund_already_final');
select pg_temp.ok('Encaissement d''origine intact', (select count(*) from public.rdv_financial_entries where external_payment_ref = 'CAPTURE1' and direction = 'income' and gross_cents = 2000) = 1);
select pg_temp.ok('Une seule écriture de remboursement (contre-passation)', (select count(*) from public.rdv_financial_entries where booking_id = :B1 and direction = 'refund' and entry_kind = 'refund' and external_payment_ref = 'refund:REFUND1') = 1);
select pg_temp.ok('TVA du remboursement = TVA d''origine', (select net_cents = 1667 and vat_cents = 333 from public.rdv_financial_entries where external_payment_ref = 'refund:REFUND1'));
select pg_temp.ok('Total après = 100 € (pas de double comptage)', pg_temp.total() = 10000);
select pg_temp.ok('Payé sur le RDV annulé = 0', public.rdv_booking_paid_cents(:B1) = 0);
select pg_temp.ok('État final : refunded', (select settlement_status = 'refunded' and refunded_cents = 2000 from public.rdv_paypal_payments where paypal_order_id = 'ORDER1'));
select pg_temp.ok('Rejeu HTTP (même clé) après la fin → même demande, rien de nouveau', (public.begin_rdv_payment_refund(:B1, :P, null, 'live', 'dddddddd-0000-0000-0000-000000000001', null)->'refund'->>'status') = 'completed');
select pg_temp.ok('Nouveau remboursement → already_refunded', (public.begin_rdv_payment_refund(:B1, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'already_refunded');
select pg_temp.ok('Transfert d''arrhes remboursées → already_refunded', (public.transfer_rdv_deposit(:B1, :B2, :P, gen_random_uuid(), null)->>'error') = 'already_refunded');
select pg_temp.ok('Conserver des arrhes remboursées → refusé', (public.retain_rdv_deposit(:B1, :P, null)->>'error') = 'settlement_not_open');
select pg_temp.ok('Clé d''idempotence réutilisée sur un autre RDV → refusée', (public.begin_rdv_payment_refund(:B6, :P, null, 'sandbox', 'dddddddd-0000-0000-0000-000000000001', null)->>'error') = 'idempotency_key_reused');
select pg_temp.ok('Journal d''audit complet', (select array_agg(event order by id) from public.rdv_payment_settlement_events where payment_id = '33333333-0000-0000-0000-000000000001') = array['refund_requested','refund_completed']);

\echo '== 3. Délai réseau ambigu, échec, reprise, partiel (sandbox, B6) =='
select public.begin_rdv_payment_refund(:B6, :P, 500, 'sandbox', gen_random_uuid(), null) as r2 \gset
select pg_temp.ok('Partiel 5 € demandé', (:'r2'::jsonb->'refund'->>'amount_cents')::int = 500);
select pg_temp.ok('Délai réseau → unknown', (public.record_rdv_payment_refund_result((:'r2'::jsonb->'refund'->>'id')::uuid, 'unknown', null, null, 'paypal_timeout')->>'status') = 'unknown');
select pg_temp.ok('Nouvelle demande pendant unknown → refund_in_progress (réconciliation d''abord)', (public.begin_rdv_payment_refund(:B6, :P, 500, 'sandbox', gen_random_uuid(), null)->>'error') = 'refund_in_progress');
select pg_temp.ok('Réconciliation : PayPal avait bien remboursé → completed', (public.record_rdv_payment_refund_result((:'r2'::jsonb->'refund'->>'id')::uuid, 'completed', 'REFUND6A', 'COMPLETED', null)->>'settlement_status') = 'partially_refunded');
select public.begin_rdv_payment_refund(:B6, :P, null, 'sandbox', gen_random_uuid(), null) as r3 \gset
select pg_temp.ok('Reste à rembourser = 15 €', (:'r3'::jsonb->'refund'->>'amount_cents')::int = 1500);
select pg_temp.ok('Échec certain → failed', (public.record_rdv_payment_refund_result((:'r3'::jsonb->'refund'->>'id')::uuid, 'failed', null, 'FAILED', 'TRANSACTION_REFUSED')->>'status') = 'failed');
select pg_temp.ok('Après échec : retour à partially_refunded', (select settlement_status from public.rdv_paypal_payments where paypal_order_id = 'ORDER6') = 'partially_refunded');
select pg_temp.ok('Échec : aucune écriture comptable', (select count(*) from public.rdv_financial_entries where booking_id = :B6 and direction = 'refund') = 1);
select pg_temp.ok('Transfert d''arrhes partiellement remboursées → refusé', (public.transfer_rdv_deposit(:B6, :B2, :P, gen_random_uuid(), null)->>'error') = 'settlement_not_open');
select public.begin_rdv_payment_refund(:B6, :P, null, 'sandbox', gen_random_uuid(), null) as r4 \gset
select pg_temp.ok('PayPal PENDING → pending (id conservé)', (public.record_rdv_payment_refund_result((:'r4'::jsonb->'refund'->>'id')::uuid, 'pending', 'REFUND6C', 'PENDING', null)->>'status') = 'pending');
select pg_temp.ok('Id PayPal différent à la réconciliation → refusé', (public.record_rdv_payment_refund_result((:'r4'::jsonb->'refund'->>'id')::uuid, 'completed', 'AUTRE', 'COMPLETED', null)->>'error') = 'paypal_refund_id_mismatch');
select pg_temp.ok('Puis COMPLETED → refunded', (public.record_rdv_payment_refund_result((:'r4'::jsonb->'refund'->>'id')::uuid, 'completed', null, 'COMPLETED', null)->>'settlement_status') = 'refunded');
select pg_temp.ok('Sandbox : payé = 0, deux contre-passations (5 + 15)', public.rdv_booking_paid_cents(:B6) = 0 and (select count(*) from public.rdv_financial_entries where booking_id = :B6 and direction = 'refund') = 2);

\echo '== 4. Transfert (B7 confirmé → on l''annule d''abord) =='
update public.bookings set status = 'cancelled' where id = :B7;
select pg_temp.ok('Transfert vers un autre client → refusé', (public.transfer_rdv_deposit(:B7, :B5, :P, gen_random_uuid(), null)->>'error') = 'target_other_customer');
select pg_temp.ok('Transfert vers un RDV annulé → refusé', (public.transfer_rdv_deposit(:B7, :B1, :P, gen_random_uuid(), null)->>'error') = 'target_not_upcoming');
select pg_temp.ok('Transfert vers lui-même → refusé', (public.transfer_rdv_deposit(:B7, :B7, :P, gen_random_uuid(), null)->>'error') in ('target_is_source','target_not_upcoming'));
insert into public.rdv_balance_payments(booking_id, paypal_order_id, paypal_env, amount_cents) values (:B3, 'BALORDER3', 'live', 4000);
select pg_temp.ok('Cible avec un règlement de solde engagé chez PayPal → refusé', (public.transfer_rdv_deposit(:B7, :B3, :P, gen_random_uuid(), null)->>'error') = 'target_balance_payment_in_progress');
insert into public.rdv_balance_payments(booking_id, paypal_env, amount_cents) values (:B2, 'live', 4000);
select pg_temp.ok('Total avant transfert', pg_temp.total() = 10000 - 2000 + 0) ;
select public.transfer_rdv_deposit(:B7, :B2, :P, 'eeeeeeee-0000-0000-0000-000000000001', null) as t1 \gset
select pg_temp.ok('Transfert OK, reste dû 20 €', (:'t1'::jsonb->>'ok')::boolean and (:'t1'::jsonb->>'remaining_due_cents')::int = 2000);
select pg_temp.ok('Aucune nouvelle recette : total inchangé', pg_temp.total() = 8000);
select pg_temp.ok('Deux écritures deposit_transfer -20/+20', (select count(*) from public.rdv_financial_entries where entry_kind = 'deposit_transfer') = 2);
select pg_temp.ok('Payé RDV source = 0, RDV cible = 40 €', public.rdv_booking_paid_cents(:B7) = 0 and public.rdv_booking_paid_cents(:B2) = 4000);
select pg_temp.ok('Règlement de solde non engagé ajusté à 20 €', (select amount_cents from public.rdv_balance_payments where booking_id = :B2) = 2000);
select pg_temp.ok('Traçabilité du transfert', (select payment_id = '33333333-0000-0000-0000-000000000007' and source_booking_id = :B7 and target_booking_id = :B2 and amount_cents = 2000 and paypal_capture_id = 'CAPTURE7' and paypal_env = 'live' from public.rdv_deposit_transfers));
select pg_temp.ok('Rejeu du transfert (même clé) → idempotent', (public.transfer_rdv_deposit(:B7, :B2, :P, 'eeeeeeee-0000-0000-0000-000000000001', null)->>'replay')::boolean);
select pg_temp.ok('Second transfert → already_transferred', (public.transfer_rdv_deposit(:B7, :B3, :P, gen_random_uuid(), null)->>'error') = 'already_transferred');
select pg_temp.ok('Remboursement d''arrhes transférées → refusé', (public.begin_rdv_payment_refund(:B7, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'settlement_not_open');
select pg_temp.ok('Toujours une seule écriture par transfert', (select count(*) from public.rdv_financial_entries where entry_kind = 'deposit_transfer') = 2);

\echo '== 5. Conserver, puis plus rien n''est possible =='
update public.bookings set status = 'cancelled' where id = :B5;
select pg_temp.ok('Conserver → retained', (public.retain_rdv_deposit(:B5, :P, null)->>'settlement_status') = 'retained');
select pg_temp.ok('Conserver à nouveau → idempotent', (public.retain_rdv_deposit(:B5, :P, null)->>'already')::boolean);
select pg_temp.ok('Rembourser des arrhes conservées → refusé', (public.begin_rdv_payment_refund(:B5, :P, null, 'live', gen_random_uuid(), null)->>'error') = 'settlement_not_open');
select pg_temp.ok('Conserver : aucune écriture', pg_temp.total() = 8000);

\echo '== 6. Contraintes =='
do $$ begin
  begin update public.rdv_paypal_payments set refunded_cents = 2500 where paypal_order_id = 'ORDER2'; raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  refunded_cents > montant refusé'; end;
  begin update public.rdv_paypal_payments set settlement_status = 'refunded' where paypal_order_id = 'ORDER2'; raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  état refunded sans montant refusé'; end;
end $$;
reset role;
\echo 'TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS'
