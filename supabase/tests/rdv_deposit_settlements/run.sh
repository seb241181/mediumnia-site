#!/bin/bash
# Base locale jetable uniquement (jamais la production).
# Usage : PGHOST=… PGPORT=… bash run.sh
set -e
DB=${SETTLE_DB:-settle}
cd "$(dirname "$0")"
dropdb --if-exists "$DB"; createdb "$DB"
P="psql -d $DB -q -v ON_ERROR_STOP=1"
$P -f schema.sql
$P -f ../../migrations/20260930230000_rdv_deposit_settlements.sql
$P -f ../../migrations/20260930230000_rdv_deposit_settlements.sql   # rejouable
$P -f seed.sql
$P -f scenarios.sql 2>&1 | grep -E "OK|ÉCHEC|ERROR|==|PASSÉS"

echo "== 7. Concurrence : deux clics simultanés (clés différentes) =="
$P -f seed.sql
A="set role service_role; select public.begin_rdv_payment_refund('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',null,'live',gen_random_uuid(),null)->>'error'"
( psql -d $DB -Atq -c "begin; $A; select pg_sleep(1); commit;" | grep -v '^$' | sed 's/^/  clic 1 : /'; echo "  clic 1 : (demande créée)" ) &
sleep 0.3
psql -d $DB -Atq -c "$A" | sed 's/^/  clic 2 : /'
wait
psql -d $DB -Atq -c "select '  demandes créées : ' || count(*) from rdv_payment_refunds"

echo "== 8. Concurrence : transfert et remboursement simultanés =="
$P -f seed.sql
psql -d $DB -q -c "update bookings set status='cancelled' where id='11111111-0000-0000-0000-000000000007'"
( psql -d $DB -Atq -c "begin; set role service_role; select '  transfert : ' || (public.transfer_rdv_deposit('11111111-0000-0000-0000-000000000007','11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',gen_random_uuid(),null)->>'ok'); select pg_sleep(1); commit;" ) &
sleep 0.3
psql -d $DB -Atq -c "set role service_role; select '  remboursement : ' || coalesce(public.begin_rdv_payment_refund('11111111-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001',null,'live',gen_random_uuid(),null)->>'error','ok')"
wait
psql -d $DB -Atq -c "select '  état final : ' || settlement_status || ', demandes de remboursement : ' || (select count(*) from rdv_payment_refunds) from rdv_paypal_payments where paypal_order_id='ORDER7'"

echo "== 9. Droits : anon / authenticated ne peuvent rien appeler ni lire =="
for role in anon authenticated; do
  psql -d $DB -Atq -c "set role $role; select public.begin_rdv_payment_refund('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',null,'live',gen_random_uuid(),null)" 2>&1 | tail -1 | sed "s/^/  $role : /"
  psql -d $DB -Atq -c "set role $role; select count(*) from rdv_payment_refunds" 2>&1 | tail -1 | sed "s/^/  $role : /"
done
