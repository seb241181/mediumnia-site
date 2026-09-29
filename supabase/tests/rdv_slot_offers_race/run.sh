#!/bin/bash
# Base locale jetable : PGHOST/PGPORT pointent vers un PostgreSQL 16 de test (jamais la prod).
P="psql -d ${RACE_DB:-race} -At -q"
cd "$(dirname "$0")"
OFFER=cccccccc-0000-0000-0000-000000000001
PRACT=aaaaaaaa-0000-0000-0000-000000000001
state() { $P -c "select 'offre=' || o.status || ' hold=' || h.status || ' paiement=' || p.status from booking_slot_offers o, rdv_booking_holds h, rdv_paypal_payments p where p.hold_id = h.id"; }

echo "== A. La capture réclame d'abord, l'annulation arrive pendant =="
$P -f seed.sql
( $P -c "begin; set role service_role; select 'capture: ' || public.claim_rdv_deposit_capture('ORDER1')::text; select pg_sleep(2); commit;" ) &
sleep 0.5
$P -c "set role service_role; select 'annulation: ' || public.cancel_slot_offer('$OFFER','$PRACT')::text"
wait; state

echo "== B. L'annulation verrouille d'abord, la capture arrive pendant =="
$P -f seed.sql
( $P -c "begin; set role service_role; select 'annulation: ' || public.cancel_slot_offer('$OFFER','$PRACT')::text; select pg_sleep(2); commit;" ) &
sleep 0.5
$P -c "set role service_role; select 'capture: ' || public.claim_rdv_deposit_capture('ORDER1')::text"
wait; state

echo "== C. Ordre PayPal créé avant expiration, approuvé après =="
$P -f seed.sql
$P -c "update booking_slot_offers set expires_at = now() - interval '1 minute'"
$P -c "set role service_role; select 'capture: ' || public.claim_rdv_deposit_capture('ORDER1')::text" 2>&1 | sed 's/^/  /'
$P -c "set role service_role; select 'libération: ' || public.release_slot_offer_hold('ORDER1')::text"
state

echo "== D. Lien valable : la capture passe, puis l'annulation est refusée =="
$P -f seed.sql
$P -c "set role service_role; select 'capture: ' || public.claim_rdv_deposit_capture('ORDER1')::text"
$P -c "set role service_role; select 'annulation: ' || public.cancel_slot_offer('$OFFER','$PRACT')::text"
state

echo "== E. Droits : anon ne peut rien appeler =="
$P -c "set role anon; select public.cancel_slot_offer('$OFFER','$PRACT')" 2>&1 | sed 's/^/  /'
$P -c "set role anon; select public.release_slot_offer_hold('ORDER1')" 2>&1 | sed 's/^/  /'
