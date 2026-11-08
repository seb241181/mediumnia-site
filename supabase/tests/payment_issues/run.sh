#!/usr/bin/env bash
# Base locale jetable uniquement. Usage : PSQLBASE="psql -h <socket> -p <port> -U postgres" ROOT=<dépôt> ./run.sh
set -euo pipefail
P="${PSQLBASE:?} -v ON_ERROR_STOP=1 -q"
R=${ROOT:?}
${PSQLBASE} -qc "drop database if exists pay_issue" -d postgres; ${PSQLBASE} -qc "create database pay_issue" -d postgres
$P -d pay_issue -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END \$\$;"
$P -d pay_issue -f $R/supabase/migrations/20261108140000_payment_issue_reports.sql
$P -d pay_issue -f $R/supabase/tests/payment_issues/01_scenarios.sql 2>&1 | grep -E "ok :|ÉCHEC" | sed 's/.*NOTICE:  //'
# Concurrence : 8 envois identiques simultanés (double clic, réseau) → une seule ligne.
for i in 1 2 3 4 5 6 7 8; do
  ${PSQLBASE} -d pay_issue -Atc "select public.submit_payment_issue_report('race@example.org','double_charge',null,'rdv_balance','capture','8AB12345CD678901E',now(),'/rdv/solde','desktop',repeat('7',64),now())->>'duplicate'" &
done > /tmp/pay-issue-race.txt; wait
N=$(${PSQLBASE} -d pay_issue -Atc "select count(*) from public.payment_issue_reports where contact_email='race@example.org'")
[ "$N" = 1 ] && [ "$(grep -c true /tmp/pay-issue-race.txt)" = 7 ] || { echo "ÉCHEC : concurrence ($N lignes)"; exit 1; }
echo "ok : 8 envois simultanés identiques → 1 signalement, 7 doublons"
$P -d pay_issue -f $R/supabase/migrations/20261108140000_payment_issue_reports.sql >/dev/null && echo "ok : migration rejouable"
