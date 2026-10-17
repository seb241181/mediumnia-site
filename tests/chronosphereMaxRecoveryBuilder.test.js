import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { recoverMaxReading } from '../lib/chronosphereMaxRecovery.js'

// Le builder PostgREST (postgrest-js) est un thenable : il expose then, mais
// ni catch ni finally. Une vraie Promise ne suffit pas à reproduire le bug.
function builder(value, { reject = false } = {}) {
  return { then: (onFulfilled, onRejected) => (reject ? Promise.reject(value) : Promise.resolve(value)).then(onFulfilled, onRejected) }
}

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const pack = { creditsRemaining: 3, creditsTotal: 3, captured_at: new Date().toISOString() }
const attempt = { id: ATTEMPT, nonce: 'nonce-fixture-1', request_json: { theme: 'projet' }, published_at: null }

function fakeSupabase(script) {
  const calls = []
  return {
    calls,
    // Aucune lecture de table : la reprise ne passe que par les RPC serveur.
    rpc(name, args) {
      calls.push({ name, args })
      const step = script[name]
      const value = typeof step === 'function' ? step(args, calls) : step
      if (value instanceof Error) return builder(value, { reject: true })
      return builder(value === undefined ? { data: null, error: null } : value)
    },
  }
}

const claimed = { data: { allowed: true, cached: false, draw_id: 'draw-1', claim_id: 'claim-1', credits_remaining: 2, credits_total: 3 }, error: null }
const failedState = { data: { attempt, pack, draw: { id: 'draw-1', status: 'failed' }, entries: [] }, error: null }
const freshState = { data: { attempt, pack, draw: null, entries: [] }, error: null }

test('builder sans catch : un échec de génération libère le crédit et garde l’erreur d’origine', async () => {
  let reads = 0
  const supabase = fakeSupabase({
    read_chronosphere_max_attempt: () => (reads++ === 0 ? freshState : failedState),
    claim_chronosphere_max_attempt: claimed,
    release_chronosphere_pack_credit: { data: { released: true }, error: null },
  })
  const failure = new Error('injected_generation_failure')
  await assert.rejects(recoverMaxReading({
    supabase, userId: USER, packToken: '', action: 'retry', request: { attemptId: ATTEMPT },
    generate: async () => { throw failure }, deliver: async () => ({ email: 'fixture' }),
  }), (error) => {
    assert.equal(error, failure, 'l’erreur d’origine est celle qui remonte')
    assert.equal(error.attempt?.id, ATTEMPT, 'le handle de tentative reste récupérable')
    assert.equal(error.attempt?.canEdit, true)
    return true
  })
  const releases = supabase.calls.filter((c) => c.name === 'release_chronosphere_pack_credit')
  assert.equal(releases.length, 1, 'un seul remboursement')
  assert.deepEqual(releases[0].args, { p_draw_id: 'draw-1', p_failure_code: 'timeline_engine_failed', p_claim_id: 'claim-1' })
})

test('builder sans catch : un remboursement en échec ne remplace jamais l’erreur d’origine', async () => {
  for (const release of [new Error('network_down'), { data: null, error: { message: 'release failed' } }]) {
    let reads = 0
    const supabase = fakeSupabase({
      read_chronosphere_max_attempt: () => (reads++ === 0 ? freshState : failedState),
      claim_chronosphere_max_attempt: claimed,
      release_chronosphere_pack_credit: release,
    })
    const failure = new Error('injected_generation_failure')
    await assert.rejects(recoverMaxReading({
      supabase, userId: USER, packToken: '', action: 'retry', request: { attemptId: ATTEMPT },
      generate: async () => { throw failure }, deliver: async () => ({}),
    }), (error) => error === failure && error.attempt?.id === ATTEMPT)
  }
})

test('aucun remboursement d’un tirage terminé (réponse de complétion perdue)', async () => {
  let reads = 0
  const supabase = fakeSupabase({
    read_chronosphere_max_attempt: () => (reads++ === 0 ? freshState : failedState),
    claim_chronosphere_max_attempt: claimed,
    complete_chronosphere_pack_draw: { data: null, error: { message: 'lost reply' } },
    release_chronosphere_pack_credit: { data: { released: false }, error: null },
  })
  await assert.rejects(recoverMaxReading({
    supabase, userId: USER, packToken: '', action: 'retry', request: { attemptId: ATTEMPT },
    generate: async () => ({ createdAt: new Date().toISOString(), theme: 'projet' }), deliver: async () => ({}),
  }), /max_recovery_unavailable/)
  // Le remboursement est tenté, mais le claim_id protège le tirage côté SQL
  // (release refusé sur un tirage terminé — couvert par le test PostgreSQL).
  const release = supabase.calls.filter((c) => c.name === 'release_chronosphere_pack_credit')
  assert.equal(release.length, 1)
  assert.equal(release[0].args.p_claim_id, 'claim-1')
})

test('complétion confirmée puis publication en échec : aucun remboursement', async () => {
  let reads = 0
  const completedState = { data: { attempt, pack, draw: { id: 'draw-1', status: 'completed', result_json: {} }, entries: [] }, error: null }
  const supabase = fakeSupabase({
    read_chronosphere_max_attempt: () => (reads++ === 0 ? freshState : completedState),
    claim_chronosphere_max_attempt: claimed,
    complete_chronosphere_pack_draw: { data: true, error: null },
    publish_chronosphere_max_attempt: { data: null, error: { message: 'publish failed' } },
  })
  await assert.rejects(recoverMaxReading({
    supabase, userId: USER, packToken: '', action: 'retry', request: { attemptId: ATTEMPT },
    generate: async () => ({ createdAt: new Date().toISOString(), theme: 'projet', cards: [], reading: {} }), deliver: async () => ({}),
  }))
  assert.equal(supabase.calls.filter((c) => c.name === 'release_chronosphere_pack_credit').length, 0)
})

test('résultat en cache (claim.cached) : ni génération ni remboursement', async () => {
  let reads = 0
  const supabase = fakeSupabase({
    read_chronosphere_max_attempt: () => (reads++ === 0 ? freshState : failedState),
    claim_chronosphere_max_attempt: { data: { ...claimed.data, cached: true, result_json: null }, error: null },
    publish_chronosphere_max_attempt: { data: null, error: { message: 'stop here' } },
  })
  let generated = 0
  await assert.rejects(recoverMaxReading({
    supabase, userId: USER, packToken: '', action: 'retry', request: { attemptId: ATTEMPT },
    generate: async () => { generated++ }, deliver: async () => ({}),
  }))
  assert.equal(generated, 0)
  assert.equal(supabase.calls.filter((c) => c.name === 'release_chronosphere_pack_credit').length, 0)
})

test('reprise par compte : adoption par user_id seul, jamais par le jeton du pack', async () => {
  const supabase = fakeSupabase({
    read_chronosphere_max_attempt: (args) => (args.p_attempt_id ? freshState : { data: null, error: null }),
    adopt_chronosphere_max_attempt: { data: ATTEMPT, error: null },
  })
  const out = await recoverMaxReading({
    supabase, userId: USER, packToken: 'client-supplied-token-must-be-ignored', action: 'inspect', request: {},
    generate: async () => { throw new Error('no generation on inspect') }, deliver: async () => ({}),
  })
  assert.equal(out.attempt.id, ATTEMPT)
  assert.deepEqual(supabase.calls.map((c) => c.name), ['read_chronosphere_max_attempt', 'adopt_chronosphere_max_attempt', 'read_chronosphere_max_attempt'])
  assert.deepEqual(supabase.calls[1].args, { p_user_id: USER })
  assert.ok(!JSON.stringify(supabase.calls).includes('pack_token_hash'), 'aucun hash de jeton dans la reprise par compte')
  // Sans pack MAX : réponse vide, pas d'erreur.
  const empty = fakeSupabase({ read_chronosphere_max_attempt: { data: null, error: null }, adopt_chronosphere_max_attempt: { data: null, error: null } })
  assert.deepEqual(await recoverMaxReading({ supabase: empty, userId: USER, packToken: '', action: 'inspect', request: {}, generate: async () => {}, deliver: async () => ({}) }), { attempt: null })
})

test('source : plus aucun .catch / .finally chaîné sur un appel supabase.rpc', async () => {
  const src = await readFile(new URL('../lib/chronosphereMaxRecovery.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /rpc\([\s\S]*?\}\)\s*\.(catch|finally)\(/)
  assert.doesNotMatch(src, /from\('chronosphere_credit_packs'\)/)
})
