#!/usr/bin/env bash
# Rattrapage de la base TEST MediumIA (wnbwhnqiulsdjcvkuwos) — à lancer depuis un Mac.
#
#   bash rattrapage-test.sh
#
# 1. Vérification préalable : bon projet, base TEST, bloc 1 présent, état connu.
# 2. Sauvegarde restaurable (pg_dump) vérifiée, avant toute modification.
# 3. Confirmation explicite (taper TEST).
# 4. Les 3 fichiers de sql-editor/ (état de départ : blocs 1 et 2 déjà appliqués), chacun en une seule transaction, dans l'ordre.
#    Un fichier déjà inscrit dans supabase_migrations.schema_migrations est ignoré :
#    en cas d'interruption, relancer simplement le script reprend au bon endroit.
# 5. Contrôles après exécution : historique, 90-verification (0 écart attendu),
#    marqueur « test », données d'essai conservées.
#
# Le mot de passe est demandé sans affichage, n'est jamais écrit sur disque ni
# dans le journal. Toute base autre que TEST est refusée (et la Production l'est
# deux fois : par l'adresse et par le contenu de la base).
set -euo pipefail

REF_TEST="wnbwhnqiulsdjcvkuwos"
REF_PROD="uotkpygeqqnekpolezts"
DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_DIR="$DIR/sql-editor"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${MEDIUMIA_OUT:-$HOME/mediumia-rattrapage-test}"
mkdir -p "$OUT"
LOG="$OUT/journal-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

# Fichier | étapes inscrites dans l'historique (par nom)
FILES=(
  "1-b2-10-fin-migrations-du-depot.sql|b2_10_bloc3_document_shadow_a_rdv_appointment_reminder"
  "2-b2-20-b2-30-alignement.sql|b2_20_objets_hors_depot b2_30_alignement_fonctions"
  "3-garde-environnement-et-signalements.sql|environment_separation_guard activer_test_marqueur payment_issue_reports"
)
ALL_STEPS="b2_10_bloc3_document_shadow_a_rdv_appointment_reminder b2_20_objets_hors_depot b2_30_alignement_fonctions environment_separation_guard activer_test_marqueur payment_issue_reports"
START_STEPS="b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents b2_10_bloc2_pro_workspace_shadow_fk_indexes"
TOTAL=6

stop() { echo; echo "ARRÊT : $1"; echo "Journal : $LOG"; exit "${2:-1}"; }
step() { echo; echo "=== $1"; }

# --- Outils PostgreSQL (Homebrew libpq ou Postgres.app) ----------------------
for d in "" /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin /Applications/Postgres.app/Contents/Versions/latest/bin; do
  if [ -z "$d" ]; then command -v psql >/dev/null 2>&1 && command -v pg_dump >/dev/null 2>&1 && break
  elif [ -x "$d/psql" ] && [ -x "$d/pg_dump" ]; then PATH="$d:$PATH"; break; fi
done
command -v psql >/dev/null 2>&1 || stop "psql introuvable. Installez-le : brew install libpq"
DUMP_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
for f in "${FILES[@]}"; do [ -f "$SQL_DIR/${f%%|*}" ] || stop "fichier manquant : sql-editor/${f%%|*}"; done
[ -f "$DIR/90-verification.sql" ] || stop "fichier manquant : 90-verification.sql"

# --- Connexion -----------------------------------------------------------------
step "Connexion au projet TEST"
URI="${TEST_DB_URI:-}"
if [ -z "$URI" ]; then
  echo "Supabase > projet « MediumIA RDV PayPal Test » > Connect > Session pooler > URI."
  read -r -p "Collez l'URI (laissez [YOUR-PASSWORD] tel quel) : " URI
fi
case "$URI" in *"$REF_PROD"*) stop "cette adresse est celle de la PRODUCTION. Rien n'a été fait." ;; esac
RE='^postgres(ql)?://([^:@/]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)'
[[ "$URI" =~ $RE ]] || stop "URI non reconnue (attendu : postgresql://utilisateur:motdepasse@hôte:port/postgres)."
DB_USER="${BASH_REMATCH[2]}"; URI_PASS="${BASH_REMATCH[4]}"; DB_HOST="${BASH_REMATCH[5]}"
DB_PORT="${BASH_REMATCH[7]:-5432}"; DB_NAME="${BASH_REMATCH[8]}"
LOCAL_REHEARSAL=0
if [ "$DB_USER" = "postgres.$REF_TEST" ] || [ "$DB_HOST" = "db.$REF_TEST.supabase.co" ]; then :
elif [ "${MEDIUMIA_REPETITION_LOCALE:-0}" = "1" ] && { [ "$DB_HOST" = "localhost" ] || [ "${DB_HOST#%2F}" != "$DB_HOST" ]; }; then
  LOCAL_REHEARSAL=1; DB_HOST="$(printf '%s' "$DB_HOST" | sed 's/%2F/\//g')"
else
  stop "cette adresse ne désigne pas le projet TEST $REF_TEST. Rien n'a été fait."
fi
if [ -z "$URI_PASS" ] || [ "$URI_PASS" = "[YOUR-PASSWORD]" ]; then
  if [ -z "${PGPASSWORD:-}" ]; then read -r -s -p "Mot de passe de la base TEST (non affiché) : " PGPASSWORD; echo; fi
else
  PGPASSWORD="$URI_PASS"
fi
unset URI URI_PASS TEST_DB_URI
export PGPASSWORD PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGDATABASE="$DB_NAME"
export PGAPPNAME="mediumia-rattrapage-test" PGCONNECT_TIMEOUT=20
[ "$LOCAL_REHEARSAL" = "1" ] || export PGSSLMODE=require
echo "Hôte : $DB_HOST — utilisateur : $DB_USER — base : $DB_NAME"

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { "${PSQL[@]}" -At -c "$1"; }
applied_count() { # nombre d'étapes de la liste déjà inscrites (par nom)
  local list="" v; for v in $1; do list="$list,'$v'"; done
  q "select count(distinct name) from supabase_migrations.schema_migrations where name in (${list#,})"
}

# --- 1. Vérification préalable ---------------------------------------------------
step "1/5 Vérification préalable"
q "select 1" >/dev/null || stop "connexion impossible (mot de passe, réseau ou URI)."
SERVER_MAJOR="$(q "select current_setting('server_version_num')::int / 10000")"
[ "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ] || stop "pg_dump $DUMP_MAJOR plus ancien que la base (PostgreSQL $SERVER_MAJOR) : brew upgrade libpq, puis relancer. Rien n'a été fait."
EST_TEST="$(q "select not exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c') and exists (select 1 from public.booking_practitioners where slug = 'seb-test')")"
[ "$EST_TEST" = "t" ] || stop "le contenu de la base n'est pas celui de TEST. Rien n'a été fait."
MARKER="absent"
if [ "$(q "select to_regclass('public.mediumia_runtime_environment') is not null")" = "t" ]; then
  MARKER="$(q "select coalesce((select environment from public.mediumia_runtime_environment limit 1), 'vide')")"
fi
[ "$MARKER" != "production" ] || stop "la base porte le marqueur « production ». Rien n'a été fait."
[ "$(applied_count "$START_STEPS")" = "2" ] || stop "les blocs 1 et 2 ne sont pas tous deux inscrits dans l'historique : état inattendu."
DONE="$(applied_count "$ALL_STEPS")"
TABLES_BEFORE="$(q "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$DONE" = "0" ] && [ "$TABLES_BEFORE" != "84" ]; then
  stop "$TABLES_BEFORE tables dans public au lieu de 84 attendues après le bloc 2 : état inattendu, rien n'a été fait."
fi
COUNTS_SQL="select (select count(*) from public.bookings)||' rendez-vous, '||(select count(*) from auth.users)||' comptes, '||(select count(*) from public.booking_practitioners)||' praticiens, '||(select count(*) from public.booking_services)||' services'"
COUNTS_BEFORE="$(q "$COUNTS_SQL")"
echo "Base TEST confirmée. Marqueur : $MARKER. Blocs 1 et 2 : présents. Étapes restantes déjà faites : $DONE/$TOTAL."
echo "Tables public : $TABLES_BEFORE. Données d'essai : $COUNTS_BEFORE."
if [ "$DONE" = "$TOTAL" ]; then echo "Tout est déjà appliqué : passage direct aux contrôles."; fi

# --- 2. Sauvegarde ------------------------------------------------------------------
if [ "$DONE" != "$TOTAL" ]; then
  step "2/5 Sauvegarde de TEST avant modification"
  BACKUP="$OUT/sauvegarde-test-$STAMP.dump"
  SCHEMAS=(-n public -n supabase_migrations)
  [ "$(q "select count(*) from pg_namespace where nspname = 'mediumia_private'")" = "1" ] && SCHEMAS+=(-n mediumia_private)
  pg_dump -Fc "${SCHEMAS[@]}" -f "$BACKUP" || stop "sauvegarde impossible : rien n'a été modifié."
  ENTRIES="$(pg_restore --list "$BACKUP" | grep -c 'TABLE DATA' || true)"
  [ "$ENTRIES" -gt 50 ] || stop "sauvegarde incomplète ($ENTRIES tables de données) : rien n'a été modifié."
  pg_dump -s "${SCHEMAS[@]}" -f "$OUT/schema-avant-$STAMP.sql" || true
  SUM="$( (shasum -a 256 "$BACKUP" 2>/dev/null || sha256sum "$BACKUP") | cut -d' ' -f1)"
  echo "Sauvegarde : $BACKUP"
  echo "  $ENTRIES tables de données, $(wc -c < "$BACKUP" | tr -d ' ') octets, sha256 $SUM"

  # --- 3. Confirmation ------------------------------------------------------------
  step "3/5 Confirmation"
  echo "Vont être appliqués sur TEST ($REF_TEST), chacun en une transaction :"
  for f in "${FILES[@]}"; do
    n="$(applied_count "${f#*|}")"; [ "$n" = "0" ] && echo "  - ${f%%|*}" || echo "  - ${f%%|*} (déjà fait, ignoré)"
  done
  ANSWER="${MEDIUMIA_CONFIRMATION:-}"
  [ -n "$ANSWER" ] || read -r -p "Tapez TEST pour lancer, autre chose pour annuler : " ANSWER
  [ "$ANSWER" = "TEST" ] || stop "annulé à votre demande. Rien n'a été modifié." 0

  # --- 4. Exécution ---------------------------------------------------------------
  step "4/5 Exécution"
  for f in "${FILES[@]}"; do
    file="${f%%|*}"; versions="${f#*|}"; total="$(echo $versions | wc -w | tr -d ' ')"
    n="$(applied_count "$versions")"
    if [ "$n" = "$total" ]; then echo "= $file : déjà appliqué, ignoré."; continue; fi
    [ "$n" = "0" ] || stop "$file à moitié inscrit ($n/$total) : état inattendu, ne rien relancer, me contacter."
    echo "> $file … (peut prendre une à deux minutes)"
    if "${PSQL[@]}" -c "set client_min_messages = warning" -c "set statement_timeout = 0" -c "set lock_timeout = '60s'" -f "$SQL_DIR/$file" >/dev/null; then
      echo "  ok"
    else
      # Coupure après validation ? L'inscription fait partie de la même transaction.
      if [ "$(applied_count "$versions")" = "$total" ]; then echo "  ok (validé malgré la coupure)"; continue; fi
      stop "$file a échoué : sa transaction est annulée, TEST est resté dans l'état d'avant ce fichier. Relancez le script après correction : il reprendra à ce fichier." 2
    fi
  done
fi

# --- 5. Contrôles ---------------------------------------------------------------------
step "5/5 Contrôles après exécution"
[ "$(applied_count "$ALL_STEPS")" = "$TOTAL" ] || stop "historique incomplet." 3
"${PSQL[@]}" -At -c "select '  '||version||'  '||name from supabase_migrations.schema_migrations where version >= '20261108' order by version"
GAPS="$("${PSQL[@]}" -At -f "$DIR/90-verification.sql")"
if [ -n "$GAPS" ]; then
  echo "$GAPS" > "$OUT/ecarts-$STAMP.txt"
  stop "90-verification : $(printf '%s\n' "$GAPS" | wc -l | tr -d ' ') écart(s), détail dans $OUT/ecarts-$STAMP.txt. Ne rien relancer, me transmettre ce fichier." 3
fi
echo "90-verification : 0 écart."
MARKER_AFTER="$(q "select public.mediumia_runtime_environment_value()")"
[ "$MARKER_AFTER" = "test" ] || stop "marqueur « $MARKER_AFTER » au lieu de « test »." 3
echo "Marqueur d'environnement : test."
COUNTS_AFTER="$(q "$COUNTS_SQL")"
[ "$COUNTS_AFTER" = "$COUNTS_BEFORE" ] || stop "données d'essai modifiées : avant « $COUNTS_BEFORE », après « $COUNTS_AFTER »." 3
echo "Données d'essai conservées : $COUNTS_AFTER."
echo "Tables public : $(q "select count(*) from pg_tables where schemaname = 'public'") (106 attendues)."
echo
echo "RATTRAPAGE TEST TERMINÉ. Journal : $LOG"
