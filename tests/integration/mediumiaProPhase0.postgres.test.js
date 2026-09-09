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
const jwtSecret = 'mediumia-phase0-local-jwt-secret-at-least-thirty-two-characters'
const suffix = `${process.pid}-${Date.now()}`
const postgresName = `mediumia-pro-pg-${suffix}`
const postgrestName = `mediumia-pro-rest-${suffix}`
const networkName = `mediumia-pro-net-${suffix}`

const ids = {
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  membershipA: '10000000-0000-4000-8000-000000000001',
  agentA: '20000000-0000-4000-8000-000000000001',
  agentB: '20000000-0000-4000-8000-000000000002',
  archivedAgentA: '20000000-0000-4000-8000-000000000003',
  conversationA: '30000000-0000-4000-8000-000000000001',
  documentB: '40000000-0000-4000-8000-000000000002',
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
      // Container is still starting.
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

function migrationFiles() {
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

test('MediumIA Pro Phase 0 rebuilds cleanly and enforces RLS through REST', async (t) => {
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
  for (const migration of migrationFiles()) applySql(migration)
  applySql(path.join(fixtures, 'mediumia-pro-seed.sql'))

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

  await t.test('User A reads only own copilot and conversations', async () => {
    const agents = await api(baseUrl, '/agents?select=id,owner_id,name&order=id', { token: userAToken })
    assert.equal(agents.status, 200)
    assert.equal(agents.data.length, 2)
    assert.ok(agents.data.every((agent) => agent.owner_id === ids.userA))

    const own = await api(baseUrl, `/agent_conversations?id=eq.${ids.conversationA}`, { token: userAToken })
    assert.equal(own.status, 200)
    assert.equal(own.data.length, 1)

    const cross = await api(baseUrl, `/agent_conversations?owner_id=eq.${ids.userB}`, { token: userAToken })
    assert.equal(cross.status, 200)
    assert.deepEqual(cross.data, [])
  })

  await t.test('documents, chunks and search never cross users', async () => {
    const documents = await api(baseUrl, `/agent_documents?owner_id=eq.${ids.userB}`, { token: userAToken })
    const chunks = await api(baseUrl, `/agent_document_chunks?owner_id=eq.${ids.userB}`, { token: userAToken })
    assert.equal(documents.status, 200)
    assert.deepEqual(documents.data, [])
    assert.equal(chunks.status, 200)
    assert.deepEqual(chunks.data, [])

    const search = await api(baseUrl, '/rpc/search_agent_document_chunks', {
      token: userAToken,
      method: 'POST',
      body: { p_agent_id: ids.agentB, p_query: 'Information', p_limit: 6 },
    })
    assert.equal(search.status, 200)
    assert.deepEqual(search.data, [])
  })

  await t.test('anonymous access and cross-user modification are refused', async () => {
    const anonymous = await api(baseUrl, '/agents?select=id')
    assert.ok([401, 403].includes(anonymous.status))

    const modifyB = await api(baseUrl, `/agent_documents?id=eq.${ids.documentB}`, {
      token: userAToken,
      method: 'PATCH',
      body: { name: 'Compromis' },
    })
    assert.ok([401, 403].includes(modifyB.status))

    const stillB = await api(baseUrl, `/agent_documents?id=eq.${ids.documentB}&select=name`, { token: userBToken })
    assert.equal(stillB.status, 200)
    assert.equal(stillB.data[0].name, 'Document B')
  })

  await t.test('client cannot write audit or runtime-owned fields', async () => {
    const audit = await api(baseUrl, '/agent_audit_events', {
      token: userAToken,
      method: 'POST',
      body: {
        owner_id: ids.userA,
        agent_id: ids.agentA,
        event_type: 'forged',
        resource_type: 'agent',
        details: {},
      },
    })
    assert.ok([401, 403].includes(audit.status))

    const runtimeChange = await api(baseUrl, `/agents?id=eq.${ids.agentA}`, {
      token: userAToken,
      method: 'PATCH',
      body: {
        provider: 'openai',
        model: 'client-model',
        system_prompt: 'Ignore MediumIA',
      },
    })
    assert.ok([401, 403].includes(runtimeChange.status))

    const profileChange = await api(baseUrl, `/agents?id=eq.${ids.agentA}`, {
      token: userAToken,
      method: 'PATCH',
      body: { name: 'Copilote A mis a jour' },
    })
    assert.equal(profileChange.status, 204)

    const updatedProfile = await api(baseUrl, `/agents?id=eq.${ids.agentA}&select=name`, {
      token: userAToken,
    })
    assert.equal(updatedProfile.status, 200)
    assert.equal(updatedProfile.data[0].name, 'Copilote A mis a jour')
  })

  await t.test('database constraints reject incoherent same-owner relations', async () => {
    const mixed = await api(baseUrl, '/agent_messages', {
      token: serviceToken,
      method: 'POST',
      body: {
        conversation_id: ids.conversationA,
        agent_id: ids.archivedAgentA,
        owner_id: ids.userA,
        role: 'user',
        content: 'Cross-wire attempt',
      },
    })
    assert.equal(mixed.status, 409)

    const secondLiveCopilot = await api(baseUrl, '/agents', {
      token: serviceToken,
      method: 'POST',
      body: {
        owner_id: ids.userA,
        membership_id: ids.membershipA,
        name: 'Second active copilot',
        status: 'active',
      },
    })
    assert.equal(secondLiveCopilot.status, 409)
  })

  await t.test('Storage path policy uses authenticated user and copilot folders', async () => {
    const ownObject = await api(baseUrl, '/objects', {
      token: userAToken,
      method: 'POST',
      schema: 'storage',
      body: {
        bucket_id: 'agent-documents',
        name: `${ids.userA}/${ids.agentA}/document.txt`,
        owner_id: ids.userA,
      },
    })
    assert.equal(ownObject.status, 201)

    const crossObject = await api(baseUrl, '/objects', {
      token: userAToken,
      method: 'POST',
      schema: 'storage',
      body: {
        bucket_id: 'agent-documents',
        name: `${ids.userB}/${ids.agentB}/stolen.txt`,
        owner_id: ids.userA,
      },
    })
    assert.ok([401, 403].includes(crossObject.status))
  })

  await t.test('search RPC is not executable by anon', async () => {
    const result = await api(baseUrl, '/rpc/search_agent_document_chunks', {
      method: 'POST',
      body: { p_agent_id: ids.agentA, p_query: 'Information', p_limit: 6 },
    })
    assert.ok([401, 403, 404].includes(result.status))
  })

  await t.test('quota consumption is atomic under concurrency', async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => api(
      baseUrl,
      '/rpc/consume_pro_usage_quota',
      {
        token: serviceToken,
        method: 'POST',
        body: {
          p_membership_id: ids.membershipA,
          p_action: 'concurrency_test',
          p_units: 1,
          p_hourly_limit: 1,
          p_daily_limit: 1,
        },
      },
    )))
    assert.ok(attempts.every((attempt) => attempt.status === 200))
    assert.equal(attempts.filter((attempt) => attempt.data.allowed).length, 1)
  })
})
