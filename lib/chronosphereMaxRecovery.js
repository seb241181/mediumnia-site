import { createHash } from 'node:crypto'
import { isPackExpired, packExpiresAt } from './chronospherePackValidity.js'
import { buildChronosphereMaxSnapshot } from './chronosphereMaxSnapshot.js'
import { compareChronosphereSnapshots, summarizeChronosphereLine } from './chronosphereMaxCompare.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function rpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message?.includes('max_legacy_request_required') ? 'max_legacy_request_required' : 'max_recovery_unavailable')
  return data
}

function publicAttempt(state) {
  return { id: state.attempt.id, nonce: state.attempt.nonce, status: state.attempt.published_at ? 'available' : 'recoverable', canEdit: !state.attempt.published_at && (!state.draw || state.draw.status === 'failed') }
}

export async function recoverMaxReading({ supabase, userId, packToken, request, action, generate, deliver }) {
  let attemptId = request.attemptId || null
  if (attemptId && !UUID.test(attemptId)) throw new Error('invalid_max_attempt')
  if (request.previousAttemptId && !UUID.test(request.previousAttemptId)) throw new Error('invalid_max_attempt')
  if (action === 'start') {
    attemptId = await rpc(supabase, 'begin_chronosphere_max_attempt', {
      p_user_id: userId,
      p_pack_token_hash: createHash('sha256').update(packToken).digest('hex'),
      p_nonce: request.maxReadNonce,
      p_previous_attempt_id: request.previousAttemptId || null,
      p_replace_request: request.replaceRequest === true,
      p_legacy_request_hash: request.legacyRequestHash || createHash('sha256').update(JSON.stringify({
        numbers: request.numbers, theme: request.theme, profile: request.profile,
        deliveryEmail: request.deliveryEmail, maxReadNonce: request.maxReadNonce,
        requestedTimelineId: request.maxTimelineId || '', requestedTimelineTitle: request.maxTimelineTitle || '',
      })).digest('hex'),
      p_request: {
        numbers: request.numbers, theme: request.theme, profile: request.profile,
        deliveryEmail: request.deliveryEmail, maxTimelineId: request.maxTimelineId || '',
        maxTimelineTitle: request.maxTimelineTitle || request.theme,
      },
    })
  }
  let state = await rpc(supabase, 'read_chronosphere_max_attempt', { p_user_id: userId, p_attempt_id: attemptId })
  if (!state && !attemptId) {
    // Account resume adopts the pack by (user_id, pack) under a row lock, never by
    // the pack token hash: status rotates that secret concurrently on login.
    const adopted = await rpc(supabase, 'adopt_chronosphere_max_attempt', { p_user_id: userId })
    if (adopted) state = await rpc(supabase, 'read_chronosphere_max_attempt', { p_user_id: userId, p_attempt_id: adopted })
  }
  if (!state) {
    if (attemptId) throw new Error('max_attempt_not_found')
    return { attempt: null }
  }
  attemptId = state.attempt.id
  const meta = () => ({ attempt: publicAttempt(state), creditsRemaining: state.pack.creditsRemaining, creditsTotal: state.pack.creditsTotal })
  if (action === 'inspect' && state.draw?.status !== 'completed') return meta()

  let result = state.draw?.status === 'completed' ? state.draw.result_json : null
  let claim = null
  let finalized = Boolean(result)
  let failure = null
  try {
    if (!result) {
      claim = await rpc(supabase, 'claim_chronosphere_max_attempt', {
        p_user_id: userId, p_attempt_id: attemptId, p_allow_reserve: !isPackExpired(state.pack),
      })
      if (!claim?.allowed) return { ...meta(), error: `max_${claim?.reason || 'unavailable'}` }
      result = claim.cached ? claim.result_json : await generate({
        ...state.attempt.request_json,
        credits: { creditsRemaining: claim.credits_remaining, creditsTotal: claim.credits_total },
      })
      if (!claim.cached) {
        const completed = await rpc(supabase, 'complete_chronosphere_pack_draw', {
          p_draw_id: claim.draw_id, p_result_json: result, p_claim_id: claim.claim_id,
        })
        if (completed !== true) throw new Error('max_completion_retry')
      }
      finalized = true
      state = await rpc(supabase, 'read_chronosphere_max_attempt', { p_user_id: userId, p_attempt_id: attemptId })
    }

    const snapshot = buildChronosphereMaxSnapshot(result, {
      sourceDrawTable: 'chronosphere_pack_draws', sourceDrawId: state.draw.id, readAt: result.createdAt,
    })
    const sequence = [1, 2, 3].find((n) => !state.entries.some((entry) => entry.sequence_number === n))
    const previous = state.entries.filter((entry) => entry.sequence_number < sequence).at(-1)
    const comparison = previous ? compareChronosphereSnapshots(previous.snapshot_json, snapshot, {
      previousSequence: previous.sequence_number, currentSequence: sequence,
    }) : null
    const memory = await rpc(supabase, 'publish_chronosphere_max_attempt', {
      p_user_id: userId, p_attempt_id: attemptId, p_snapshot: snapshot,
      p_comparison: comparison, p_previous_entry_id: previous?.id || null,
    })
    state = await rpc(supabase, 'read_chronosphere_max_attempt', { p_user_id: userId, p_attempt_id: attemptId })
    const entries = state.entries.map((entry) => ({
      sequenceNumber: entry.sequence_number, timelineTitle: memory.timelineTitle, snapshot: entry.snapshot_json,
    }))
    // Historical orphan results do not contain a recoverable delivery address.
    const delivery = state.attempt.request_json.deliveryEmail
      ? await deliver({ drawId: state.draw.id, result, deliveryEmail: state.attempt.request_json.deliveryEmail,
        pack: { product: 'max3', creditsRemaining: state.pack.creditsRemaining, expiresAt: packExpiresAt(state.pack) } })
      : { email: 'unavailable' }
    return {
      ...result, ...meta(),
      max: { ...memory, attemptId, comparison: state.entries.find((entry) => entry.source_draw_id === state.draw.id)?.comparison_json || null, finalSynthesis: entries.length >= 3 ? summarizeChronosphereLine(entries) : null },
      delivery,
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    // Completion and release both verify the same claim; an ambiguous network
    // response cannot refund a completed draw or release another worker's claim.
    // A PostgREST builder is a thenable without catch/finally: await it inside
    // try/catch so the refund is really sent and never replaces the original error.
    if (claim?.allowed && !claim.cached && !finalized) {
      try {
        await supabase.rpc('release_chronosphere_pack_credit', {
          p_draw_id: claim.draw_id, p_failure_code: 'timeline_engine_failed', p_claim_id: claim.claim_id,
        })
      } catch { /* The draw stays claimed until its processing TTL; retry recovers it. */ }
    }
    if (failure) {
      try {
        const latest = await rpc(supabase, 'read_chronosphere_max_attempt', { p_user_id: userId, p_attempt_id: attemptId })
        if (latest) failure.attempt = publicAttempt(latest)
      } catch { /* Keep the durable handle even when status is temporarily unavailable. */ }
    }
  }
}
