#!/bin/bash
# Base locale jetable uniquement (jamais la production). PGHOST/PGPORT vers un PostgreSQL 16 de test.
set -e
DB=${LUMIA_DB:-lumia}
cd "$(dirname "$0")"
ROOT=../../..
dropdb --if-exists "$DB"; createdb "$DB"
P="psql -d $DB -q -v ON_ERROR_STOP=1"
$P -f schema.sql
$P -f $ROOT/docs/rdv-requests-migration.sql 2>&1 | grep -v NOTICE || true
$P -f $ROOT/docs/rdv-confirm-request-migration.sql
$P -c "grant all on all tables in schema public to service_role"
for pass in 1 2; do   # deux passages : migrations rejouables
  $P -f $ROOT/supabase/migrations/20261002085000_mediumia_customers.sql
  $P -f $ROOT/supabase/migrations/20261002090000_lumia_rdv_intake.sql
done
$P -f seed.sql
$P -f scenarios.sql 2>&1 | grep -E "OK|ÉCHEC|ERROR|==|PASSÉS"

echo "== 7. Concurrence : le même message reçu deux fois en même temps =="
$P -f seed.sql
CALL="set role service_role; select public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', '{\"agent\":\"lumia\",\"channel\":\"imessage\",\"message_id\":\"MSG-RACE\",\"conversation_id\":\"CONV-R\",\"first_name\":\"Course\",\"phone\":\"0600000099\"}')->>'outcome'"
for i in 1 2 3 4 5; do ( psql -d $DB -Atq -c "$CALL" | sed "s/^/  appel $i : /" ) & done
wait
psql -d $DB -Atq -c "select '  demandes : ' || count(*) from booking_requests where source_message_id = 'MSG-RACE'; select '  événements : ' || count(*) from booking_request_intake_events where source_message_id = 'MSG-RACE'"

echo "== 8. Concurrence : deux messages différents de la même conversation =="
for i in A B; do ( psql -d $DB -Atq -c "set role service_role; select public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', '{\"agent\":\"lumia\",\"channel\":\"sms\",\"message_id\":\"MSG-$i\",\"conversation_id\":\"CONV-PAR\",\"phone\":\"0600000077\"}')->>'outcome'" | sed "s/^/  message $i : /" ) & done
wait
psql -d $DB -Atq -c "select '  demandes pour la conversation : ' || count(*) from booking_requests where source_conversation_id = 'CONV-PAR'"

echo "== 9. Droits : anon / authenticated =="
for role in anon authenticated; do
  psql -d $DB -Atq -c "set role $role; select public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', '{}')" 2>&1 | tail -1 | sed "s/^/  $role : /"
  psql -d $DB -Atq -c "set role $role; select count(*) from booking_request_intake_events" 2>&1 | tail -1 | sed "s/^/  $role : /"
  psql -d $DB -Atq -c "set role $role; select count(*) from mediumia_customers" 2>&1 | tail -1 | sed "s/^/  $role : /"
  psql -d $DB -Atq -c "set role $role; select public.upsert_mediumia_customer(null,'reservio','x',null,null,'a@b.fr',null,null)" 2>&1 | tail -1 | sed "s/^/  $role : /"
  psql -d $DB -Atq -c "set role $role; select count(*) from mediumia_customer_consents" 2>&1 | tail -1 | sed "s/^/  $role : /"
done
