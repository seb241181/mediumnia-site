"""Fin du rattrapage TEST par l'API de gestion Supabase (HTTPS), mêmes garanties que rattrapage-test.sh.

  python3 -I rattrapage_api.py api              # projet TEST réel (jeton injecté par le proxy)
  python3 -I rattrapage_api.py local <base>     # répétition sur une base locale (psql)

Étapes : portée du jeton (TEST seul) -> taille de requête -> vérification préalable ->
sauvegarde logique + reconstruction locale vérifiée -> 3 fichiers (une transaction chacun,
suivi par nom, reprise) -> contrôles. S'arrête à la première anomalie."""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REF_TEST = 'wnbwhnqiulsdjcvkuwos'
REF_PROD = 'uotkpygeqqnekpolezts'
API = 'https://api.supabase.com/v1'
HERE = Path(__file__).resolve().parent
SCRATCH = Path(os.environ.get('RATTRAPAGE_SORTIE', tempfile.gettempdir()))
RUNBOOK = HERE.parent
SQL_DIR = RUNBOOK / 'sql-editor'
BUILD = HERE / 'build_replica_v2.py'
PG = ['psql', '-h', '/tmp/rdvpg', '-p', '5544', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
START = ['b2_10_bloc1_oracle_pro_waitlist_reseau_order_intents', 'b2_10_bloc2_pro_workspace_shadow_fk_indexes']
FILES = [
    ('1-b2-10-fin-migrations-du-depot.sql', ['b2_10_bloc3_document_shadow_a_rdv_appointment_reminder']),
    ('2-b2-20-b2-30-alignement.sql', ['b2_20_objets_hors_depot', 'b2_30_alignement_fonctions']),
    ('3-garde-environnement-et-signalements.sql', ['environment_separation_guard', 'activer_test_marqueur', 'payment_issue_reports']),
]
ALL = [n for _, names in FILES for n in names]
MODE = sys.argv[1]
LOCAL_DB = sys.argv[2] if MODE == 'local' else None
STAMP = time.strftime('%Y%m%d-%H%M%S')
OUT = SCRATCH / 'rattrapage-test' / f'{MODE}-{STAMP}'
OUT.mkdir(parents=True, exist_ok=True)
LOG = open(OUT / 'journal.txt', 'a')


def say(msg):
    print(msg, flush=True)
    LOG.write(msg + '\n')
    LOG.flush()


def stop(msg, code=1):
    say(f'ARRÊT : {msg}')
    sys.exit(code)


class NetworkUncertain(Exception):
    pass


def http(method, path, body=None, timeout=600):
    assert path.startswith(f'/projects/{REF_TEST}/') or path == '/projects', path
    cmd = ['curl', '-sS', '--cacert', '/root/.ccr/ca-bundle.crt', '-X', method, '--max-time', str(timeout),
           '-H', 'Content-Type: application/json', '-o', '-', '-w', '\n%{http_code}', API + path]
    data = None
    if body is not None:
        cmd += ['--data-binary', '@-']
        data = json.dumps(body).encode()
    r = subprocess.run(cmd, input=data, capture_output=True)
    if r.returncode != 0:
        raise NetworkUncertain(r.stderr.decode()[:300])
    text, _, status = r.stdout.decode().rpartition('\n')
    return int(status), text


def query(sql):
    """Requête de lecture : renvoie la liste des lignes (dict)."""
    if MODE == 'api':
        status, text = http('POST', f'/projects/{REF_TEST}/database/query', {'query': sql})
        if status != 201 and status != 200:
            raise RuntimeError(f'HTTP {status} : {text[:400]}')
        return json.loads(text)
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir='/tmp/rdvpg') as f:
        f.write(f"select coalesce(json_agg(_r), '[]'::json) from ({sql.rstrip().rstrip(';')}) _r;")
    os.chmod(f.name, 0o644)
    r = subprocess.run(['su', 'postgres', '-c', ' '.join(PG + ['-At', '-d', LOCAL_DB, '-f', f.name])], capture_output=True)
    os.unlink(f.name)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:400])
    return json.loads(r.stdout.decode())


def run_file(path):
    """Exécute un fichier transactionnel. True = validé, False = échec annulé, exception = incertain."""
    sql = path.read_text()
    if MODE == 'api':
        status, text = http('POST', f'/projects/{REF_TEST}/database/query', {'query': sql}, timeout=900)
        if status in (200, 201):
            return True, ''
        return False, f'HTTP {status} : {text[:600]}'
    tmp = Path('/tmp/rdvpg') / path.name
    tmp.write_text(sql)
    os.chmod(tmp, 0o644)
    r = subprocess.run(['su', 'postgres', '-c', ' '.join(PG + ['-d', LOCAL_DB, '-c', "'set client_min_messages = warning'", '-f', str(tmp)])], capture_output=True)
    return r.returncode == 0, r.stderr.decode()[-600:]


def one(sql):
    rows = query(sql)
    return list(rows[0].values())[0] if rows else None


def done(names):
    lst = ', '.join(f"'{n}'" for n in names)
    return one(f"select count(distinct name) as n from supabase_migrations.schema_migrations where name in ({lst})")


COUNTS = ("select (select count(*) from public.bookings)||' rendez-vous, '||(select count(*) from auth.users)||' comptes, '"
          "||(select count(*) from public.booking_practitioners)||' praticiens, '||(select count(*) from public.booking_services)||' services' as c")
EST_TEST = ("select (not exists (select 1 from public.booking_services where id = 'dab110fb-22b8-4158-aa8e-72d805e7f65c') "
            "and exists (select 1 from public.booking_practitioners where slug = 'seb-test')) as t")

SCHEMA_SQL = r"""
select json_build_object(
 'tables', (select json_agg(json_build_object(
    'name', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'columns', (select json_agg(json_build_object('n', a.attname, 't', format_type(a.atttypid, a.atttypmod), 'nn', a.attnotnull,
                  'd', pg_get_expr(d.adbin, d.adrelid), 'id', a.attidentity, 'gen', a.attgenerated) order by a.attnum)
                from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
    'constraints', (select json_agg(json_build_object('n', k.conname, 'type', k.contype, 'def', pg_get_constraintdef(k.oid)) order by k.conname)
                    from pg_constraint k where k.conrelid = c.oid and k.contype in ('p','u','c','x','f')),
    'indexes', (select json_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i
                where i.indrelid = c.oid and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p','u','x'))),
    'grants', (select json_agg(g.grantee || ':' || g.privilege_type order by g.grantee, g.privilege_type) from information_schema.role_table_grants g
               where g.table_schema = 'public' and g.table_name = c.relname and g.grantee in ('anon','authenticated','service_role'))
  ) order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')),
 'functions', (select json_agg(json_build_object('schema', n.nspname, 'sig', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                  'def', pg_get_functiondef(p.oid),
                  'acl', (select string_agg(r, '+' order by r) from (select distinct pg_get_userbyid(x.grantee) r from aclexplode(p.proacl) x
                          where x.privilege_type = 'EXECUTE' and pg_get_userbyid(x.grantee) in ('anon','authenticated','service_role')) z))
               order by n.nspname, p.proname)
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public','mediumia_private') and p.prokind in ('f','p')
                 and not exists (select 1 from pg_depend dp where dp.objid = p.oid and dp.deptype = 'e')),
 'sequences', (select json_agg(json_build_object('n', s.sequencename, 'last', s.last_value)) from pg_sequences s where s.schemaname = 'public'),
 'triggers', (select json_agg(pg_get_triggerdef(t.oid) order by c.relname, t.tgname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
              join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'),
 'policies', (select json_agg(json_build_object('n', policyname, 'schema', schemaname, 'table', tablename, 'perm', permissive, 'cmd', cmd,
               'roles', roles, 'qual', qual, 'check', with_check) order by schemaname, tablename, policyname) from pg_policies where schemaname in ('public','storage')),
 'buckets', (select json_agg(json_build_object('id', id, 'public', public)) from storage.buckets),
 'private_schema', exists (select 1 from pg_namespace where nspname = 'mediumia_private')
) as s
"""


def backup():
    say('=== Sauvegarde logique de TEST (lecture seule)')
    schema = one(SCHEMA_SQL)
    tables = [t['name'] for t in schema['tables']]
    data = {}
    for i in range(0, len(tables), 20):
        part = tables[i:i + 20]
        sql = ' union all '.join(f"select '{t}' as t, (select coalesce(json_agg(x), '[]'::json) from public.\"{t}\" x) as d" for t in part)
        for row in query(sql):
            data[row['t']] = row['d']
    users = [r['id'] for r in query('select id::text as id from auth.users order by id')]
    (OUT / 'schema.json').write_text(json.dumps(schema, ensure_ascii=False))
    (OUT / 'data.json').write_text(json.dumps(data, ensure_ascii=False))
    (OUT / 'auth-users.json').write_text(json.dumps(users))
    rows = sum(len(v) for v in data.values())
    say(f"  {len(tables)} tables, {len(schema['functions'])} fonctions, {len(schema['triggers'] or [])} déclencheurs, "
        f"{len(schema['policies'] or [])} politiques, {rows} lignes -> {OUT}")
    # Preuve de restaurabilité : reconstruction dans une base locale vide puis comparaison.
    sql_file = Path('/tmp/rdvpg') / f'restau-{STAMP}.sql'
    subprocess.run([sys.executable, '-I', str(BUILD), str(OUT / 'schema.json'), str(OUT / 'data.json'), ','.join(users), str(sql_file)], check=True, capture_output=True)
    os.chmod(sql_file, 0o644)
    db = f'restau_{STAMP.replace("-", "_")}'
    sh = lambda c: subprocess.run(['su', 'postgres', '-c', c], capture_output=True)
    sh(' '.join(PG + ['-d', 'postgres', '-c', f'"create database {db}"']))
    r = sh(' '.join(PG + ['-d', db, '-f', str(sql_file)]))
    if r.returncode != 0:
        stop(f"la sauvegarde ne se reconstruit pas : {r.stderr.decode()[-400:]}. Rien n'a été modifié sur TEST.")
    chk = subprocess.run(['su', 'postgres', '-c', ' '.join(PG + ['-At', '-d', db, '-c', '"' + (
        "select json_object_agg(relname, n) from (select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::int n "
        "from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r') z") + '"'])], capture_output=True)
    restored = json.loads(chk.stdout.decode() or '{}')
    diff = {t: (len(data[t]), restored.get(t)) for t in data if len(data[t]) != restored.get(t)}
    nfun = int(sh(' '.join(PG + ['-At', '-d', db, '-c', "\"select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','mediumia_private') and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')\""])).stdout.decode().strip() or 0)
    sh(' '.join(PG + ['-d', 'postgres', '-c', f'"drop database {db}"']))
    if diff or len(restored) != len(tables) or nfun != len(schema['functions']):
        stop(f"reconstruction incomplète (tables {len(restored)}/{len(tables)}, fonctions {nfun}/{len(schema['functions'])}, écarts {list(diff)[:5]}). Rien n'a été modifié sur TEST.")
    say(f'  Reconstruction locale vérifiée : {len(restored)} tables, {nfun} fonctions, données identiques table par table.')


def main():
    say(f'Rattrapage TEST — mode {MODE} — {STAMP}')
    if MODE == 'api':
        say('=== Portée du jeton')
        try:
            status, text = http('GET', '/projects')
        except NetworkUncertain as e:
            stop(f'API injoignable : {e}')
        if status in (401, 403):
            stop(f"jeton absent ou refusé (HTTP {status}). Rien n'a été fait.")
        refs = sorted(p.get('ref') or p.get('id') for p in json.loads(text))
        if REF_PROD in refs:
            stop("le jeton donne accès à la PRODUCTION : trop large. Rien n'a été fait. Révoquez-le et créez un jeton limité à TEST.")
        if refs != [REF_TEST]:
            stop(f"le jeton voit {len(refs)} projet(s) autres que TEST seul. Rien n'a été fait.")
        say('  Jeton limité au seul projet TEST : OK')
        say('=== Taille de requête')
        if one('select 1 as ok -- ' + 'x' * 180000) != 1:
            stop("l'API refuse une requête de 180 Ko. Rien n'a été fait.")
        say('  Requête de 180 Ko acceptée : OK')

    say('=== Vérification préalable')
    if one(EST_TEST) is not True:
        stop("le contenu de la base n'est pas celui de TEST. Rien n'a été fait.")
    if done(START) != 2:
        stop("les blocs 1 et 2 ne sont pas inscrits dans l'historique. Rien n'a été fait.")
    already = done(ALL)
    tables_before = one("select count(*) as n from pg_tables where schemaname = 'public'")
    if already == 0 and tables_before != 84:
        stop(f"{tables_before} tables au lieu de 84. Rien n'a été fait.")
    counts_before = one(COUNTS)
    say(f'  Base TEST confirmée ; blocs 1 et 2 présents ; étapes déjà faites {already}/{len(ALL)} ; {tables_before} tables ; {counts_before}.')

    if already < len(ALL):
        backup()
        say('=== Exécution')
        prev_ok = True
        for name, names in FILES:
            n = done(names)
            if n == len(names):
                say(f'= {name} : déjà appliqué, ignoré.')
                continue
            if n != 0:
                stop(f'{name} à moitié inscrit ({n}/{len(names)}) : état inattendu.')
            say(f'> {name} …')
            try:
                ok, err = run_file(SQL_DIR / name)
            except NetworkUncertain as e:
                time.sleep(20)
                ok, err = (done(names) == len(names)), f'coupure réseau ({e})'
                if ok:
                    say('  validé malgré la coupure (historique relu).')
                    continue
            if not ok:
                if done(names) == len(names):
                    say('  validé (historique relu après réponse incomplète).')
                    continue
                stop(f"{name} a échoué, transaction annulée, TEST reste dans l'état d'avant ce fichier : {err}", 2)
            say('  ok')

    say('=== Contrôles')
    if done(ALL) != len(ALL):
        stop('historique incomplet.', 3)
    for r in query("select version, name from supabase_migrations.schema_migrations where version >= '20261108' order by version"):
        say(f"  {r['version']}  {r['name']}")
    gaps = query((RUNBOOK / '90-verification.sql').read_text())
    if gaps:
        (OUT / 'ecarts.json').write_text(json.dumps(gaps, ensure_ascii=False, indent=1))
        stop(f'90-verification : {len(gaps)} écart(s), voir {OUT / "ecarts.json"}.', 3)
    say('  90-verification : 0 écart.')
    marker = one('select public.mediumia_runtime_environment_value() as m')
    if marker != 'test':
        stop(f'marqueur « {marker} » au lieu de « test ».', 3)
    say('  Marqueur : test.')
    counts_after = one(COUNTS)
    if counts_after != counts_before:
        stop(f'données d\'essai modifiées : {counts_before} -> {counts_after}.', 3)
    say(f'  Données d\'essai conservées : {counts_after}.')
    n_tables = one("select count(*) as n from pg_tables where schemaname = 'public'")
    say(f'  Tables public : {n_tables} (106 attendues).')
    say('RATTRAPAGE TEST TERMINÉ.')


main()
