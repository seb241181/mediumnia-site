import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migration = path.join(root, 'supabase/migrations/20261014210000_email_question_paypal_webhook_hardening.sql')
const container = `mediumia-question-webhook-${process.pid}-${Date.now()}`
const questionId = '11111111-2222-4333-8444-555555555555'
const eventId = 'WH-3F562076HD293871E-75F399086E414290U'
const captureId = '3Y662965014333303'
const orderId = '9P99943869582473S'

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', input })
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function psql(sql, options = {}) {
  return docker([
    'exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-q',
    '-U', 'postgres', '-d', 'postgres', '-c', sql,
  ], options)
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-q',
      '-U', 'postgres', '-d', 'postgres', '-c', sql,
    ], { cwd: root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)))
  })
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = docker([
      'exec', container, 'psql', '-At', '-q', '-U', 'postgres', '-d', 'postgres', '-c', 'select 1',
    ], { allowFailure: true })
    if (ready.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('PostgreSQL local did not become ready')
}

const claimSql = (id = eventId, capture = captureId) => `
  set role service_role;
  select claimed::text || '|' || event_status
  from public.claim_email_question_paypal_event(
    '${id}', 'PAYMENT.CAPTURE.COMPLETED', '${capture}', '${orderId}', '${questionId}'::uuid
  );
`

test('claim PayPal webhook est atomique avec plusieurs connexions PostgreSQL', async (t) => {
  docker([
    'run', '-d', '--name', container,
    '-e', 'POSTGRES_PASSWORD=mediumia_test_password',
    '-e', 'POSTGRES_DB=postgres',
    'postgres:16-alpine',
  ])
  t.after(() => docker(['rm', '-f', container], { allowFailure: true }))
  await waitForPostgres()

  psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.mediumia_email_questions (id uuid primary key);
    insert into public.mediumia_email_questions(id) values ('${questionId}');
  `)
  docker(['cp', migration, `${container}:/tmp/webhook-hardening.sql`])
  docker(['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', '/tmp/webhook-hardening.sql'])

  const concurrent = await Promise.all(Array.from({ length: 8 }, () => psqlAsync(claimSql())))
  assert.equal(concurrent.filter((value) => value === 'true|processing').length, 1)
  assert.equal(concurrent.filter((value) => value === 'false|processing').length, 7)

  assert.equal(psql(`set role service_role; select public.finish_email_question_paypal_event('${eventId}', 'completed');`).stdout.trim(), 't')
  const replay = await Promise.all(Array.from({ length: 4 }, () => psqlAsync(claimSql())))
  assert.deepEqual(new Set(replay), new Set(['false|completed']))

  const secondEvent = 'WH-4F562076HD293871E-75F399086E414290U'
  assert.equal(psql(claimSql(secondEvent, captureId)).stdout.trim(), 'false|capture_claimed')

  const retryEvent = 'WH-5F562076HD293871E-75F399086E414290U'
  const retryCapture = '4Y662965014333303'
  assert.equal(psql(claimSql(retryEvent, retryCapture)).stdout.trim(), 'true|processing')
  assert.equal(psql(`set role service_role; select public.finish_email_question_paypal_event('${retryEvent}', 'retryable', 'provider_503');`).stdout.trim(), 't')
  assert.equal(psql(claimSql(retryEvent, retryCapture)).stdout.trim(), 'true|processing')
  assert.equal(psql(`select attempt_count from public.mediumia_email_question_paypal_events where event_id='${retryEvent}';`).stdout.trim(), '2')

  const denied = psql(`set role anon; select * from public.claim_email_question_paypal_event('${eventId}', 'PAYMENT.CAPTURE.COMPLETED', '${captureId}', '${orderId}', '${questionId}'::uuid);`, { allowFailure: true })
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /permission denied/i)
})
