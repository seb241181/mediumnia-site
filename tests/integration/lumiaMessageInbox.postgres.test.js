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
  psql(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');`)

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
    const a = await api(baseUrl, '/lumia_message_inbox?select=owner_id,source_message_id&order=source_message_id', { token: tokenA })
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
    assert.equal(psql('select count(*) from public.lumia_message_inbox').stdout.trim(), '4')
    assert.equal(psql("select message_text from public.lumia_message_inbox where source_message_id = 'A-2'").stdout.trim(), 'Message fictif A-2')
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
