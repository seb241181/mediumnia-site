// Lumia Messages V2 — RLS de lumia_message_inbox sur un vrai PostgreSQL 17 + PostgREST
// (Docker, données fictives). Lancer : node --test tests/integration/lumiaMessageInbox.postgres.test.js
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(currentDir, '../..')
const jwtSecret = 'mediumia-lumia-inbox-local-jwt-secret-at-least-thirty-two-chars'
const suffix = `${process.pid}-${Date.now()}`
const postgresName = `lumia-inbox-pg-${suffix}`
const postgrestName = `lumia-inbox-rest-${suffix}`
const networkName = `lumia-inbox-net-${suffix}`
const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' })
  if (result.status !== 0 && !options.allowFailure) throw new Error(`docker ${args.join(' ')} failed\n${result.stderr || ''}`)
  return result
}

function tokenFor(sub, role = 'authenticated') {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${head}.${crypto.createHmac('sha256', jwtSecret).update(head).digest('base64url')}`
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)) })
  })
}

async function waitFor(check, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} not ready`)
}

function psql(sql) {
  return docker(['exec', postgresName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], { capture: true })
}

function applySql(file) {
  const target = `/tmp/${path.basename(file)}`
  docker(['cp', file, `${postgresName}:${target}`], { capture: true })
  docker(['exec', postgresName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', target], { capture: true })
}

async function api(baseUrl, route, { token, method = 'GET', body, prefer } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: response.status, data }
}

const row = (owner, id, over = {}) => ({
  owner_id: owner,
  source_channel: 'sms',
  source_message_id: id,
  sender: '+33612345678',
  message_text: `Message fictif ${id}`,
  message_sent_at: '2026-10-03T08:00:00Z',
  ...over,
})

test('lumia_message_inbox : RLS stricte par owner_id, aucun accès anonyme, écriture serveur seulement', async (t) => {
  if (docker(['info'], { capture: true, allowFailure: true }).status !== 0) {
    t.skip('Docker indisponible')
    return
  }
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const tokenA = tokenFor(userA)
  const tokenB = tokenFor(userB)
  const service = tokenFor('00000000-0000-4000-8000-000000000000', 'service_role')

  docker(['network', 'create', networkName], { capture: true })
  t.after(() => {
    docker(['rm', '-f', postgrestName], { allowFailure: true, capture: true })
    docker(['rm', '-f', postgresName], { allowFailure: true, capture: true })
    docker(['network', 'rm', networkName], { allowFailure: true, capture: true })
  })
  docker(['run', '-d', '--name', postgresName, '--network', networkName, '-e', 'POSTGRES_PASSWORD=mediumia_test_password', 'postgres:17-alpine'], { capture: true })
  await waitFor(() => docker(['exec', postgresName, 'psql', '-U', 'postgres', '-c', 'select 1'], { capture: true, allowFailure: true }).status === 0, 'PostgreSQL')

  applySql(path.join(root, 'tests/fixtures/mediumia-pro-postgres-bootstrap.sql'))
  applySql(path.join(root, 'supabase/migrations/20261004090000_lumia_message_inbox.sql'))
  // Rejouable (idempotente).
  applySql(path.join(root, 'supabase/migrations/20261004090000_lumia_message_inbox.sql'))
  // pg_cron simulé (même interface que Supabase) pour la migration de rétention.
  psql(`create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true, username text default current_user);
    create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql
      as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
    create function cron.unschedule(p_id bigint) returns boolean language sql
      as $$ delete from cron.job where jobid = p_id returning true $$;`)
  applySql(path.join(root, 'supabase/migrations/20261004100000_lumia_message_inbox_retention.sql'))
  applySql(path.join(root, 'supabase/migrations/20261004100000_lumia_message_inbox_retention.sql'))
  // Une ligne entrante existante avant la migration des sortants (counterpart à remplir).
  psql(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test') on conflict do nothing;
    insert into public.lumia_message_inbox (owner_id, source_channel, source_message_id, sender, message_text) values ('${userA}', 'sms', 'PRE-OUTGOING', '+33611111111', 'Avant migration');`)
  applySql(path.join(root, 'supabase/migrations/20261005090000_lumia_message_inbox_outgoing.sql'))
  applySql(path.join(root, 'supabase/migrations/20261005090000_lumia_message_inbox_outgoing.sql'))
  psql(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test') on conflict do nothing;`)

  docker([
    'run', '-d', '--name', postgrestName, '--network', networkName, '-p', `127.0.0.1:${port}:3000`,
    '-e', `PGRST_DB_URI=postgres://authenticator:mediumia_test_password@${postgresName}:5432/postgres`,
    '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${jwtSecret}`,
    'postgrest/postgrest:v14.1',
  ], { capture: true })
  await waitFor(async () => { try { return (await fetch(baseUrl)).status < 500 } catch { return false } }, 'PostgREST')

  await t.test('le serveur (service_role) écrit ; un doublon est refusé par la contrainte d\'unicité', async () => {
    const created = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: [row(userA, 'A-1'), row(userA, 'A-2'), row(userB, 'B-1')] })
    assert.equal(created.status, 201)
    const duplicate = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: row(userA, 'A-1', { message_text: 'autre' }) })
    assert.equal(duplicate.status, 409)
    // Insertion idempotente telle que l'utilise l'API (on_conflict + ignore-duplicates).
    const ignored = await api(baseUrl, '/lumia_message_inbox?on_conflict=owner_id,source_channel,source_message_id', {
      token: service, method: 'POST', body: row(userA, 'A-1', { message_text: 'autre' }), prefer: 'resolution=ignore-duplicates,return=representation',
    })
    assert.equal(ignored.status, 201)
    assert.deepEqual(ignored.data, [])
    assert.equal(psql("select count(*) from public.lumia_message_inbox where source_message_id = 'A-1'").stdout.trim(), '1')
    // Le même identifiant Apple chez un autre propriétaire reste indépendant.
    assert.equal((await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: row(userB, 'A-1') })).status, 201)
  })

  await t.test('A ne lit que ses messages ; B ne lit que les siens', async () => {
    const a = await api(baseUrl, '/lumia_message_inbox?select=owner_id,source_message_id&order=source_message_id&source_message_id=neq.PRE-OUTGOING', { token: tokenA })
    assert.equal(a.status, 200)
    assert.deepEqual(a.data.map((r) => r.source_message_id), ['A-1', 'A-2'])
    assert.ok(a.data.every((r) => r.owner_id === userA))
    const crossA = await api(baseUrl, `/lumia_message_inbox?owner_id=eq.${userB}`, { token: tokenA })
    assert.deepEqual(crossA.data, [])
    const b = await api(baseUrl, '/lumia_message_inbox?select=owner_id', { token: tokenB })
    assert.ok(b.data.length === 2 && b.data.every((r) => r.owner_id === userB))
  })

  await t.test('accès anonyme refusé', async () => {
    const anon = await api(baseUrl, '/lumia_message_inbox?select=id')
    assert.ok([401, 403].includes(anon.status), `statut ${anon.status}`)
  })

  await t.test('un utilisateur ne peut ni créer, ni modifier, ni supprimer (même ses propres messages)', async () => {
    const insert = await api(baseUrl, '/lumia_message_inbox', { token: tokenA, method: 'POST', body: row(userA, 'A-FORGED') })
    assert.ok([401, 403].includes(insert.status))
    const forgeB = await api(baseUrl, '/lumia_message_inbox', { token: tokenA, method: 'POST', body: row(userB, 'B-FORGED') })
    assert.ok([401, 403].includes(forgeB.status))
    const update = await api(baseUrl, '/lumia_message_inbox?source_message_id=eq.A-2', { token: tokenA, method: 'PATCH', body: { message_text: 'modifié' } })
    assert.ok([401, 403].includes(update.status))
    const remove = await api(baseUrl, '/lumia_message_inbox?source_message_id=eq.B-1', { token: tokenA, method: 'DELETE' })
    assert.ok([401, 403].includes(remove.status))
    assert.equal(psql('select count(*) from public.lumia_message_inbox').stdout.trim(), '5')
    assert.equal(psql("select message_text from public.lumia_message_inbox where source_message_id = 'A-2'").stdout.trim(), 'Message fictif A-2')
  })

  await t.test('rétention 90 jours : J-89 et 90 j - 1 min conservés, 90 j + 1 min et J-91 supprimés, référence received_at', async () => {
    psql(`insert into public.lumia_message_inbox (owner_id, source_channel, source_message_id, message_text, message_sent_at, received_at) values
      ('${userA}', 'sms', 'RET-J89', 'x', now() - interval '89 days', now() - interval '89 days'),
      ('${userA}', 'sms', 'RET-J90-1MIN', 'x', now() - interval '90 days' + interval '1 minute', now() - interval '90 days' + interval '1 minute'),
      ('${userA}', 'sms', 'RET-J90+1MIN', 'x', now() - interval '90 days' - interval '1 minute', now() - interval '90 days' - interval '1 minute'),
      ('${userB}', 'sms', 'RET-J91', 'x', now() - interval '91 days', now() - interval '91 days'),
      ('${userA}', 'rcs', 'RET-SENT-OLD-RECEIVED-NEW', 'x', now() - interval '120 days', now() - interval '1 day');`)
    const before = Number(psql('select count(*) from public.lumia_message_inbox').stdout.trim())
    assert.equal(psql('select public.lumia_purge_message_inbox()').stdout.trim(), '2')
    assert.equal(psql('select public.lumia_purge_message_inbox()').stdout.trim(), '0', 'idempotente')
    const left = psql("select string_agg(source_message_id, ',' order by source_message_id) from public.lumia_message_inbox where source_message_id like 'RET-%'").stdout.trim()
    assert.equal(left, 'RET-J89,RET-J90-1MIN,RET-SENT-OLD-RECEIVED-NEW')
    assert.equal(Number(psql('select count(*) from public.lumia_message_inbox').stdout.trim()), before - 2)
    // Une seule tâche planifiée, quotidienne, même après deux applications.
    assert.equal(psql("select count(*) || ' ' || max(schedule) || ' ' || max(command) from cron.job where jobname = 'lumia-message-inbox-retention'").stdout.trim(),
      '1 17 3 * * * SELECT public.lumia_purge_message_inbox()')
  })

  await t.test('droits réduits : service_role insère et lit seulement ; personne d\'autre ne purge', async () => {
    const ingest = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: row(userA, 'AFTER-PURGE') })
    assert.equal(ingest.status, 201, 'ingestion toujours possible après purge')
    for (const [method, route, body] of [
      ['PATCH', '/lumia_message_inbox?source_message_id=eq.AFTER-PURGE', { message_text: 'modifié' }],
      ['DELETE', '/lumia_message_inbox?source_message_id=eq.AFTER-PURGE', undefined],
    ]) {
      const result = await api(baseUrl, route, { token: service, method, body })
      assert.ok([401, 403].includes(result.status), `service_role ${method} : ${result.status}`)
    }
    for (const token of [service, tokenA, undefined]) {
      const purge = await api(baseUrl, '/rpc/lumia_purge_message_inbox', { token, method: 'POST', body: {} })
      assert.ok([401, 403, 404].includes(purge.status), `purge via API : ${purge.status}`)
    }
    assert.equal(psql("select count(*) from public.lumia_message_inbox where source_message_id = 'AFTER-PURGE'").stdout.trim(), '1')
    assert.equal(psql("select has_table_privilege('service_role', 'public.lumia_message_inbox', 'TRUNCATE')").stdout.trim(), 'f')
  })

  await t.test('sortants : counterpart rempli pour l\'existant ; un sortant n\'a jamais d\'expéditeur ni de classement RDV ; RLS inchangée', async () => {
    assert.equal(psql("select counterpart from public.lumia_message_inbox where source_message_id = 'PRE-OUTGOING'").stdout.trim(), '+33611111111')
    const okOut = { owner_id: userA, source_channel: 'sms', source_message_id: 'OUT-OK', counterpart: '+33611111111', message_text: 'Réponse', is_from_me: true }
    assert.equal((await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: okOut })).status, 201)
    for (const bad of [
      { source_message_id: 'OUT-CLASS', classification: 'probable' },
      { source_message_id: 'OUT-SENDER', sender: '+33622222222' },
      { source_message_id: 'OUT-NOWHO', counterpart: null },
      { source_message_id: 'OUT-BADWHO', counterpart: 'Sylvie' },
    ]) {
      const result = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: { ...okOut, ...bad } })
      assert.equal(result.status, 400, JSON.stringify(bad))
    }
    const a = await api(baseUrl, '/lumia_message_inbox?is_from_me=eq.true&select=source_message_id', { token: tokenA })
    assert.deepEqual(a.data.map((r) => r.source_message_id), ['OUT-OK'])
    const b = await api(baseUrl, '/lumia_message_inbox?is_from_me=eq.true&select=source_message_id', { token: tokenB })
    assert.deepEqual(b.data, [])
    const forged = await api(baseUrl, '/lumia_message_inbox', { token: tokenA, method: 'POST', body: { ...okOut, source_message_id: 'OUT-FORGED' } })
    assert.ok([401, 403].includes(forged.status))
  })

  await t.test('contraintes : canal, identifiant, expéditeur, texte', async () => {
    for (const bad of [
      { source_channel: 'other' },
      { source_message_id: 'bad;id' },
      { sender: 'Sylvie' },
      { message_text: '' },
      { message_text: 'x'.repeat(4001) },
    ]) {
      const result = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: row(userA, `BAD-${Math.random().toString(16).slice(2, 8)}`, bad) })
      assert.equal(result.status, 400, JSON.stringify(bad))
    }
    const rcs = await api(baseUrl, '/lumia_message_inbox', { token: service, method: 'POST', body: row(userA, 'A-RCS', { source_channel: 'rcs', sender: 'client@example.com' }) })
    assert.equal(rcs.status, 201)
  })
})
