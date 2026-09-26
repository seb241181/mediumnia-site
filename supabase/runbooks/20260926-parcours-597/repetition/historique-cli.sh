#!/bin/bash
# Répétition de la réconciliation de l'historique Supabase, sur un PostgreSQL local
# jetable (jamais la production). Joue exactement la séquence prévue au runbook 00 :
# migrations lancées « à la main » (comme le SQL Editor), puis `supabase migration
# repair`, chacune depuis son propre dépôt, et vérifie l'historique obtenu.
#
#   PGHOST_URL=postgresql://postgres@127.0.0.1:5432 SUPABASE=supabase \
#   APP_DIR=../mediumnia-app bash supabase/runbooks/20260926-parcours-597/repetition/historique-cli.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$HERE/../../../.." && pwd)"
APP_DIR="$(cd "${APP_DIR:?APP_DIR = dossier du dépôt mediumnia-app}" && pwd)"
SB="${SUPABASE:-supabase}"
BASE_URL="${PGHOST_URL:-postgresql://postgres@127.0.0.1:5432}"
DB=p597_historique
URL="$BASE_URL/$DB?sslmode=disable"
P="psql $BASE_URL/postgres -v ON_ERROR_STOP=1 -q"
Q="psql $BASE_URL/$DB -v ON_ERROR_STOP=1 -q"
M="$SITE_DIR/supabase/migrations"

$P -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
$Q -f "$HERE/base-type-production.sql"
$Q -f "$M/20260909133000_mediumia_paypal_order_intents.sql"
# État de la production aujourd'hui : crédit 568 appliqué au SQL Editor, rien dans l'historique.
$Q -f "$M/20260926090000_decouverte_credit_568.sql" > /dev/null

echo "== 1. Preuve : repair n'exécute AUCUNE SQL (base témoin sans le crédit)"
$P -c "drop database if exists ${DB}_temoin" -c "create database ${DB}_temoin" 2>/dev/null
psql "$BASE_URL/${DB}_temoin" -q -v ON_ERROR_STOP=1 -f "$HERE/base-type-production.sql"
psql "$BASE_URL/${DB}_temoin" -q -v ON_ERROR_STOP=1 -f "$M/20260909133000_mediumia_paypal_order_intents.sql"
(cd "$SITE_DIR" && "$SB" migration repair --status applied 20260926090000 --db-url "$BASE_URL/${DB}_temoin?sslmode=disable" --output-format text >/dev/null 2>&1)
echo "   colonnes du crédit sur la base témoin après repair (attendu 0) : $(psql "$BASE_URL/${DB}_temoin" -Atc "select count(*) from information_schema.columns where table_name = 'mediumia_paypal_order_intents' and column_name like 'upgrade_credit%'")"
echo "   ligne d'historique écrite : $(psql "$BASE_URL/${DB}_temoin" -Atc "select version || ' ' || name || ' (' || array_length(statements, 1) || ' instructions recopiées du fichier, non exécutées)' from supabase_migrations.schema_migrations")"

echo "== 2. Séquence prévue (étapes 2 à 6 du runbook 00)"
echo "   2. repair 20260926090000 (site)"
(cd "$SITE_DIR" && "$SB" migration repair --status applied 20260926090000 --db-url "$URL" --output-format text >/dev/null 2>&1)
echo "   3. SQL Editor : 20260926100000 (site)"
$Q -f "$M/20260926100000_formation_parcours_597.sql"
echo "   4. repair 20260926100000 (site)"
(cd "$SITE_DIR" && "$SB" migration repair --status applied 20260926100000 --db-url "$URL" --output-format text >/dev/null 2>&1)
echo "   5. SQL Editor : 20260925150000 (espace élève)"
$Q -f "$APP_DIR/supabase/migrations/20260925150000_parcours_personal_pdfs_and_founder.sql"
echo "   6. repair 20260925150000 (espace élève, depuis son dépôt)"
(cd "$APP_DIR" && "$SB" migration repair --status applied 20260925150000 --db-url "$URL" --output-format text >/dev/null 2>&1)

echo "== 3. Historique final"
$Q -Atc "select version || '  ' || name from supabase_migrations.schema_migrations order by version" | sed 's/^/   /'
FINAL=$($Q -Atc "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations")
[ "$FINAL" = "20260925150000,20260926090000,20260926100000" ] && echo "   ✓ exactement les 3 versions attendues ; 20260925120000 absente" || { echo "   ✗ ÉCHEC historique : $FINAL"; exit 1; }

echo "== 4. Ce que verraient les outils (pour mémoire : ne jamais lancer db push)"
echo "   depuis le site, versions inscrites mais sans fichier local :"
(cd "$SITE_DIR" && "$SB" migration list --db-url "$URL" --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).migrations;console.log("     "+m.filter(x=>!x.local).map(x=>x.remote).join(", "));console.log("   depuis le site, fichiers jamais inscrits : "+m.filter(x=>!x.remote).length+" (dont 20260925120000 : "+m.some(x=>x.local==="20260925120000"&&!x.remote)+")")})')
echo "   db push --dry-run depuis le site :"
(cd "$SITE_DIR" && "$SB" db push --dry-run --db-url "$URL" --output-format text 2>&1 | grep -E "repair|Remote migration|not found" | head -3 | sed 's/^/     /') || true
