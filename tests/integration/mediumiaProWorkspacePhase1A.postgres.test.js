import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(currentDir, '../..')
const fixtures = path.join(root, 'tests/fixtures')
const migrationsDir = path.join(root, 'supabase/migrations')
const jwtSecret = 'mediumia-phase1a-local-jwt-secret-at-least-thirty-two-characters'
const suffix = `${process.pid}-${Date.now()}`
const postgresName = `mediumia-pro-workspace-pg-${suffix}`
const postgrestName = `mediumia-pro-workspace-rest-${suffix}`
const networkName = `mediumia-pro-workspace-net-${suffix}`

const ids = {
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  membershipA: '10000000-0000-4000-8000-000000000001',
  agentA: '20000000-0000-4000-8000-000000000001',
  agentB: '20000000-0000-4000-8000-000000000002',
  secondAgentA: '20000000-0000-4000-8000-000000000004',
  newDocumentA: '40000000-0000-4000-8000-000000000004',
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stderr || ''}`)
  }
  return result
}

function psql(query) {
  const result = docker([
    'exec', postgresName, 'psql', '-v', 'ON_ERROR_STOP=1', '-At',
    '-U', 'postgres', '-d', 'postgres', '-c', query,
  ], { capture: true })
  return result.stdout.trim()
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function tokenFor(sub, role = 'authenticated') {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    sub,
    role,
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }))
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(['exec', postgresName, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1'], {
      capture: true,
      allowFailure: true,
    })
    if (result.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('PostgreSQL local did not become ready')
}

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // PostgREST is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('PostgREST local did not become ready')
}

function applySql(file) {
  const target = `/tmp/${path.basename(file)}`
  docker(['cp', file, `${postgresName}:${target}`])
  docker(['exec', postgresName, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', target])
}

async function api(baseUrl, route, { token, method = 'GET', body, schema = 'public' } = {}) {
  const headers = {
    Accept: 'application/json',
    Prefer: 'return=representation',
    'Accept-Profile': schema,
    'Content-Profile': schema,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: response.status, data }
}

function phase0MigrationFiles() {
  const expected = [
    '20260814212300_create_mediumia_agents_foundation.sql',
    '20260814212646_harden_updated_at_function_search_path.sql',
    '20260815074019_add_agent_conversations_and_messages.sql',
    '20260815192137_add_secure_agent_documents_foundation.sql',
    '20260815203822_fix_agent_document_search_query_terms.sql',
  ]
  const hardening = fs.readdirSync(migrationsDir)
    .find((name) => name.endsWith('_mediumia_pro_phase0_security.sql'))
  assert.ok(hardening, 'Phase 0 hardening migration is missing')
  return [...expected, hardening].map((name) => path.join(migrationsDir, name))
}

test('MediumIA Pro Phase 1A migrates workspaces on real PostgreSQL without changing legacy RAG', async (t) => {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const userAToken = tokenFor(ids.userA)
  const userBToken = tokenFor(ids.userB)
  const serviceToken = tokenFor('00000000-0000-4000-8000-000000000000', 'service_role')

  docker(['network', 'create', networkName])
  t.after(() => {
    docker(['rm', '-f', postgrestName], { allowFailure: true, capture: true })
    docker(['rm', '-f', postgresName], { allowFailure: true, capture: true })
    docker(['network', 'rm', networkName], { allowFailure: true, capture: true })
  })

  docker([
    'run', '-d', '--name', postgresName, '--network', networkName,
    '-e', 'POSTGRES_PASSWORD=mediumia_test_password',
    '-e', 'POSTGRES_DB=postgres',
    'postgres:17-alpine',
  ], { capture: true })
  await waitForPostgres()

  applySql(path.join(fixtures, 'mediumia-pro-postgres-bootstrap.sql'))
  for (const migration of phase0MigrationFiles()) applySql(migration)
  applySql(path.join(fixtures, 'mediumia-pro-seed.sql'))

  const ragBefore = psql("select md5(pg_get_functiondef('public.search_agent_document_chunks(uuid,text,integer)'::regprocedure));")
  applySql(path.join(migrationsDir, '20260910140000_mediumia_pro_workspace_shadow.sql'))
  const ragAfter = psql("select md5(pg_get_functiondef('public.search_agent_document_chunks(uuid,text,integer)'::regprocedure));")
  assert.equal(ragAfter, ragBefore)

  docker([
    'run', '-d', '--name', postgrestName, '--network', networkName,
    '-p', `127.0.0.1:${port}:3000`,
    '-e', `PGRST_DB_URI=postgres://authenticator:mediumia_test_password@${postgresName}:5432/postgres`,
    '-e', 'PGRST_DB_SCHEMAS=public,storage',
    '-e', 'PGRST_DB_ANON_ROLE=anon',
    '-e', `PGRST_JWT_SECRET=${jwtSecret}`,
    'postgrest/postgrest:v14.1',
  ], { capture: true })
  await waitForHttp(baseUrl)

  const workspaces = await api(baseUrl, '/pro_workspaces?select=id,owner_user_id,kind,status&order=owner_user_id', {
    token: serviceToken,
  })
  assert.equal(workspaces.status, 200)
  const workspaceA = workspaces.data.find((row) => row.owner_user_id === ids.userA)
  const workspaceB = workspaces.data.find((row) => row.owner_user_id === ids.userB)
  const platform = workspaces.data.find((row) => row.kind === 'platform')
  assert.ok(workspaceA)
  assert.ok(workspaceB)
  assert.ok(platform)

  await t.test('backfill is complete and customer RLS never crosses tenants or exposes platform workspace', async () => {
    const nulls = psql(`
      select
        (select count(*) from public.pro_memberships where workspace_id is null) +
        (select count(*) from public.agents where workspace_id is null) +
        (select count(*) from public.agent_documents where workspace_id is null) +
        (select count(*) from public.agent_document_chunks where workspace_id is null);
    `)
    assert.equal(nulls, '0')

    const ownA = await api(baseUrl, '/pro_workspaces?select=id,owner_user_id,kind,status', { token: userAToken })
    assert.equal(ownA.status, 200)
    assert.deepEqual(ownA.data.map((row) => row.id), [workspaceA.id])

    const crossA = await api(baseUrl, `/pro_workspaces?id=eq.${workspaceB.id}&select=id`, { token: userAToken })
    assert.equal(crossA.status, 200)
    assert.deepEqual(crossA.data, [])

    const platformA = await api(baseUrl, `/pro_workspaces?id=eq.${platform.id}&select=id`, { token: userAToken })
    assert.equal(platformA.status, 200)
    assert.deepEqual(platformA.data, [])
  })

  await t.test('second live agent is allowed and workspace is derived from its membership', async () => {
    const created = await api(baseUrl, '/agents', {
      token: serviceToken,
      method: 'POST',
      body: {
        id: ids.secondAgentA,
        owner_id: ids.userA,
        membership_id: ids.membershipA,
        name: 'Second active copilot',
        status: 'active',
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data[0].workspace_id, workspaceA.id)
  })

  await t.test('future legacy document and chunk writes derive workspace and remain searchable by legacy RAG', async () => {
    const document = await api(baseUrl, '/agent_documents', {
      token: serviceToken,
      method: 'POST',
      body: {
        id: ids.newDocumentA,
        agent_id: ids.agentA,
        owner_id: ids.userA,
        name: 'Nouveau document A',
        source_type: 'paste',
        status: 'ready',
        approved_for_ai: true,
      },
    })
    assert.equal(document.status, 201)
    assert.equal(document.data[0].workspace_id, workspaceA.id)

    const chunk = await api(baseUrl, '/agent_document_chunks', {
      token: serviceToken,
      method: 'POST',
      body: {
        document_id: ids.newDocumentA,
        agent_id: ids.agentA,
        owner_id: ids.userA,
        chunk_index: 0,
        content: 'PHASE1A_UNIQUE_WORKSPACE_TOKEN',
      },
    })
    assert.equal(chunk.status, 201)
    assert.equal(chunk.data[0].workspace_id, workspaceA.id)

    const search = await api(baseUrl, '/rpc/search_agent_document_chunks', {
      token: userAToken,
      method: 'POST',
      body: { p_agent_id: ids.agentA, p_query: 'PHASE1A UNIQUE WORKSPACE TOKEN', p_limit: 6 },
    })
    assert.equal(search.status, 200)
    assert.ok(search.data.some((row) => row.document_id === ids.newDocumentA))
  })

  await t.test('forged cross-workspace ids are rejected even with service role', async () => {
    const forgedAgent = await api(baseUrl, '/agents', {
      token: serviceToken,
      method: 'POST',
      body: {
        owner_id: ids.userA,
        membership_id: ids.membershipA,
        workspace_id: workspaceB.id,
        name: 'Cross workspace agent',
        status: 'active',
      },
    })
    assert.ok([400, 409].includes(forgedAgent.status))

    const forgedDocument = await api(baseUrl, '/agent_documents', {
      token: serviceToken,
      method: 'POST',
      body: {
        agent_id: ids.agentA,
        owner_id: ids.userA,
        workspace_id: workspaceB.id,
        name: 'Cross workspace document',
        source_type: 'paste',
        status: 'ready',
      },
    })
    assert.ok([400, 409].includes(forgedDocument.status))
  })

  await t.test('suspended workspace disappears from authenticated workspace reads and clients cannot mutate workspace state', async () => {
    const suspend = await api(baseUrl, `/pro_workspaces?id=eq.${workspaceA.id}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { status: 'suspended' },
    })
    assert.equal(suspend.status, 200)

    const hidden = await api(baseUrl, '/pro_workspaces?select=id', { token: userAToken })
    assert.equal(hidden.status, 200)
    assert.deepEqual(hidden.data, [])

    const clientPatch = await api(baseUrl, `/pro_workspaces?id=eq.${workspaceA.id}`, {
      token: userAToken,
      method: 'PATCH',
      body: { status: 'active' },
    })
    assert.ok([401, 403].includes(clientPatch.status))

    const restore = await api(baseUrl, `/pro_workspaces?id=eq.${workspaceA.id}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { status: 'active' },
    })
    assert.equal(restore.status, 200)

    const ownB = await api(baseUrl, '/pro_workspaces?select=id', { token: userBToken })
    assert.equal(ownB.status, 200)
    assert.deepEqual(ownB.data.map((row) => row.id), [workspaceB.id])
  })
})
