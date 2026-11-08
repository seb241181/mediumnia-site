#!/usr/bin/env bash
# Concurrence sur une base locale jetable (après 00_schema, la migration et 01_scenarios).
# Usage : PSQL="psql -h /tmp/rdvpg -p 5544 -U postgres -d offline_t" ./02_concurrency.sh
set -euo pipefail
PSQL=${PSQL:?PSQL requis}
A=aaaaaaaa-0000-4000-8000-000000000001
TODAY="(now() at time zone 'Europe/Paris')::date"
fail() { echo "ÉCHEC : $1"; exit 1; }

# C1. 8 connexions confirment 50 € au même instant, chacune avec sa propre demande.
BK=11111111-0000-4000-8000-000000000008
for i in 1 2 3 4 5 6 7 8; do
  $PSQL -Atc "select public.confirm_rdv_offline_payment('$A','$BK','transfer',5000,$TODAY,null,null,'race-distinct-request-0$i',null)->>'error'" &
done > /tmp/rdv-offline-c1.txt; wait
ENTRIES=$($PSQL -Atc "select count(*) from public.rdv_financial_entries where booking_id='$BK' and payment_method='transfer'")
REFUSED=$(grep -c nothing_due /tmp/rdv-offline-c1.txt || true)
[ "$ENTRIES" = 1 ] && [ "$REFUSED" = 7 ] || fail "C1 entries=$ENTRIES refused=$REFUSED"
echo "ok : C1 8 confirmations simultanées : 1 écriture, 7 refus « plus rien à régler »"

# C2. La même demande envoyée 8 fois en parallèle (double clic, réseau) : une seule écriture.
$PSQL -qc "update public.bookings set balance_paid_at = null where id = '$BK'"
BK2=11111111-0000-4000-8000-0000000000c2
$PSQL -qc "insert into public.bookings (id, practitioner_id, service_id, customer_first_name, customer_last_name, customer_email, starts_at, ends_at, booked_price_cents, reservation_payment_cents)
  values ('$BK2','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000005e','C','T','c@example.org', now()+interval '3 days', now()+interval '3 days 1 hour', 7000, 2000)"
for i in 1 2 3 4 5 6 7 8; do
  $PSQL -Atc "select coalesce(public.confirm_rdv_offline_payment('$A','$BK2','cash',7000,$TODAY,null,null,'race-same-request-00001',null)->>'replayed','error')" &
done > /tmp/rdv-offline-c2.txt; wait
ENTRIES=$($PSQL -Atc "select count(*) from public.rdv_financial_entries where booking_id='$BK2'")
FIRST=$(grep -c false /tmp/rdv-offline-c2.txt || true); REPLAY=$(grep -c true /tmp/rdv-offline-c2.txt || true)
[ "$ENTRIES" = 1 ] && [ "$FIRST" = 1 ] && [ "$REPLAY" = 7 ] || fail "C2 entries=$ENTRIES first=$FIRST replay=$REPLAY"
echo "ok : C2 même demande ×8 en parallèle : 1 écriture, 7 rejeux"

# C3. Capture PayPal du solde et confirmation de virement au même instant :
# jamais les deux (pas de double encaissement).
BK3=11111111-0000-4000-8000-000000000009
for i in 1 2 3 4; do
  $PSQL -Atc "select 'claim:'||coalesce(public.claim_rdv_balance_capture('ORDER-RACE')->>'error','ok')" &
  $PSQL -Atc "select 'confirm:'||coalesce(public.confirm_rdv_offline_payment('$A','$BK3','transfer',5000,$TODAY,null,null,'race-claim-confirm-00$i',null)->>'error','ok')" &
done > /tmp/rdv-offline-c3.txt; wait
CLAIM_OK=$(grep -c '^claim:ok' /tmp/rdv-offline-c3.txt || true)
CONFIRM_OK=$(grep -c '^confirm:ok' /tmp/rdv-offline-c3.txt || true)
ENTRIES=$($PSQL -Atc "select count(*) from public.rdv_financial_entries where booking_id='$BK3' and payment_method='transfer'")
STATUS=$($PSQL -Atc "select status from public.rdv_balance_payments where booking_id='$BK3'")
if [ "$CLAIM_OK" -ge 1 ]; then
  [ "$CONFIRM_OK" = 0 ] && [ "$ENTRIES" = 0 ] && [ "$STATUS" = capture_in_progress ] || fail "C3 capture gagnante mais virement aussi ($CONFIRM_OK)"
  echo "ok : C3 la capture PayPal a gagné : virement refusé (paiement à vérifier), aucune écriture"
else
  [ "$CONFIRM_OK" = 1 ] && [ "$ENTRIES" = 1 ] && [ "$STATUS" = order_pending ] || fail "C3 confirm=$CONFIRM_OK entries=$ENTRIES status=$STATUS"
  echo "ok : C3 le virement a gagné : capture PayPal refusée, une seule écriture"
fi
cat /tmp/rdv-offline-c3.txt | sort | uniq -c
echo "ok : concurrence"
