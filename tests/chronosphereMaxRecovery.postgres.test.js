import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { recoverMaxReading } from '../lib/chronosphereMaxRecovery.js'
/* global process */

// Explicit opt-in; no connection string, host port or existing database accepted.
const enabled = process.env.CHRONOSPHERE_LOCAL_POSTGRES === '1'
const container = `chronosphere-p1-test-${process.pid}-${randomUUID().slice(0, 8)}`
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (data) => { out += data })
    child.stderr.on('data', (data) => { err += data })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err)))
    child.stdin.end(input)
  })
}
const sql = (query) => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], query)
const literal = (value) => value == null ? 'null' : typeof value === 'boolean' ? String(value)
  : `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`
const rpc = async (name, args) => {
  assert.match(name, /^[a-z_]+$/)
  const params = Object.entries(args).map(([key, value]) => {
    assert.match(key, /^p_[a-z_]+$/)
    return `${key} => ${literal(value)}`
  })
  try {
    const raw = await sql(`select to_json(public.${name}(${params.join(',')}));`)
    return { data: raw ? JSON.parse(raw) : null, error: null }
  } catch (error) { return { data: null, error } }
}
const profile = { fullName: 'Local Fixture', birthDate: '1990-01-01', birthTime: '12:00', birthPlace: 'Paris' }
const result = (credits = {}) => ({
  schemaVersion: 'chronosphere-v2', engineVersion: 'local-test', createdAt: new Date().toISOString(),
  theme: 'projet', profile, cards: [{ number: 1, name: 'Fixture', gesture: 'Respirer', decree: 'Avancer' }],
  reading: { summary30s: 'Lecture de test', sections: [], whyNow: [], realignmentAct: { gesture: 'Respirer', decree: 'Avancer' } },
  ...credits,
})

test('MAX recovery on isolated PostgreSQL (no external network)', { skip: !enabled, timeout: 120000 }, async (t) => {
  await command(['run', '-d', '--rm', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'])
  t.after(() => command(['rm', '-f', container]))
  for (let i = 0; ; i++) {
    try { await sql('select 1;'); break } catch (error) {
      if (i === 100) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  await sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
  const migrations = [
    '20260905210000_chronosphere_credit_packs.sql',
    '20260908174000_mediumia_global_user_profiles.sql',
    '20260923143000_chronosphere_max_memory_foundation.sql',
    '20260923154500_chronosphere_max_launch.sql',
    '20260923170000_chronosphere_max_timeline_client_readonly.sql',
    '20261003105932_chronosphere_max_recovery.sql',
  ]
  for (const file of migrations) await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))

  async function fixture(remaining = 3, product = 'max3') {
    const userId = randomUUID(), packId = randomUUID(), packToken = randomUUID()
    const hash = createHash('sha256').update(packToken).digest('hex')
    await sql(`insert into auth.users values (${literal(userId)});
      insert into public.chronosphere_credit_packs
      (id,user_id,pack_token_hash,paypal_order_id,paypal_capture_id,paypal_env,amount_cents,product_type,credits_remaining,status,consent_version,consent_accepted_at,captured_at)
      values (${literal(packId)},${literal(userId)},${literal(hash)},${literal(randomUUID())},${literal(randomUUID())},'sandbox',${product === 'max3' ? 1990 : 990},${literal(product)},${remaining},'active','fixture',now(),now());`)
    const request = { maxReadNonce: randomUUID(), profile, numbers: [1, 2, 3], theme: 'projet', deliveryEmail: 'fixture@example.invalid' }
    let generations = 0, failPublish = false, failGenerate = false, failComplete = false, loseCompleteReply = false
    let gate = null
    const supabase = { rpc: async (name, args) => {
      if (name === 'publish_chronosphere_max_attempt' && failPublish) return { error: new Error('injected publication failure') }
      if (name === 'complete_chronosphere_pack_draw' && failComplete) return { error: new Error('injected completion failure') }
      if (name === 'complete_chronosphere_pack_draw' && loseCompleteReply) {
        await rpc(name, args)
        return { error: new Error('injected lost response') }
      }
      return rpc(name, args)
    } }
    const run = (action = 'start', overrides = {}) => recoverMaxReading({
      supabase, userId, packToken, action, request: { ...request, ...overrides },
      generate: async ({ credits }) => {
        generations++
        if (gate) await gate
        if (failGenerate) throw new Error('injected calculation failure')
        return result(credits)
      }, deliver: async ({ pack }) => {
        assert.equal(pack.product, 'max3')
        assert.equal(pack.creditsRemaining, await Number(await sql(`select credits_remaining from chronosphere_credit_packs where id=${literal(packId)}`)))
        assert.ok(pack.expiresAt)
        return { email: 'fixture' }
      },
    })
    return { userId, packId, hash, request, run, supabase,
      generations: () => generations, setPublishFailure: (v) => { failPublish = v },
      setGenerateFailure: (v) => { failGenerate = v }, setGate: (v) => { gate = v },
      setCompleteFailure: (v) => { failComplete = v }, setLoseCompleteReply: (v) => { loseCompleteReply = v },
      balance: async () => Number(await sql(`select credits_remaining from chronosphere_credit_packs where id=${literal(packId)}`)),
      state: async () => (await rpc('read_chronosphere_max_attempt', { p_user_id: userId })).data,
    }
  }

  await t.test('publication failure, reload and same identifier recover the last credit without recalculation', async () => {
    const f = await fixture(1)
    f.setPublishFailure(true)
    await assert.rejects(f.run(), /max_recovery_unavailable/)
    const pending = await f.state()
    assert.equal(pending.draw.status, 'completed')
    assert.equal(await f.balance(), 0)
    f.setPublishFailure(false)
    const recovered = await f.run('inspect', { attemptId: pending.attempt.id })
    const replay = await f.run('retry', { attemptId: pending.attempt.id })
    assert.equal(recovered.max.sequenceNumber, 1)
    assert.equal(replay.max.sequenceNumber, 1)
    assert.equal(f.generations(), 1)
    assert.equal((await f.state()).entries.length, 1)
    assert.equal(await f.balance(), 0)
  })
  await t.test('parallel different nonces converge; reads 1/2/3 have unique ranks and exact debits', async () => {
    const f = await fixture()
    const values = await Promise.all([f.run(), f.run('start', { maxReadNonce: randomUUID() })])
    assert.equal(values[0].attempt.id, values[1].attempt.id)
    let last = await f.run('retry', { attemptId: values[0].attempt.id })
    assert.equal(f.generations(), 1)
    for (const sequence of [2, 3]) {
      last = await f.run('start', { maxReadNonce: randomUUID(), previousAttemptId: last.attempt.id })
      assert.equal(last.max.sequenceNumber, sequence)
    }
    assert.equal(await f.balance(), 0)
    assert.equal(f.generations(), 3)
    assert.deepEqual((await f.state()).entries.map((entry) => entry.sequence_number), [1, 2, 3])
    assert.ok(last.max.finalSynthesis)
  })
  await t.test('failed computation returns the credit exactly once and retries the same draw', async () => {
    const f = await fixture(1)
    f.setGenerateFailure(true)
    await assert.rejects(f.run(), /injected calculation failure/)
    const failed = await f.state()
    assert.equal(failed.draw.status, 'failed')
    assert.equal(await f.balance(), 1)
    f.setGenerateFailure(false)
    const recovered = await f.run('retry', { attemptId: failed.attempt.id })
    assert.equal(recovered.max.sequenceNumber, 1)
    assert.equal((await f.state()).draw.id, failed.draw.id)
    assert.equal(await f.balance(), 0)
    assert.equal(f.generations(), 2)
  })
  await t.test('completion failure after debit refunds once and the same attempt remains retryable', async () => {
    const f = await fixture(1)
    f.setCompleteFailure(true)
    await assert.rejects(f.run(), (error) => error.attempt?.canEdit === true)
    const failed = await f.state()
    assert.equal(failed.draw.status, 'failed')
    assert.equal(await f.balance(), 1)
    f.setCompleteFailure(false)
    const recovered = await f.run('retry', { attemptId: failed.attempt.id })
    assert.equal(recovered.max.sequenceNumber, 1)
    assert.equal((await f.state()).draw.id, failed.draw.id)
    assert.equal(await f.balance(), 0)
  })
  await t.test('lost completion reply does not refund a completed draw', async () => {
    const f = await fixture(1)
    f.setLoseCompleteReply(true)
    await assert.rejects(f.run(), (error) => error.attempt?.status === 'recoverable')
    const completed = await f.state()
    assert.equal(completed.draw.status, 'completed')
    assert.equal(await f.balance(), 0)
    f.setLoseCompleteReply(false)
    const recovered = await f.run('inspect', { attemptId: completed.attempt.id })
    assert.equal(recovered.max.sequenceNumber, 1)
    assert.equal(f.generations(), 1)
    assert.equal(await f.balance(), 0)
  })
  await t.test('double click during generation does not calculate or consume again', async () => {
    const f = await fixture()
    let release
    f.setGate(new Promise((resolve) => { release = resolve }))
    const first = f.run()
    for (let i = 0; f.generations() === 0; i++) {
      if (i > 100) throw new Error('generation did not start')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    try {
      const second = await f.run()
      assert.equal(second.error, 'max_in_progress')
      assert.equal(f.generations(), 1)
      assert.equal(await f.balance(), 2)
    } finally { release() }
    await first
  })
  await t.test('owner boundaries and service-only privileges', async () => {
    const f = await fixture(), other = await fixture()
    const output = await f.run()
    assert.equal((await rpc('read_chronosphere_max_attempt', { p_user_id: other.userId, p_attempt_id: output.attempt.id })).data, null)
    assert.ok((await rpc('claim_chronosphere_max_attempt', { p_user_id: other.userId, p_attempt_id: output.attempt.id, p_allow_reserve: true })).error)
    assert.equal(await sql("select has_function_privilege('authenticated','public.read_chronosphere_max_attempt(uuid,uuid)','execute')"), 'f')
    assert.equal(await sql("select has_table_privilege('authenticated','public.chronosphere_max_attempts','select')"), 'f')
  })
  await t.test('refunded input can be corrected without changing the attempt or draw', async () => {
    const f = await fixture()
    f.setGenerateFailure(true)
    await assert.rejects(f.run(), (error) => error.attempt?.canEdit === true)
    const failed = await f.state()
    f.setGenerateFailure(false)
    const recovered = await f.run('start', { theme: 'travail', replaceRequest: true })
    const state = await f.state()
    assert.equal(recovered.attempt.id, failed.attempt.id)
    assert.equal(state.draw.id, failed.draw.id)
    assert.equal(state.attempt.request_json.theme, 'travail')
    await f.run('start', { theme: 'do-not-overwrite' })
    assert.equal((await f.state()).attempt.request_json.theme, 'travail')
    assert.equal(await f.balance(), 2)
  })
  await t.test('identical nonce freezes input until an explicit correction', async () => {
    const f = await fixture()
    const args = { p_user_id: f.userId, p_pack_token_hash: f.hash, p_nonce: f.request.maxReadNonce, p_request: f.request }
    const id = (await rpc('begin_chronosphere_max_attempt', args)).data
    const changed = { ...f.request, theme: 'forged-duplicate' }
    assert.equal((await rpc('begin_chronosphere_max_attempt', { ...args, p_request: changed })).data, id)
    assert.equal((await f.state()).attempt.request_json.theme, 'projet')
    assert.equal(await f.balance(), 3)
  })
  await t.test('exhausted pack cannot create a ghost attempt after its final published result', async () => {
    const f = await fixture(1)
    const last = await f.run()
    assert.equal(await f.balance(), 0)
    await assert.rejects(f.run('start', { maxReadNonce: randomUUID(), previousAttemptId: last.attempt.id }), /max_recovery_unavailable/)
    assert.equal(await sql(`select count(*) from chronosphere_max_attempts where pack_id=${literal(f.packId)}`), '1')
    assert.equal((await f.run('inspect')).attempt.id, last.attempt.id)
    assert.equal(await f.balance(), 0)
  })
  await t.test('publication constraint failure rolls back all memory writes and permits replay', async () => {
    const f = await fixture(1)
    f.setPublishFailure(true)
    await assert.rejects(f.run(), /max_recovery_unavailable/)
    f.setPublishFailure(false)
    const state = await f.state()
    const bad = await rpc('publish_chronosphere_max_attempt', {
      p_user_id: f.userId, p_attempt_id: state.attempt.id,
      p_snapshot: { schemaVersion: 'chronosphere-max-snapshot-v1', sourceDraw: { id: randomUUID() } },
      p_comparison: null,
    })
    assert.ok(bad.error)
    assert.equal(await sql(`select count(*) from chronosphere_timelines where max_pack_id=${literal(f.packId)}`), '0')
    assert.equal(await sql(`select count(*) from mediumia_profiles where user_id=${literal(f.userId)}`), '0')
    assert.equal((await f.run('retry', { attemptId: state.attempt.id })).max.sequenceNumber, 1)
    assert.equal(f.generations(), 1)
    assert.equal(await f.balance(), 0)
  })
  await t.test('second migration application fails atomically without altering existing attempts', async () => {
    const f = await fixture()
    await f.run()
    const before = await sql('select count(*) from chronosphere_max_attempts')
    const migration = await readFile(new URL(`../supabase/migrations/${migrations.at(-1)}`, import.meta.url), 'utf8')
    await assert.rejects(sql(migration), /already exists/)
    assert.equal(await sql('select count(*) from chronosphere_max_attempts'), before)
    assert.equal((await f.state()).entries.length, 1)
  })
  await t.test('stale worker cannot complete or refund a replacement claim', async () => {
    const f = await fixture(1)
    const args = { p_user_id: f.userId, p_pack_token_hash: f.hash, p_nonce: f.request.maxReadNonce, p_request: f.request }
    const id = (await rpc('begin_chronosphere_max_attempt', args)).data
    const claimArgs = { p_user_id: f.userId, p_attempt_id: id, p_allow_reserve: true }
    const old = (await rpc('claim_chronosphere_max_attempt', claimArgs)).data
    await sql(`update chronosphere_pack_draws set processing_started_at=now()-interval '10 minutes' where id=${literal(old.draw_id)}`)
    const fresh = (await rpc('claim_chronosphere_max_attempt', claimArgs)).data
    assert.equal(fresh.recovered, true)
    assert.notEqual(fresh.claim_id, old.claim_id)
    assert.equal((await rpc('complete_chronosphere_pack_draw', { p_draw_id: old.draw_id, p_claim_id: old.claim_id, p_result_json: result() })).data, false)
    assert.equal((await rpc('release_chronosphere_pack_credit', { p_draw_id: old.draw_id, p_claim_id: old.claim_id, p_failure_code: 'fixture' })).data.released, false)
    assert.equal(await f.balance(), 0)
    assert.equal((await rpc('complete_chronosphere_pack_draw', { p_draw_id: fresh.draw_id, p_claim_id: fresh.claim_id, p_result_json: result() })).data, true)
    assert.equal((await f.run('inspect', { attemptId: id })).max.sequenceNumber, 1)
    assert.equal(f.generations(), 0)
  })
  await t.test('completed legacy orphan and expired result stay recoverable', async () => {
    const f = await fixture(1)
    const claimed = (await rpc('consume_chronosphere_pack_credit', { p_pack_token_hash: f.hash, p_request_hash: 'legacy' })).data
    await rpc('complete_chronosphere_pack_draw', { p_draw_id: claimed.draw_id, p_claim_id: claimed.claim_id, p_result_json: result() })
    const recovered = await f.run()
    assert.equal(recovered.max.sequenceNumber, 1)
    assert.equal(f.generations(), 0)
    await sql(`update chronosphere_credit_packs set captured_at=now()-interval '1 year' where id=${literal(f.packId)}`)
    assert.equal((await f.run('retry', { attemptId: recovered.attempt.id })).max.sequenceNumber, 1)
    assert.equal(await f.balance(), 0)
  })
  await t.test('classic pack consumption and refund RPCs retain their behavior', async () => {
    const f = await fixture(3, 'pack3')
    const claim = (await rpc('consume_chronosphere_pack_credit', { p_pack_token_hash: f.hash, p_request_hash: 'classic' })).data
    assert.equal(await f.balance(), 2)
    const args = { p_draw_id: claim.draw_id, p_claim_id: claim.claim_id, p_failure_code: 'fixture' }
    assert.equal((await rpc('release_chronosphere_pack_credit', args)).data.released, true)
    assert.equal((await rpc('release_chronosphere_pack_credit', args)).data.released, false)
    assert.equal(await f.balance(), 3)
  })
})
