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
const jwtSecret = 'mediumia-phase1b-edge-local-jwt-secret-at-least-thirty-two-characters'
const suffix = `${process.pid}-${Date.now()}`
const postgresName = `mediumia-pro-edge-pg-${suffix}`
const postgrestName = `mediumia-pro-edge-rest-${suffix}`
const networkName = `mediumia-pro-edge-net-${suffix}`

const ids = {
  userA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  agentA: '20000000-0000-4000-8000-000000000001',
  legacyDocumentB: '40000000-0000-4000-8000-000000000002',
  prepareV1: '51000000-0000-4000-8000-000000000001',
  prepareText: '51000000-0000-4000-8000-000000000021',
  claimText: '61000000-0000-4000-8000-000000000021',
  claimRequestText: '51000000-0000-4000-8000-000000000022',
  completeText: '51000000-0000-4000-8000-000000000023',
  markV1: '51000000-0000-4000-8000-000000000002',
  claimV1: '61000000-0000-4000-8000-000000000001',
  claimRequestV1: '51000000-0000-4000-8000-000000000003',
  completeV1: '51000000-0000-4000-8000-000000000004',
  approveV1: '51000000-0000-4000-8000-000000000005',
  publishV1: '51000000-0000-4000-8000-000000000006',
  prepareV2: '51000000-0000-4000-8000-000000000007',
  abandonV2: '51000000-0000-4000-8000-000000000008',
  crossAbandon: '51000000-0000-4000-8000-000000000009',
  crossText: '51000000-0000-4000-8000-000000000024',
  storageClaimOne: '61000000-0000-4000-8000-000000000010',
  storageClaimRequestOne: '51000000-0000-4000-8000-000000000010',
  storageFailOne: '51000000-0000-4000-8000-000000000011',
  storageClaimTwo: '61000000-0000-4000-8000-000000000011',
  storageClaimRequestTwo: '51000000-0000-4000-8000-000000000012',
  storageCompleteTwo: '51000000-0000-4000-8000-000000000013',
  deleteDocument: '51000000-0000-4000-8000-000000000014',
  storageClaimDelete: '61000000-0000-4000-8000-000000000012',
  storageClaimRequestDelete: '51000000-0000-4000-8000-000000000015',
  storageCompleteDelete: '51000000-0000-4000-8000-000000000016',
  finalizeDelete: '51000000-0000-4000-8000-000000000017',
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
  const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
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

async function api(baseUrl, route, { token, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    Prefer: 'return=representation',
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

function assertRejected(result, code) {
  assert.ok(result.status >= 400, `Expected rejection, got ${result.status}: ${result.raw}`)
  assert.match(result.raw, new RegExp(code))
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

test('MediumIA Pro Phase 1B-B adds a safe Edge bridge contract on PostgreSQL 17', async (t) => {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const serviceToken = tokenFor('00000000-0000-4000-8000-000000000000', 'service_role')
  let workspaceA
  let documentId
  let versionV1
  let versionV2
  let abandonedStorageJob

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
  applySql(path.join(migrationsDir, '20260910184117_mediumia_pro_phase1b_document_shadow.sql'))

  const ragBefore = psql("select md5(pg_get_functiondef('public.search_agent_document_chunks(uuid,text,integer)'::regprocedure));")
  applySql(path.join(migrationsDir, '20260911120000_mediumia_pro_phase1b_edge_bridge_support.sql'))
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

  workspaceA = psql(`select workspace_id from public.agents where id = '${ids.agentA}';`)

  await t.test('migration is additive, server-only and keeps the RAG MD5 unchanged', async () => {
    assert.equal(ragAfter, ragBefore)
    const signatures = [
      'public.pro_prepare_text_document(uuid,uuid,uuid,text,text,bigint)',
      'public.pro_abandon_document_version(uuid,uuid,uuid)',
      'public.pro_claim_document_storage_job(uuid,uuid,uuid,uuid,integer)',
      'public.pro_complete_document_storage_job(uuid,uuid,uuid,uuid)',
      'public.pro_fail_document_storage_job(uuid,uuid,uuid,uuid,text,integer)',
      'public.pro_finalize_document_deletion(uuid,uuid,uuid)',
    ]
    for (const signature of signatures) {
      assert.equal(psql(`select has_function_privilege('authenticated', '${signature}', 'execute');`), 'f')
      assert.equal(psql(`select has_function_privilege('service_role', '${signature}', 'execute');`), 't')
      assert.equal(psql(`select coalesce(array_to_string(proconfig, ','), '') from pg_proc where oid = '${signature}'::regprocedure;`), 'search_path=""')
    }
    assert.equal(psql(`
      select count(*) from information_schema.columns
      where table_schema = 'public'
        and table_name = 'pro_document_storage_jobs'
        and column_name in (
          'processing_claim_id', 'processing_expires_at', 'last_claim_id',
          'claim_request_id', 'completion_request_id', 'failure_request_id'
        );
    `), '6')
  })

  await t.test('pasted text is prepared idempotently and completed atomically in both models', async () => {
    const prepareBody = {
      p_agent_id: ids.agentA,
      p_actor_user_id: ids.userA,
      p_request_id: ids.prepareText,
      p_name: 'Source métier',
      p_content_sha256: 'b'.repeat(64),
      p_size_bytes: 27,
    }
    const prepared = await api(baseUrl, '/rpc/pro_prepare_text_document', {
      token: serviceToken,
      method: 'POST',
      body: prepareBody,
    })
    assert.equal(prepared.status, 200, prepared.raw)
    const textDocumentId = prepared.data[0].document_id
    const textVersionId = prepared.data[0].version_id

    const replay = await api(baseUrl, '/rpc/pro_prepare_text_document', {
      token: serviceToken,
      method: 'POST',
      body: prepareBody,
    })
    assert.equal(replay.status, 200, replay.raw)
    assert.equal(replay.data[0].document_id, textDocumentId)
    assert.equal(replay.data[0].replayed, true)

    const conflict = await api(baseUrl, '/rpc/pro_prepare_text_document', {
      token: serviceToken,
      method: 'POST',
      body: { ...prepareBody, p_content_sha256: 'c'.repeat(64) },
    })
    assertRejected(conflict, 'request_id_conflict')

    for (const [route, body] of [
      ['/rpc/pro_claim_document_extraction', {
        p_version_id: textVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimText,
        p_request_id: ids.claimRequestText,
        p_lease_seconds: 300,
      }],
      ['/rpc/pro_complete_document_extraction', {
        p_version_id: textVersionId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimText,
        p_request_id: ids.completeText,
        p_content_sha256: 'b'.repeat(64),
        p_chunks: [{ chunk_index: 0, content: 'Pasted bridge content' }],
        p_extraction_metadata: { extraction_parser: 'pasted-text', chunks: 1 },
      }],
    ]) {
      const result = await api(baseUrl, route, { token: serviceToken, method: 'POST', body })
      assert.equal(result.status, 200, result.raw)
    }

    assert.equal(psql(`select source_type || ':' || status from public.agent_documents where id = '${textDocumentId}';`), 'paste:ready')
    assert.equal(psql(`select source_type || ':' || extraction_status from public.pro_document_versions where id = '${textVersionId}';`), 'paste:ready')
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${textDocumentId}';`), 'Pasted bridge content')
    assert.equal(psql(`select count(*) from public.pro_document_sync_queue where document_id = '${textDocumentId}';`), '0')
  })

  await t.test('creates, extracts, approves and publishes v1 through existing atomic RPCs', async () => {
    const prepared = await api(baseUrl, '/rpc/pro_prepare_document_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareV1,
        p_name: 'bridge.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 128,
      },
    })
    assert.equal(prepared.status, 200, prepared.raw)
    documentId = prepared.data[0].document_id
    versionV1 = prepared.data[0].version_id

    for (const [route, body] of [
      ['/rpc/pro_mark_document_version_uploaded', {
        p_version_id: versionV1,
        p_actor_user_id: ids.userA,
        p_request_id: ids.markV1,
      }],
      ['/rpc/pro_claim_document_extraction', {
        p_version_id: versionV1,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimV1,
        p_request_id: ids.claimRequestV1,
        p_lease_seconds: 300,
      }],
      ['/rpc/pro_complete_document_extraction', {
        p_version_id: versionV1,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.claimV1,
        p_request_id: ids.completeV1,
        p_content_sha256: 'a'.repeat(64),
        p_chunks: [{ chunk_index: 0, content: 'Bridge v1 published content' }],
        p_extraction_metadata: { extraction_parser: 'integration-test', chunks: 1 },
      }],
      ['/rpc/pro_approve_document_version', {
        p_version_id: versionV1,
        p_actor_user_id: ids.userA,
        p_request_id: ids.approveV1,
      }],
      ['/rpc/pro_publish_document_version', {
        p_version_id: versionV1,
        p_actor_user_id: ids.userA,
        p_request_id: ids.publishV1,
      }],
    ]) {
      const result = await api(baseUrl, route, { token: serviceToken, method: 'POST', body })
      assert.equal(result.status, 200, result.raw)
    }

    assert.equal(psql(`select (current_version_id = '${versionV1}')::text || ':' || ai_enabled::text from public.pro_documents where id = '${documentId}';`), 'true:true')
    assert.equal(psql(`select status || ':' || approved_for_ai::text from public.agent_documents where id = '${documentId}';`), 'ready:true')
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${documentId}';`), 'Bridge v1 published content')
  })

  await t.test('an abandoned N+1 never changes current_version, legacy chunks or approval', async () => {
    const prepared = await api(baseUrl, '/rpc/pro_prepare_document_version_upload', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_request_id: ids.prepareV2,
        p_name: 'bridge-v2.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 256,
      },
    })
    assert.equal(prepared.status, 200, prepared.raw)
    versionV2 = prepared.data[0].version_id
    assert.equal(psql(`select current_version_id from public.pro_documents where id = '${documentId}';`), versionV1)
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${documentId}';`), 'Bridge v1 published content')

    const abandoned = await api(baseUrl, '/rpc/pro_abandon_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionV2,
        p_actor_user_id: ids.userA,
        p_request_id: ids.abandonV2,
      },
    })
    assert.equal(abandoned.status, 200, abandoned.raw)
    assert.equal(abandoned.data[0].replayed, false)
    const replay = await api(baseUrl, '/rpc/pro_abandon_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionV2,
        p_actor_user_id: ids.userA,
        p_request_id: ids.abandonV2,
      },
    })
    assert.equal(replay.status, 200, replay.raw)
    assert.equal(replay.data[0].replayed, true)

    assert.equal(psql(`select extraction_status || ':' || error_code from public.pro_document_versions where id = '${versionV2}';`), 'failed:upload_abandoned')
    assert.equal(psql(`select current_version_id from public.pro_documents where id = '${documentId}';`), versionV1)
    assert.equal(psql(`select status || ':' || approved_for_ai::text from public.agent_documents where id = '${documentId}';`), 'ready:true')
    assert.equal(psql(`select content from public.agent_document_chunks where document_id = '${documentId}';`), 'Bridge v1 published content')
    assert.equal(psql(`select count(*) from public.pro_document_storage_jobs where document_version_id = '${versionV2}';`), '1')
    abandonedStorageJob = psql(`select id from public.pro_document_storage_jobs where document_version_id = '${versionV2}';`)
  })

  await t.test('support RPCs reject a cross-workspace actor', async () => {
    const textRejected = await api(baseUrl, '/rpc/pro_prepare_text_document', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_agent_id: ids.agentA,
        p_actor_user_id: ids.userB,
        p_request_id: ids.crossText,
        p_name: 'Forged source',
        p_content_sha256: 'd'.repeat(64),
        p_size_bytes: 13,
      },
    })
    assertRejected(textRejected, 'workspace_membership_required')

    const rejected = await api(baseUrl, '/rpc/pro_abandon_document_version', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_version_id: versionV2,
        p_actor_user_id: ids.userB,
        p_request_id: ids.crossAbandon,
      },
    })
    assertRejected(rejected, 'workspace_membership_required')
  })

  await t.test('Storage failure is retryable and only the newest claim can complete', async () => {
    const firstClaim = await api(baseUrl, '/rpc/pro_claim_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimOne,
        p_request_id: ids.storageClaimRequestOne,
        p_lease_seconds: 120,
      },
    })
    assert.equal(firstClaim.status, 200, firstClaim.raw)
    assert.equal(firstClaim.data[0].job_id, abandonedStorageJob)

    const failed = await api(baseUrl, '/rpc/pro_fail_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: abandonedStorageJob,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimOne,
        p_request_id: ids.storageFailOne,
        p_error_code: 'storage_unavailable',
        p_retry_seconds: 0,
      },
    })
    assert.equal(failed.status, 200, failed.raw)
    assert.equal(failed.data[0].job_status, 'failed')
    const failedReplay = await api(baseUrl, '/rpc/pro_fail_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: abandonedStorageJob,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimOne,
        p_request_id: ids.storageFailOne,
        p_error_code: 'storage_unavailable',
        p_retry_seconds: 0,
      },
    })
    assert.equal(failedReplay.status, 200, failedReplay.raw)
    assert.equal(failedReplay.data[0].replayed, true)

    const secondClaim = await api(baseUrl, '/rpc/pro_claim_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimTwo,
        p_request_id: ids.storageClaimRequestTwo,
        p_lease_seconds: 120,
      },
    })
    assert.equal(secondClaim.status, 200, secondClaim.raw)
    assert.equal(secondClaim.data[0].attempts, 2)

    const staleComplete = await api(baseUrl, '/rpc/pro_complete_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: abandonedStorageJob,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimOne,
        p_request_id: '51000000-0000-4000-8000-000000000099',
      },
    })
    assertRejected(staleComplete, 'storage_job_claim_lost')

    const completed = await api(baseUrl, '/rpc/pro_complete_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: abandonedStorageJob,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimTwo,
        p_request_id: ids.storageCompleteTwo,
      },
    })
    assert.equal(completed.status, 200, completed.raw)
    assert.equal(psql(`select status || ':' || attempts::text from public.pro_document_storage_jobs where id = '${abandonedStorageJob}';`), 'completed:2')
  })

  await t.test('document deletion neutralizes DB before Storage completion and finalizes idempotently', async () => {
    const requested = await api(baseUrl, '/rpc/pro_delete_document', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_request_id: ids.deleteDocument,
      },
    })
    assert.equal(requested.status, 200, requested.raw)
    assert.equal(psql(`select lifecycle_status || ':' || ai_enabled::text from public.pro_documents where id = '${documentId}';`), 'deleting:false')
    assert.equal(psql(`select status || ':' || approved_for_ai::text from public.agent_documents where id = '${documentId}';`), 'archived:false')
    assert.equal(psql(`select count(*) from public.pro_document_agent_access where document_id = '${documentId}' and revoked_at is null;`), '0')

    const claim = await api(baseUrl, '/rpc/pro_claim_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimDelete,
        p_request_id: ids.storageClaimRequestDelete,
        p_lease_seconds: 120,
      },
    })
    assert.equal(claim.status, 200, claim.raw)
    assert.equal(claim.data[0].version_id, versionV1)
    const jobId = claim.data[0].job_id

    const completed = await api(baseUrl, '/rpc/pro_complete_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: jobId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimDelete,
        p_request_id: ids.storageCompleteDelete,
      },
    })
    assert.equal(completed.status, 200, completed.raw)
    const completedReplay = await api(baseUrl, '/rpc/pro_complete_document_storage_job', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_job_id: jobId,
        p_actor_user_id: ids.userA,
        p_claim_id: ids.storageClaimDelete,
        p_request_id: ids.storageCompleteDelete,
      },
    })
    assert.equal(completedReplay.status, 200, completedReplay.raw)
    assert.equal(completedReplay.data[0].replayed, true)

    const finalized = await api(baseUrl, '/rpc/pro_finalize_document_deletion', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_request_id: ids.finalizeDelete,
      },
    })
    assert.equal(finalized.status, 200, finalized.raw)
    assert.equal(finalized.data[0].lifecycle_status, 'deleted')
    const finalizedReplay = await api(baseUrl, '/rpc/pro_finalize_document_deletion', {
      token: serviceToken,
      method: 'POST',
      body: {
        p_document_id: documentId,
        p_actor_user_id: ids.userA,
        p_request_id: ids.finalizeDelete,
      },
    })
    assert.equal(finalizedReplay.status, 200, finalizedReplay.raw)
    assert.equal(finalizedReplay.data[0].replayed, true)
  })

  await t.test('legacy-only writes remain operational and are queued for Phase 1B-C', () => {
    assert.equal(psql(`select count(*) from public.pro_documents where id = '${ids.legacyDocumentB}';`), '0')
    psql(`update public.agent_documents set approved_for_ai = false, approved_at = null where id = '${ids.legacyDocumentB}';`)
    assert.equal(psql(`select approved_for_ai from public.agent_documents where id = '${ids.legacyDocumentB}';`), 'f')
    assert.equal(psql(`select count(*) from public.pro_document_sync_queue where document_id = '${ids.legacyDocumentB}';`), '1')
    assert.equal(psql(`select count(*) from public.pro_documents where id = '${ids.legacyDocumentB}';`), '0')
  })

  await t.test('workspace provenance remains consistent for every bridge row', () => {
    assert.equal(psql(`
      select count(*)
      from public.pro_document_storage_jobs j
      join public.pro_document_versions v
        on v.workspace_id = j.workspace_id
       and v.id = j.document_version_id
       and v.document_id = j.document_id
      where j.document_id = '${documentId}'
        and j.workspace_id = '${workspaceA}';
    `), '2')
  })
})
