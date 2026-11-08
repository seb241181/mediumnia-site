"""Construit une réplique locale de la base TEST (schéma + données) à partir des
sauvegardes logiques schema-test-20261108.json et data-test-20261108.json.
Sert à la répétition à blanc du rattrapage et prouve la restaurabilité de TEST."""
import json, sys

schema = json.load(open(sys.argv[1]))
data = json.load(open(sys.argv[2]))
out = []
w = out.append

w("""\\set ON_ERROR_STOP on
SET check_function_bodies = off;
SET client_min_messages = warning;
DO $$ BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator','supabase_admin','postgres'] LOOP NULL; END LOOP;
END $$;
""".replace("FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator','supabase_admin','postgres'] LOOP NULL; END LOOP;", "NULL;"))
for role in ['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin']:
    w(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role}; END IF; END $$;")
w("""
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz, deleted_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE SCHEMA IF NOT EXISTS vault;
""")
for b in schema['buckets'] or []:
    w(f"INSERT INTO storage.buckets (id, name, public) VALUES ('{b['id']}', '{b['id']}', {str(b['public']).lower()});")

if schema.get('private_schema'):
    w('CREATE SCHEMA IF NOT EXISTS mediumia_private;')

# Séquences autonomes (non liées à une colonne d'identité)
for seq in schema['sequences'] or []:
    w(f"CREATE SEQUENCE IF NOT EXISTS public.{seq['n']};")

# Tables : colonnes (sans valeurs par défaut sauf identité/générées), puis fonctions, puis défauts.
defaults = []
for t in schema['tables']:
    cols = []
    for c in t['columns']:
        line = f'"{c["n"]}" {c["t"]}'
        if c['id'] in ('a', 'd'):
            line += ' GENERATED ' + ('ALWAYS' if c['id'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
        elif c['gen'] == 's':
            line += f" GENERATED ALWAYS AS ({c['d']}) STORED"
        elif c['d'] is not None:
            defaults.append((t['name'], c['n'], c['d']))
        if c['nn']:
            line += ' NOT NULL'
        cols.append(line)
    w(f"CREATE TABLE public.{t['name']} (\n  " + ",\n  ".join(cols) + "\n);")

# Fonctions (corps non vérifiés à la création, comme une restauration pg_dump)
for f in schema['functions']:
    w(f["def"].rstrip().rstrip(';') + ';')

for table, col, expr in defaults:
    w(f'ALTER TABLE public.{table} ALTER COLUMN "{col}" SET DEFAULT {expr};')

# Contraintes : clés primaires, uniques, vérifications ; clés étrangères à la fin.
fks = []
for t in schema['tables']:
    for k in t['constraints'] or []:
        if k['type'] == 'f':
            fks.append((t['name'], k))
        elif k['type'] in ('p', 'u', 'c', 'x'):
            w(f'ALTER TABLE public.{t["name"]} ADD CONSTRAINT "{k["n"]}" {k["def"]};')
for t in schema['tables']:
    for ix in t['indexes'] or []:
        w(ix + ';')

# Données (déclencheurs et clés étrangères désactivés pendant le chargement, comme une restauration)
w("INSERT INTO auth.users (id, created_at) VALUES " + ", ".join(f"('{u}', now())" for u in sys.argv[3].split(',')) + ";")
w("SET session_replication_role = replica;")
for name, rows in data.items():
    if not rows:
        continue
    payload = json.dumps(rows, ensure_ascii=False).replace("$q$", "")
    identity_always = any(c['id'] == 'a' for t in schema['tables'] if t['name'] == name for c in t['columns'])
    over = ' OVERRIDING SYSTEM VALUE' if identity_always else ''
    cols = [c['n'] for t in schema['tables'] if t['name'] == name for c in t['columns'] if c['gen'] != 's']
    col_list = ', '.join(f'"{c}"' for c in cols)
    w(f"INSERT INTO public.{name} ({col_list}){over} SELECT {col_list} FROM json_populate_recordset(NULL::public.{name}, $q${payload}$q$::json);")
w("SET session_replication_role = origin;")

for table, k in fks:
    w(f'ALTER TABLE public.{table} ADD CONSTRAINT "{k["n"]}" {k["def"]};')

for trg in schema['triggers'] or []:
    w(trg + ';')

for t in schema['tables']:
    if t['rls']:
        w(f"ALTER TABLE public.{t['name']} ENABLE ROW LEVEL SECURITY;")
    if t['force_rls']:
        w(f"ALTER TABLE public.{t['name']} FORCE ROW LEVEL SECURITY;")
    w(f"REVOKE ALL ON public.{t['name']} FROM PUBLIC, anon, authenticated, service_role;")
    for g in t['grants'] or []:
        role, priv = g.split(':')
        w(f"GRANT {priv} ON public.{t['name']} TO {role};")

for p in schema['policies'] or []:
    roles = ', '.join(p['roles']) if isinstance(p['roles'], list) else str(p['roles']).strip('{}')
    stmt = f'CREATE POLICY "{p["n"]}" ON {p["schema"]}.{p["table"]} AS {p["perm"]} FOR {p["cmd"]} TO {roles}'
    if p['qual']:
        stmt += f" USING ({p['qual']})"
    if p['check']:
        stmt += f" WITH CHECK ({p['check']})"
    w(stmt + ';')

for f in schema['functions']:
    q = f"{f.get('schema', 'public')}.{f['sig']}"
    w(f"REVOKE ALL ON FUNCTION {q} FROM PUBLIC, anon, authenticated;")
    for role in [x for x in (f['acl'] or '').split('+') if x]:
        w(f"GRANT EXECUTE ON FUNCTION {q} TO {role};")

for seq in schema['sequences'] or []:
    if seq['last'] is not None:
        w(f"SELECT setval('public.{seq['n']}', {seq['last']});")

open(sys.argv[4], 'w').write("\n".join(out) + "\n")
print('ok', len(out), 'instructions')
