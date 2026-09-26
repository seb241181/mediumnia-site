#!/bin/bash
# Répétition de la réconciliation de l'historique Supabase, sur un PostgreSQL local
# jetable (jamais la production). Joue exactement la séquence prévue au runbook 00 :
# migrations lancées « à la main » (comme le SQL Editor), puis `supabase migration
# repair`, chacune depuis son propre dépôt, et vérifie l'historique obtenu avec le
# runbook 04 : versions présentes / absente, historique existant intact (empreinte),
# sans jamais compter le nombre total de versions.
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

echo "== 2. Historique existant, comme en production (97 versions le 26/09/2026)"
# Versions déjà inscrites en production, simulées : 20 versions anciennes du site
# (inscrites avec leur vrai fichier) et 3 versions créées hors dépôt.
for f in $(ls "$M"/*.sql | head -20); do v=$(basename "$f" | cut -c1-14); (cd "$SITE_DIR" && "$SB" migration repair --status applied "$v" --db-url "$URL" --output-format text >/dev/null 2>&1); done
$Q -c "insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260901000000', 'hors_depot_a', array['select 1']), ('20260912000000', 'hors_depot_b', array['select 2']), ('20260920000000', 'hors_depot_c', null)"
H=$($Q -At -F'#' -f <(sed -n '/^-- H\./,$p' "$HERE/../00-historique-migrations.sql"))
LISTE=$(echo "$H" | cut -d'#' -f2); AVANT="$(echo "$H" | cut -d'#' -f1) $(echo "$H" | cut -d'#' -f3)"
echo "   bloc H avant l'opération : $AVANT (versions relevées)"

echo "== 3. Séquence prévue (étapes 2 à 6 du runbook 00)"
echo "   2. repair 20260926090000 (site)"
(cd "$SITE_DIR" && "$SB" migration repair --status applied 20260926090000 --db-url "$URL" --output-format text >/dev/null 2>&1)
echo "   3. SQL Editor : 20260926100000 (site)"
$Q -f "$M/20260926100000_formation_parcours_597.sql"
echo "   4. repair 20260926100000 (site)"
(cd "$SITE_DIR" && "$SB" migration repair --status applied 20260926100000 --db-url "$URL" --output-format text >/dev/null 2>&1)
echo "   (entre-temps, une migration sans rapport est inscrite par ailleurs)"
$Q -c "insert into supabase_migrations.schema_migrations (version, name, statements) values ('20260926110000', 'sans_rapport', array['select 3'])"
echo "   5. SQL Editor : 20260925150000 (espace élève)"
$Q -f "$APP_DIR/supabase/migrations/20260925150000_parcours_personal_pdfs_and_founder.sql"
echo "   6. repair 20260925150000 (espace élève, depuis son dépôt)"
(cd "$APP_DIR" && "$SB" migration repair --status applied 20260925150000 --db-url "$URL" --output-format text >/dev/null 2>&1)

echo "== 4. Contrôle final : runbook 04"
C1=$($Q -At -f <(sed -n '/^-- 1\./,/^-- 2\./p' "$HERE/../04-controle-historique-final.sql"))
echo "   04-1 (présentes / ancienne absente) : $C1"
[ "$C1" = "t|t|t|t" ] || { echo "   ✗ ÉCHEC 04-1"; exit 1; }
C2=$($Q -At -F' ' -f <(sed -n '/^-- 2\./,/^-- 3\./p' "$HERE/../04-controle-historique-final.sql" | sed "s/COLLER_LA_LISTE_DU_BLOC_H/$LISTE/"))
echo "   04-2 après (versions relevées, disparues, empreinte) : $C2"
[ "$C2" = "$(echo "$AVANT" | cut -d' ' -f1) 0 $(echo "$AVANT" | cut -d' ' -f2)" ] || { echo "   ✗ ÉCHEC : l'historique existant a changé"; exit 1; }
echo "   ✓ contrôle anti-faux positif : une version existante modifiée est bien détectée → $($Q -Atc "update supabase_migrations.schema_migrations set name = name || '_x' where version = '20260901000000'" >/dev/null; $Q -At -F' ' -f <(sed -n '/^-- 2\./,/^-- 3\./p' "$HERE/../04-controle-historique-final.sql" | sed "s/COLLER_LA_LISTE_DU_BLOC_H/$LISTE/") | cut -d' ' -f3 | grep -qv "$(echo "$AVANT" | cut -d' ' -f2)" && echo détectée || echo NON détectée)"
echo "   ✓ historique existant intact (versions et texte identiques) ; les 3 versions du parcours présentes ; 20260925120000 absente"
echo "   ✓ aucun comptage total : la migration sans rapport ajoutée entre-temps ne gêne pas le contrôle"

echo "== 5. Ce que verraient les outils (pour mémoire : ne jamais lancer db push)"
echo "   depuis le site, versions inscrites mais sans fichier local :"
(cd "$SITE_DIR" && "$SB" migration list --db-url "$URL" --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).migrations;console.log("     "+m.filter(x=>!x.local).map(x=>x.remote).join(", "));console.log("   depuis le site, fichiers actifs jamais inscrits : "+m.filter(x=>!x.remote).length+" ; 20260925120000 dans les fichiers actifs : "+m.some(x=>x.local==="20260925120000"))})')
echo "   db push --dry-run depuis le site :"
(cd "$SITE_DIR" && "$SB" db push --dry-run --db-url "$URL" --output-format text 2>&1 | grep -E "repair|Remote migration|not found" | head -3 | sed 's/^/     /') || true
