#!/usr/bin/env bash
# Usage : PGHOST=… PGPORT=… ./run.sh — base vide jetable ; aucune connexion distante.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="rdv_payment_$$"
createdb -U postgres "$db"
trap 'dropdb -U postgres "$db" >/dev/null 2>&1 || true' EXIT
for f in "$here/00_schema.sql" "$here/01_current_functions.sql" "$here/../../migrations/20261106120000_rdv_payment_reliability.sql" "$here/02_scenarios.sql"; do
  psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "$f"
done
