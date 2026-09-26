#!/bin/bash
# Reconstruit une base NEUVE uniquement avec les migrations actives des deux dépôts
# (site : supabase/migrations, espace élève : $APP_DIR/supabase/migrations), dans
# l'ordre des versions, sur un PostgreSQL local jetable (jamais la production).
# Rien n'est lu dans supabase/archive/.
#
#   PGHOST_URL=postgresql://postgres@127.0.0.1:5432 APP_DIR=../mediumnia-app \
#   bash supabase/runbooks/20260926-parcours-597/repetition/base-neuve.sh
#
# Avant les migrations : plateforme-supabase.sql (ce que Supabase fournit : rôles,
# auth, storage, extensions). pg_cron et pg_net (extensions Supabase) : copier
# extensions-simulees/* dans « $(pg_config --sharedir)/extension/ » du serveur local.
# hors-depot/ : manques constatés, objets présents en production mais créés par
# aucune migration des dépôts, rejoués juste avant la première migration qui en a besoin.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$HERE/../../../.." && pwd)"
APP_DIR="$(cd "${APP_DIR:?APP_DIR = dossier du dépôt mediumnia-app}" && pwd)"
BASE_URL="${PGHOST_URL:-postgresql://postgres@127.0.0.1:5432}"
DB="${DB:-p597_base_neuve}"
psql "$BASE_URL/postgres" -q -c "drop database if exists $DB" -c "create database $DB"
Q="psql $BASE_URL/$DB -q -v ON_ERROR_STOP=1"
$Q -f "$HERE/plateforme-supabase.sql"
n=0
for f in $( (ls "$SITE_DIR"/supabase/migrations/*.sql; ls "$APP_DIR"/supabase/migrations/*.sql) | awk -F/ '{print $NF"\t"$0}' | sort | cut -f2); do
  v=$(basename "$f" | cut -c1-14)
  if [ -f "$HERE/hors-depot/avant-$v.sql" ]; then $Q -f "$HERE/hors-depot/avant-$v.sql"; echo "  + hors dépôt avant $v"; fi
  if [ -f "$HERE/hors-depot/avant-$v.list" ]; then
    grep -v '^#' "$HERE/hors-depot/avant-$v.list" | while read -r doc; do $Q -f "$SITE_DIR/$doc"; done
    echo "  + hors dépôt avant $v ($(grep -vc '^#' "$HERE/hors-depot/avant-$v.list") fichiers docs/)"
  fi
  $Q -f "$f" > /dev/null || { echo "ÉCHEC : $(basename "$f")"; exit 1; }
  n=$((n + 1))
done
echo "OK : $n migrations actives appliquées sur une base neuve ($DB)"
