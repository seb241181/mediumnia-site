#!/usr/bin/env bash
# Base locale jetable uniquement. Usage : PSQLBASE="psql -h /tmp/rdvpg -p 5544 -U postgres" ROOT=<dépôt> ./run.sh
set -euo pipefail
P="${PSQLBASE:?} -v ON_ERROR_STOP=1 -q"
R=${ROOT:?}
M=$R/supabase/migrations/20261108130000_environment_separation_guard.sql
B=$R/supabase/runbooks/20261108-environment-separation
T=$R/supabase/tests/environment_separation
for db in env_prod env_test; do ${PSQLBASE} -qc "drop database if exists $db" -d postgres; ${PSQLBASE} -qc "create database $db" -d postgres; done

echo "== Base « Production »"
$P -d env_prod -f $T/00_schema.sql
$P -d env_prod -f $B/controle-avant.sql >/dev/null
$P -d env_prod -f $M
$P -d env_prod -f $T/01_production.sql 2>&1 | grep -E "ok :|ÉCHEC" | sed 's/.*NOTICE:  //'
if $P -d env_prod -f $B/activer-test.sql >/dev/null 2>&1; then echo "ÉCHEC : activer-test accepté sur la Production"; exit 1; fi
echo "ok : activer-test.sql refusé sur la base de Production"
$P -d env_prod -f $B/activer-production.sql >/dev/null
$P -d env_prod -f $T/02_production_active.sql 2>&1 | grep -E "ok :|ÉCHEC" | sed 's/.*NOTICE:  //'
$P -d env_prod -f $M >/dev/null && echo "ok : migration rejouable (marqueur et données conservés)"
$P -d env_prod -At -c "select 'ok : marqueur après rejeu = '||environment from public.mediumia_runtime_environment"

if $P -d env_prod -f $B/retour-arriere.sql >/dev/null 2>&1; then echo "ÉCHEC : retour arrière sans confirmation"; exit 1; fi
echo "ok : retour arrière refusé sans confirmation explicite"
$P -d env_prod -c "SET mediumia.confirm_guard_removal = 'oui'" -f $B/retour-arriere.sql >/dev/null
$P -d env_prod -At -c "select 'ok : retour arrière confirmé, déclencheurs restants = '||count(*) from pg_trigger where tgname like 'zz_mediumia_no_sandbox%'"
$P -d env_prod -f $M >/dev/null && $P -d env_prod -At -c "select 'ok : réapplication après retour arrière, déclencheurs = '||count(*) from pg_trigger where tgname like 'zz_mediumia_no_sandbox%'"

echo "== Base « TEST »"
$P -d env_test -f $T/00_schema.sql
$P -d env_test -f $M
$P -d env_test -c "insert into public.booking_services values ('dab110fb-22b8-4158-aa8e-72d805e7f65c')" >/dev/null
if $P -d env_test -f $B/activer-test.sql >/dev/null 2>&1; then echo "ÉCHEC : activer-test accepté avec un identifiant de Production"; exit 1; fi
echo "ok : activer-test.sql refuse une base qui contient des données de Production"
$P -d env_test -c "delete from public.booking_services" >/dev/null
if $P -d env_test -f $B/activer-production.sql >/dev/null 2>&1; then echo "ÉCHEC : activer-production accepté sur TEST"; exit 1; fi
echo "ok : activer-production.sql refusé sur la base TEST"
$P -d env_test -f $B/activer-test.sql >/dev/null
$P -d env_test -f $T/03_test_db.sql 2>&1 | grep -E "ok :|ÉCHEC" | sed 's/.*NOTICE:  //'
echo "ok : garde SQL"
