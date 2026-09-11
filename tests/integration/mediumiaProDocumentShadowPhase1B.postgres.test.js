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
const jwtSecret = 'mediumia-phase1b-local-jwt-secret-at-least-thirty-two-characters'
const suffix = `${process.pid}-${Date.now()}`
const postgresName = `mediumia-pro-phase1b-pg-${suffix}`
const postgrestName = `mediumia-pro-phase1b-rest-${suffix}`
const networkName = `mediumia-pro-phase1b-net-${suffix}`

const ids = {
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userViewer: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  userOutsider: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  agentA: '20000000-0000-4000-8000-000000000001',
  agentB: '20000000-0000-4000-8000-000000000002',
  legacyDocumentA: '40000000-0000-4000-8000-000000000001',
  legacyDocumentB: '40000000-0000-4000-8000-000000000002',
  prepareRequest: '50000000-0000-4000-8000-000000000001',
  viewerRequest: '50000000-0000-4000-8000-000000000002',
  outsiderRequest: '50000000-0000-4000-8000-000000000003',
  crossRequest: '50000000-0000-4000-8000-000000000004',
  claimOne: '60000000-0000-4000-8000-000000000001',
  claimTwo: '60000000-0000-4000-8000-000000000002',
  claimRecovered: '60000000-0000-4000-8000-000000000003',
  claimFinal: '60000000-0000-4000-8000-000000000004',
  prepareSecond: '50000000-0000-4000-8000-000000000010',
  claimSecond: '60000000-0000-4000-8000-000000000010',
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
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForPostgres() {
  let initialized = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const logs = docker(['logs', postgresName], { capture: true, allowFailure: true })
    const output = `${logs.stdout || ''}\n${logs.stderr || ''}`
    if (output.includes('PostgreSQL init process complete; ready for start up.')) initialized = true
    if (initialized) {
      const probe = docker([
        'exec', postgresName, 'psql', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1',
      ], { capture: true, allowFailure: true })
      if (probe.status === 0) return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
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

async function api(baseUrl, route, {
  token,
  method = 'GET',
  body,
  prefer = 'return=representation',
} = {}) {
  const headers = {
    Accept: 'application/json',
    Prefer: prefer,
    'Accept-Profile': 'public',
    'Content-Profile': 'public',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const raw = await response.text()
  let data
  try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
  return { status: response.status, data, raw }
}

function assertRejected(result, message) {
  assert.ok(result.status >= 400, `Expected rejection, received ${result.status}: ${result.raw}`)
  assert.match(result.raw, new RegExp(message))
}

function baselineMigrationFiles() {
  const names = [
    '20260814212300_create_mediumia_agents_foundation.sql',
    '20260814212646_harden_updated_at_function_search_path.sql',
    '20260815074019_add_agent_conversations_and_messages.sql',
    '20260815192137_add_secure_agent_documents_foundation.sql',
    '20260815203822_fix_agent_document_search_query_terms.sql',
    '20260909181952_mediumia_pro_phase0_security.sql',
    '20260910045000_mediumia_pro_phase0_cleanup.sql',
    '20260910054200_mediumia_pro_phase1_documents_server_only.sql',
  ]
  for (const name of names) {
    assert.ok(fs.existsSync(path.join(migrationsDir, name)), `Missing baseline migration: ${name}`)
  }
  return names.map((name) => path.join(migrationsDir, name))
}

test('MediumIA Pro Phase 1B-A enforces a transactional server-only document shadow', async (t) => {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const tokenA = tokenFor(ids.userA)
  const serviceToken = tokenFor('00000000-0000-4000-8000-000000000000', 'service_role')
  let workspaceA
  let workspaceB
  let documentId
  let versionId
  let secondDocumentId
  let secondVersionId

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
  for (const migration of baselineMigrationFiles()) applySql(migration)
  applySql(path.join(fixtures, 'mediumia-pro-seed.sql'))
  applySql(path.join(migrationsDir, '20260910140000_mediumia_pro_workspace_shadow.sql'))
  applySql(path.join(migrationsDir, '20260910181600_mediumia_pro_phase1a_fk_indexes.sql'))

  const ragBefore = psql("select md5(pg_get_functiondef('public.search_agent_document_chunks(uuid,text,integer)'::regprocedure));")
  applySql(path.join(migrationsDir, '20260910184117_mediumia_pro_phase1b_document_shadow.sql'))
  const ragAfter = psql("select md5(pg_get_functiondef('public.search_agent_document_chunks(uuid,text,integer)'::regprocedure));")

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

  const workspaces = JSON.parse(psql(`
    select json_agg(row_to_json(q))
    from (
      select id, owner_user_id, kind
      from public.pro_workspaces
      order by created_at
    ) q;
  `))
  workspaceA = workspaces.find((row) => row.owner_user_id === ids.userA).id
  workspaceB = workspaces.find((row) => row.owner_user_id === ids.userB).id

  await t.test('creates seven server-only tables with RLS and preserves the legacy RAG byte-for-byte', async () => {
    assert.equal(ragAfter, ragBefore)
    const shadowTables = [
      'pro_documents',
      'pro_document_versions',
      'pro_document_chunks',
      'pro_document_agent_access',
      'pro_document_sync_queue',
      'pro_document_storage_jobs',
      'pro_audit_events',
    ]
    const tableCount = psql(`
      select count(*)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(array[${shadowTables.map((name) => `'${name}'`).join(', ')}])
        and c.relkind = 'r';
    `)
    assert.equal(tableCount, '7')

    const rlsCount = psql(`
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity
        and c.relname = any(array[${shadowTables.map((name) => `'${name}'`).join(', ')}]);
    `)
    assert.equal(rlsCount, '7')
    assert.equal(psql(`
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any(array[${shadowTables.map((name) => `'${name}'`).join(', ')}])
        and column_name = 'workspace_id'
        and is_nullable = 'NO';
    `), '7')

    const requiredForeignKeys = [
      'pro_documents_creator_workspace_fkey',
      'pro_document_versions_document_workspace_fkey',
      'pro_document_versions_creator_workspace_fkey',
      'pro_document_versions_approver_workspace_fkey',
      'pro_documents_current_version_fkey',
      'pro_document_chunks_version_workspace_fkey',
      'pro_document_agent_access_document_workspace_fkey',
      'pro_document_agent_access_agent_workspace_fkey',
      'pro_document_agent_access_grantor_workspace_fkey',
      'pro_document_agent_access_revoker_workspace_fkey',
      'pro_document_storage_jobs_version_workspace_fkey',
      'pro_audit_events_actor_workspace_fkey',
    ]
    assert.equal(psql(`
      select count(*)
      from pg_constraint
      where contype = 'f'
        and conname = any(array[${requiredForeignKeys.map((name) => `'${name}'`).join(', ')}]);
    `), String(requiredForeignKeys.length))

    const restrictedForeignKeys = [
      'pro_documents_workspace_id_fkey',
      'pro_document_versions_document_workspace_fkey',
      'pro_documents_current_version_fkey',
      'pro_document_chunks_version_workspace_fkey',
      'pro_document_agent_access_document_workspace_fkey',
      'pro_document_agent_access_agent_workspace_fkey',
      'pro_document_storage_jobs_version_workspace_fkey',
      'pro_audit_events_workspace_id_fkey',
    ]
    assert.equal(psql(`
      select count(*)
      from pg_constraint
      where contype = 'f'
        and confdeltype = 'r'
        and conname = any(array[${restrictedForeignKeys.map((name) => `'${name}'`).join(', ')}]);
    `), String(restrictedForeignKeys.length))

    const nullableActorForeignKeys = [
      'pro_documents_creator_workspace_fkey',
      'pro_document_versions_creator_workspace_fkey',
      'pro_document_versions_approver_workspace_fkey',
      'pro_document_agent_access_grantor_workspace_fkey',
      'pro_document_agent_access_revoker_workspace_fkey',
      'pro_audit_events_actor_workspace_fkey',
    ]
    assert.equal(psql(`
      select count(*)
      from pg_constraint
      where contype = 'f'
        and confdeltype = 'n'
        and cardinality(confdelsetcols) = 1
        and conname = any(array[${nullableActorForeignKeys.map((name) => `'${name}'`).join(', ')}]);
    `), String(nullableActorForeignKeys.length))
    assert.equal(psql(`
      select count(*)
      from pg_constraint fk
      join pg_class source_table on source_table.oid = fk.conrelid
      join pg_class target_table on target_table.oid = fk.confrelid
      join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
      where fk.contype = 'f'
        and source_schema.nspname = 'public'
        and source_table.relname = any(array[${shadowTables.map((name) => `'${name}'`).join(', ')}])
        and target_table.relname in ('agent_documents', 'agent_document_chunks');
    `), '0')

    const requiredIndexes = [
      'pro_documents_workspace_status_idx',
      'pro_documents_creator_idx',
      'pro_documents_current_version_idx',
      'pro_document_versions_document_idx',
      'pro_document_versions_creator_idx',
      'pro_document_versions_approver_idx',
      'pro_document_versions_processing_idx',
      'pro_document_chunks_document_version_idx',
      'pro_document_agent_access_active_uidx',
      'pro_document_agent_access_agent_idx',
      'pro_document_agent_access_document_fk_idx',
      'pro_document_agent_access_agent_fk_idx',
      'pro_document_agent_access_grantor_idx',
      'pro_document_agent_access_revoker_idx',
      'pro_document_sync_queue_retry_idx',
      'pro_document_storage_jobs_retry_idx',
      'pro_audit_events_request_uidx',
      'pro_audit_events_workspace_created_idx',
      'pro_audit_events_document_created_idx',
      'pro_audit_events_actor_idx',
    ]
    assert.equal(psql(`
      select count(*)
      from pg_indexes
      where schemaname = 'public'
        and indexname = any(array[${requiredIndexes.map((name) => `'${name}'`).join(', ')}]);
    `), String(requiredIndexes.length))
    assert.equal(psql('select count(*) from public.pro_documents;'), '0')

    const serverFunctions = [
      'public.pro_prepare_document_upload(uuid,uuid,uuid,text,text,bigint)',
      'public.pro_claim_document_extraction(uuid,uuid,uuid,uuid,integer)',
      'public.pro_complete_document_extraction(uuid,uuid,uuid,uuid,text,jsonb,jsonb)',
      'public.pro_fail_document_extraction(uuid,uuid,uuid,uuid,text)',
      'public.pro_approve_document_version(uuid,uuid,uuid)',
      'public.pro_publish_document_version(uuid,uuid,uuid)',
      'public.pro_set_document_ai_enabled(uuid,uuid,boolean,uuid)',
      'public.pro_delete_document(uuid,uuid,uuid)',
      'public.pro_reconcile_legacy_document(uuid,uuid)',
    ]
    for (const functionSignature of serverFunctions) {
      assert.equal(psql(`select has_function_privilege('authenticated', '${functionSignature}', 'execute');`), 'f')
      assert.equal(psql(`select has_function_privilege('service_role', '${functionSignature}', 'execute');`), 't')
      assert.equal(psql(`select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = '${functionSignature}'::regprocedure;`), 'search_path=""')
    }
    for (const tableName of shadowTables) {
      assert.equal(psql(`select has_table_privilege('service_role', 'public.${tableName}', 'select,insert,update,delete');`), 't')
      assert.equal(psql(`select has_table_privilege('service_role', 'public.${tableName}', 'truncate');`), 'f')
    }
  })

  await t.test('keeps direct client access and RPC execution closed', async () => {
    const read = await api(baseUrl, '/pro_documents?select=id', { token: tokenA })
    assert.ok([401, 403].includes(read.status))
    const invoke = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: tokenA,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareRequest,
        p_name: 'test.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 100,
      },
    })
    assert.ok([401, 403, 404].includes(invoke.status))
  })

  await t.test('rejects non-members, insufficient roles, and cross-workspace actors inside service RPCs', async () => {
    psql(`
      insert into auth.users(id, email) values
        ('${ids.userViewer}', 'viewer@example.test'),
        ('${ids.userOutsider}', 'outsider@example.test');
      insert into public.pro_workspace_members(workspace_id, user_id, role, status)
      values ('${workspaceA}', '${ids.userViewer}', 'viewer', 'active');
    `)

    const viewer = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userViewer,
        p_request_id: ids.viewerRequest,
        p_name: 'viewer.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 100,
      },
    })
    assertRejected(viewer, 'workspace_role_insufficient')

    const outsider = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userOutsider,
        p_request_id: ids.outsiderRequest,
        p_name: 'outsider.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 100,
      },
    })
    assertRejected(outsider, 'workspace_membership_required')

    const cross = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentB,
        p_actor_user_id: ids.userA,
        p_request_id: ids.crossRequest,
        p_name: 'cross.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 100,
      },
    })
    assertRejected(cross, 'workspace_membership_required')
  })

  await t.test('prepares legacy and shadow identities atomically and idempotently', async () => {
    const prepared = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareRequest,
        p_name: 'Declaration Avril 2026.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 2048,
      },
    })
    assert.equal(prepared.status, 200, prepared.raw)
    assert.equal(prepared.data.length, 1)
    documentId = prepared.data[0].document_id
    versionId = prepared.data[0].version_id
    assert.equal(prepared.data[0].workspace_id, workspaceA)
    assert.equal(prepared.data[0].replayed, false)
    assert.match(prepared.data[0].storage_path, new RegExp(`^workspaces/${workspaceA}/documents/${documentId}/versions/${versionId}/source\\.pdf$`))
    assert.equal(psql(`select count(*) from public.agent_documents where id = '${documentId}' and workspace_id = '${workspaceA}';`), '1')
    assert.equal(psql(`select count(*) from public.pro_document_agent_access where document_id = '${documentId}' and agent_id = '${ids.agentA}' and revoked_at is null;`), '1')

    const replay = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareRequest,
        p_name: 'Declaration Avril 2026.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 2048,
      },
    })
    assert.equal(replay.status, 200, replay.raw)
    assert.equal(replay.data[0].document_id, documentId)
    assert.equal(replay.data[0].version_id, versionId)
    assert.equal(replay.data[0].replayed, true)

    const concurrentBody = {
      p_agent_id: ids.agentA,
      p_actor_user_id: ids.userA,
      p_request_id: '50000000-0000-4000-8000-000000000030',
      p_name: 'Concurrent prepare.pdf',
      p_mime_type: 'application/pdf',
      p_size_bytes: 1024,
    }
    const concurrent = await Promise.all([
      api(baseUrl, '/rpc/pro_prepare_document_upload', {
        token: serviceToken,
        method: 'POST',
        body: concurrentBody,
      }),
      api(baseUrl, '/rpc/pro_prepare_document_upload', {
        token: serviceToken,
        method: 'POST',
        body: concurrentBody,
      }),
    ])
    assert.deepEqual(concurrent.map((result) => result.status), [200, 200])
    assert.equal(concurrent[0].data[0].document_id, concurrent[1].data[0].document_id)
    assert.deepEqual(concurrent.map((result) => result.data[0].replayed).sort(), [false, true])
    assert.equal(psql(`
      select count(*)
      from public.pro_document_versions
      where workspace_id = '${workspaceA}'
        and creation_request_id = '${concurrentBody.p_request_id}';
    `), '1')
  })

  await t.test('composite foreign keys reject a cross-workspace agent even for service_role', async () => {
    const forgedVersion = await api(baseUrl, '/pro_document_versions', {
      token: serviceToken,
      method: 'POST',
      body: {
        workspace_id: workspaceB,
        document_id: documentId,
        version_number: 99,
        source_type: 'paste',
      },
    })
    assert.ok([400, 409].includes(forgedVersion.status), forgedVersion.raw)

    const forgedChunk = await api(baseUrl, '/pro_document_chunks', {
      token: serviceToken,
      method: 'POST',
      body: {
        workspace_id: workspaceB,
        document_id: documentId,
        document_version_id: versionId,
        chunk_index: 0,
        content: 'cross-workspace chunk',
      },
    })
    assert.ok([400, 409].includes(forgedChunk.status), forgedChunk.raw)

    const forged = await api(baseUrl, '/pro_document_agent_access', {
      token: serviceToken,
      method: 'POST',
      body: {
        workspace_id: workspaceA,
        document_id: documentId,
        agent_id: ids.agentB,
        grant_source: 'system',
      },
    })
    assert.ok([400, 409].includes(forged.status), forged.raw)

    const allAgents = await api(baseUrl, `/pro_documents?id=eq.${documentId}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { access_mode: 'all_workspace_agents' },
    })
    assertRejected(allAgents, 'phase1c_access_mode_locked')

    const forgedDeletedAt = await api(baseUrl, `/pro_documents?id=eq.${documentId}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { deleted_at: new Date().toISOString() },
    })
    assert.ok([400, 409].includes(forgedDeletedAt.status), forgedDeletedAt.raw)
  })

  let activeClaim
  await t.test('serializes concurrent claims, recovers an expired lease, and rejects the stale worker', async () => {
    const claim = (claimId, requestSuffix) => api(baseUrl, '/rpc/pro_claim_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_claim_id: claimId,
        p_request_id: `70000000-0000-4000-8000-0000000000${requestSuffix}`,
        p_lease_seconds: 300,
      },
    })
    const attempts = await Promise.all([
      claim(ids.claimOne, '01'),
      claim(ids.claimTwo, '02'),
    ])
    const successes = attempts.filter((attempt) => attempt.status === 200)
    const failures = attempts.filter((attempt) => attempt.status >= 400)
    assert.equal(successes.length, 1)
    assert.equal(failures.length, 1)
    assert.match(failures[0].raw, /extraction_in_progress/)
    activeClaim = successes[0].data[0].claim_id

    psql(`
      update public.pro_document_versions
      set processing_started_at = now() - interval '2 minutes',
          processing_expires_at = now() - interval '1 second'
      where id = '${versionId}';
    `)
    const recovered = await claim(ids.claimRecovered, '03')
    assert.equal(recovered.status, 200, recovered.raw)
    assert.equal(recovered.data[0].claim_id, ids.claimRecovered)

    const stale = await api(baseUrl, '/rpc/pro_complete_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_claim_id: activeClaim,
        p_request_id: '71000000-0000-4000-8000-000000000001',
        p_content_sha256: 'a'.repeat(64),
        p_chunks: [{ chunk_index: 0, content: 'stale worker' }],
        p_extraction_metadata: {},
      },
    })
    assertRejected(stale, 'extraction_claim_lost')
  })

  await t.test('rejects processing, failed, and unapproved publication states', async () => {
    const processing = await api(baseUrl, '/rpc/pro_publish_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_request_id: '72000000-0000-4000-8000-000000000001',
      },
    })
    assertRejected(processing, 'document_version_not_publishable')

    const failed = await api(baseUrl, '/rpc/pro_fail_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimRecovered,
        p_request_id: '72000000-0000-4000-8000-000000000002',
        p_error_code: 'test_failure',
      },
    })
    assert.equal(failed.status, 200, failed.raw)

    const failedPublish = await api(baseUrl, '/rpc/pro_publish_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_request_id: '72000000-0000-4000-8000-000000000003',
      },
    })
    assertRejected(failedPublish, 'document_version_not_publishable')
  })

  await t.test('completes both models atomically and makes a repeated finalization idempotent', async () => {
    const claimed = await api(baseUrl, '/rpc/pro_claim_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimFinal,
        p_request_id: '73000000-0000-4000-8000-000000000001',
        p_lease_seconds: 300,
      },
    })
    assert.equal(claimed.status, 200, claimed.raw)

    const body = {
      p_version_id: versionId,
      p_actor_user_id: ids.userA,
      p_claim_id: ids.claimFinal,
      p_request_id: '73000000-0000-4000-8000-000000000002',
      p_content_sha256: 'b'.repeat(64),
      p_chunks: [
        { chunk_index: 0, content: 'Premier fragment valide' },
        { chunk_index: 1, content: 'Second fragment valide' },
      ],
      p_extraction_metadata: { parser: 'phase1b-test' },
    }
    const completions = await Promise.all([
      api(baseUrl, '/rpc/pro_complete_document_extraction', {
        token: serviceToken,
        method: 'POST',
        body,
      }),
      api(baseUrl, '/rpc/pro_complete_document_extraction', {
        token: serviceToken,
        method: 'POST',
        body,
      }),
    ])
    assert.deepEqual(completions.map((result) => result.status), [200, 200])
    assert.deepEqual(completions.map((result) => result.data[0].replayed).sort(), [false, true])
    assert.ok(completions.every((result) => result.data[0].chunk_count === 2))
    assert.equal(psql(`select count(*) from public.pro_document_chunks where document_version_id = '${versionId}';`), '2')
    assert.equal(psql(`select count(*) from public.agent_document_chunks where document_id = '${documentId}';`), '2')

    const unapproved = await api(baseUrl, '/rpc/pro_publish_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_request_id: '73000000-0000-4000-8000-000000000003',
      },
    })
    assertRejected(unapproved, 'document_version_not_publishable')
  })

  await t.test('publishes atomically and freezes the version payload and chunks', async () => {
    const approved = await api(baseUrl, '/rpc/pro_approve_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_request_id: '74000000-0000-4000-8000-000000000001',
      },
    })
    assert.equal(approved.status, 200, approved.raw)

    const published = await api(baseUrl, '/rpc/pro_publish_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionId,
        p_actor_user_id: ids.userA,
        p_request_id: '74000000-0000-4000-8000-000000000002',
      },
    })
    assert.equal(published.status, 200, published.raw)
    assert.equal(published.data[0].ai_enabled, true)
    assert.equal(psql(`select (current_version_id = '${versionId}')::text || ':' || ai_enabled::text from public.pro_documents where id = '${documentId}';`), 'true:true')
    assert.equal(psql(`select approved_for_ai::text || ':' || (published_at is not null)::text from public.pro_document_versions where id = '${versionId}';`), 'true:true')
    assert.equal(psql(`select approved_for_ai from public.agent_documents where id = '${documentId}';`), 't')

    const versionMutation = await api(baseUrl, `/pro_document_versions?id=eq.${versionId}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { storage_path: 'forged/path.pdf' },
    })
    assertRejected(versionMutation, 'published_version_immutable')

    const chunkMutation = await api(baseUrl, `/pro_document_chunks?document_version_id=eq.${versionId}&chunk_index=eq.0`, {
      token: serviceToken,
      method: 'PATCH',
      body: { content: 'mutated' },
    })
    assertRejected(chunkMutation, 'published_version_chunks_immutable')
  })

  await t.test('revokes and restores runtime AI access without changing historical approval', async () => {
    const publishedBefore = psql(`select published_at::text from public.pro_document_versions where id = '${versionId}';`)
    const disabled = await api(baseUrl, '/rpc/pro_set_document_ai_enabled', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_enabled: false,
        p_request_id: '75000000-0000-4000-8000-000000000001',
      },
    })
    assert.equal(disabled.status, 200, disabled.raw)
    assert.equal(disabled.data[0].ai_enabled, false)
    assert.equal(psql(`select approved_for_ai from public.pro_document_versions where id = '${versionId}';`), 't')
    assert.equal(psql(`select approved_for_ai from public.agent_documents where id = '${documentId}';`), 'f')

    const enabled = await api(baseUrl, '/rpc/pro_set_document_ai_enabled', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_enabled: true,
        p_request_id: '75000000-0000-4000-8000-000000000002',
      },
    })
    assert.equal(enabled.status, 200, enabled.raw)
    assert.equal(psql(`select published_at::text from public.pro_document_versions where id = '${versionId}';`), publishedBefore)
  })

  await t.test('rolls back all chunk mutations when one input chunk is invalid', async () => {
    const prepared = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareSecond,
        p_name: 'Rollback.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 512,
      },
    })
    assert.equal(prepared.status, 200, prepared.raw)
    secondDocumentId = prepared.data[0].document_id
    secondVersionId = prepared.data[0].version_id

    const claimed = await api(baseUrl, '/rpc/pro_claim_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: secondVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimSecond,
        p_request_id: '76000000-0000-4000-8000-000000000001',
        p_lease_seconds: 300,
      },
    })
    assert.equal(claimed.status, 200, claimed.raw)

    psql(`
      insert into public.agent_document_chunks(document_id, agent_id, owner_id, workspace_id, chunk_index, content)
      values ('${secondDocumentId}', '${ids.agentA}', '${ids.userA}', '${workspaceA}', 0, 'legacy sentinel');
    `)
    const invalid = await api(baseUrl, '/rpc/pro_complete_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: secondVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimSecond,
        p_request_id: '76000000-0000-4000-8000-000000000002',
        p_content_sha256: 'c'.repeat(64),
        p_chunks: [
          { chunk_index: 0, content: 'first' },
          { chunk_index: 0, content: 'duplicate index' },
        ],
        p_extraction_metadata: {},
      },
    })
    assertRejected(invalid, 'invalid_document_chunks')
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${secondDocumentId}' and chunk_index = 0;`), 'legacy sentinel')
    assert.equal(psql(`select count(*) from public.pro_document_chunks where document_version_id = '${secondVersionId}';`), '0')
    assert.equal(psql(`select extraction_status from public.pro_document_versions where id = '${secondVersionId}';`), 'processing')

    psql(`
      create function public.phase1b_force_legacy_chunk_failure()
      returns trigger
      language plpgsql
      as $failure$
      begin
        if new.document_id = '${secondDocumentId}' and new.content = 'force legacy failure' then
          raise exception 'forced_legacy_chunk_failure';
        end if;
        return new;
      end;
      $failure$;
      create trigger phase1b_force_legacy_chunk_failure
      before insert on public.agent_document_chunks
      for each row execute function public.phase1b_force_legacy_chunk_failure();
    `)
    const forcedFailure = await api(baseUrl, '/rpc/pro_complete_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: secondVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimSecond,
        p_request_id: '76000000-0000-4000-8000-000000000003',
        p_content_sha256: 'c'.repeat(64),
        p_chunks: [{ chunk_index: 0, content: 'force legacy failure' }],
        p_extraction_metadata: {},
      },
    })
    assertRejected(forcedFailure, 'forced_legacy_chunk_failure')
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${secondDocumentId}' and chunk_index = 0;`), 'legacy sentinel')
    assert.equal(psql(`select count(*) from public.pro_document_chunks where document_version_id = '${secondVersionId}';`), '0')
    assert.equal(psql(`select extraction_status from public.pro_document_versions where id = '${secondVersionId}';`), 'processing')
    psql(`
      drop trigger phase1b_force_legacy_chunk_failure on public.agent_document_chunks;
      drop function public.phase1b_force_legacy_chunk_failure();
    `)
  })

  await t.test('accepts the maximum 120 by 5000-character extraction payload through PostgREST', async () => {
    const prepared = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: '50000000-0000-4000-8000-000000000020',
        p_name: 'Maximum payload.txt',
        p_mime_type: 'text/plain',
        p_size_bytes: 600000,
      },
    })
    assert.equal(prepared.status, 200, prepared.raw)
    const maximumDocumentId = prepared.data[0].document_id
    const maximumVersionId = prepared.data[0].version_id
    const maximumClaimId = '60000000-0000-4000-8000-000000000020'

    const claimed = await api(baseUrl, '/rpc/pro_claim_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: maximumVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: maximumClaimId,
        p_request_id: '70000000-0000-4000-8000-000000000020',
        p_lease_seconds: 300,
      },
    })
    assert.equal(claimed.status, 200, claimed.raw)

    const chunks = Array.from({ length: 120 }, (_, chunkIndex) => ({
      chunk_index: chunkIndex,
      content: `${String(chunkIndex).padStart(3, '0')}${'x'.repeat(4997)}`,
    }))
    const completed = await api(baseUrl, '/rpc/pro_complete_document_extraction', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: maximumVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: maximumClaimId,
        p_request_id: '71000000-0000-4000-8000-000000000020',
        p_content_sha256: 'd'.repeat(64),
        p_chunks: chunks,
        p_extraction_metadata: { parser: 'maximum-payload-test' },
      },
    })
    assert.equal(completed.status, 200, completed.raw)
    assert.equal(completed.data[0].chunk_count, 120)
    assert.equal(psql(`select count(*) from public.pro_document_chunks where document_version_id = '${maximumVersionId}';`), '120')
    assert.equal(psql(`select sum(char_length(content)) from public.pro_document_chunks where document_version_id = '${maximumVersionId}';`), '600000')
    assert.equal(psql(`select count(*) from public.agent_document_chunks where document_id = '${maximumDocumentId}';`), '120')
  })

  await t.test('coalesces a 120-chunk legacy statement and reconciles it idempotently', async () => {
    psql(`delete from public.agent_document_chunks where document_id = '${ids.legacyDocumentB}';`)
    psql(`delete from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`)
    psql(`
      insert into public.agent_document_chunks(document_id, agent_id, owner_id, workspace_id, chunk_index, content)
      select '${ids.legacyDocumentB}', '${ids.agentB}', '${ids.userB}', '${workspaceB}', n, 'bulk-' || n
      from generate_series(0, 119) n;
    `)
    assert.equal(psql(`select count(*) from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '1')
    assert.equal(psql(`select dirty_revision from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '1')

    psql(`
      update public.agent_document_chunks
      set content = content || '-updated'
      where document_id = '${ids.legacyDocumentB}';
    `)
    assert.equal(psql(`select count(*) from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '1')
    assert.equal(psql(`select dirty_revision from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '2')

    const reconciled = await api(baseUrl, '/rpc/pro_reconcile_legacy_document', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: ids.legacyDocumentB,
        p_request_id: '77000000-0000-4000-8000-000000000001',
      },
    })
    assert.equal(reconciled.status, 200, reconciled.raw)
    assert.equal(reconciled.data[0].reconciliation_action, 'synchronized')
    assert.equal(psql(`select count(*) from public.pro_document_chunks where document_id = '${ids.legacyDocumentB}';`), '120')
    assert.equal(psql(`select count(*) from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '0')

    const replay = await api(baseUrl, '/rpc/pro_reconcile_legacy_document', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: ids.legacyDocumentB,
        p_request_id: '77000000-0000-4000-8000-000000000002',
      },
    })
    assert.equal(replay.status, 200, replay.raw)
    assert.equal(replay.data[0].replayed, true)
    assert.equal(psql(`select count(*) from public.pro_document_versions where document_id = '${ids.legacyDocumentB}';`), '1')
  })

  await t.test('logically deletes before scheduling Storage and preserves legacy chunks and objects', async () => {
    const pathValue = psql(`select storage_path from public.pro_document_versions where id = '${secondVersionId}';`)
    psql(`
      insert into storage.objects(bucket_id, name, owner_id)
      values ('agent-documents', '${pathValue}', '${ids.userA}');
    `)
    const deleted = await api(baseUrl, '/rpc/pro_delete_document', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: secondDocumentId,
        p_actor_user_id: ids.userA,
        p_request_id: '78000000-0000-4000-8000-000000000001',
      },
    })
    assert.equal(deleted.status, 200, deleted.raw)
    assert.equal(deleted.data[0].lifecycle_status, 'deleting')
    assert.equal(psql(`select status || ':' || approved_for_ai::text from public.agent_documents where id = '${secondDocumentId}';`), 'archived:false')
    assert.equal(psql(`select count(*) from public.agent_document_chunks where document_id = '${secondDocumentId}';`), '1')
    assert.equal(psql(`select count(*) from storage.objects where bucket_id = 'agent-documents' and name = '${pathValue}';`), '1')
    assert.equal(psql(`select count(*) from public.pro_document_storage_jobs where document_id = '${secondDocumentId}' and status = 'pending';`), '1')

    const stalePrepareReplay = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareSecond,
        p_name: 'Rollback.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 512,
      },
    })
    assertRejected(stalePrepareReplay, 'document_not_active')
    assert.equal(psql(`select count(*) from public.pro_document_versions where creation_request_id = '${ids.prepareSecond}';`), '1')
  })

  await t.test('keeps audit append-only', async () => {
    const auditId = psql('select min(id) from public.pro_audit_events;')
    const changed = await api(baseUrl, `/pro_audit_events?id=eq.${auditId}`, {
      token: serviceToken,
      method: 'PATCH',
      body: { event_type: 'forged' },
    })
    assertRejected(changed, 'audit_events_append_only')

    const removed = await api(baseUrl, `/pro_audit_events?id=eq.${auditId}`, {
      token: serviceToken,
      method: 'DELETE',
    })
    assertRejected(removed, 'audit_events_append_only')
  })
})
