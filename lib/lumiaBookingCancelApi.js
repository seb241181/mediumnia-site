import { LUMIA_ALLOWED_ACTIONS, authorizeLumiaAction } from './lumiaPolicy.js'
import { processLumiaCalendarSyncJob } from './lumiaCalendarSync.js'
import {
  LUMIA_BOOKING_CANCEL_ACTION,
  buildBookingCancelPayload,
  buildBookingCancelPreview,
  isUuid,
  newBookingCancelIdempotencyKey,
  resolveBookingCancelCandidates,
} from './lumiaBookingCancel.js'

const PREVIEW_TTL_MS = 10 * 60 * 1000
// Identifiant serveur de l'agent privé Lumia RDV. Il ne provient jamais du
// navigateur : une conversation d'un autre agent ne peut pas piloter 3B.
export const LUMIA_RDV_AGENT_ID = 'fcd33963-3e5f-4726-abec-b9c5c5ee4fe2'
const LUMIA_BOOKING_CANCEL_EXECUTOR = 'lumia.booking.cancel'

function disabled() {
  return { status: 403, body: { error: 'action_not_allowed' } }
}

async function ownedConversation(db, userId, conversationId) {
  if (!isUuid(conversationId)) return null
  const { data } = await db.from('agent_conversations')
    .select('id, agent_id')
    .eq('id', conversationId).eq('owner_id', userId)
    .eq('agent_id', LUMIA_RDV_AGENT_ID).maybeSingle()
  return data || null
}

async function ownedBookingCancelIntent(db, userId, conversationId, intentId) {
  if (!isUuid(intentId)) return null
  const { data } = await db.from('lumia_action_intents')
    .select('id, owner_id, conversation_id, action_type, target_source, target_id, practitioner_id, idempotency_key')
    .eq('id', intentId).eq('owner_id', userId).eq('conversation_id', conversationId).maybeSingle()
  if (!data
    || data.action_type !== LUMIA_BOOKING_CANCEL_ACTION
    || data.target_source !== 'mediumia_booking'
    || !data.practitioner_id
    || !isUuid(data.target_id)
    || typeof data.idempotency_key !== 'string') return null
  return data
}

async function ownedBooking(db, userId, bookingId, practitionerId = null) {
  if (!isUuid(bookingId)) return null
  let query = db.from('bookings').select(`
    id, practitioner_id, service_id, customer_first_name, customer_last_name,
    starts_at, ends_at, status, booking_source, updated_at, google_event_id,
    service:booking_services(title, modality),
    practitioner:booking_practitioners!inner(id, owner_id)
  `).eq('id', bookingId).eq('booking_practitioners.owner_id', userId)
  if (practitionerId && isUuid(practitionerId)) query = query.eq('practitioner_id', practitionerId)
  const { data } = await query.maybeSingle()
  return data || null
}

async function ownedBookingCandidates(db, userId, { bookingId = null, practitionerId = null, startsAt = null } = {}) {
  let query = db.from('bookings').select(`
    id, practitioner_id, service_id, customer_first_name, customer_last_name,
    starts_at, ends_at, status, booking_source, updated_at, google_event_id,
    service:booking_services(title, modality),
    practitioner:booking_practitioners!inner(id, owner_id)
  `).eq('status', 'confirmed').eq('booking_practitioners.owner_id', userId).limit(3)
  if (bookingId && isUuid(bookingId)) query = query.eq('id', bookingId)
  else if (startsAt && Number.isFinite(Date.parse(startsAt))) query = query.eq('starts_at', new Date(startsAt).toISOString())
  else return []
  if (practitionerId && isUuid(practitionerId)) query = query.eq('practitioner_id', practitionerId)
  const { data } = await query
  return data || []
}

export async function handleLumiaBookingCancelApi({ db, userId, input = {} }) {
  // Dormant by construction. No database RPC, Google call, e-mail or message
  // path is reachable until a later phase intentionally changes the whitelist.
  if (!LUMIA_ALLOWED_ACTIONS.includes(LUMIA_BOOKING_CANCEL_ACTION)) return disabled()

  const op = String(input.op || '')
  const conversation = await ownedConversation(db, userId, input.conversation_id)
  if (!conversation) return { status: 404, body: { error: 'conversation_not_found' } }

  if (op === 'resolve') {
    const candidates = await ownedBookingCandidates(db, userId, {
      bookingId: input.booking_id, practitionerId: input.practitioner_id, startsAt: input.starts_at,
    })
    const resolved = resolveBookingCancelCandidates(candidates, { bookingId: input.booking_id })
    return { status: resolved.status === 'resolved' ? 200 : 404, body: resolved }
  }

  if (op === 'preview') {
    const booking = await ownedBooking(db, userId, input.booking_id, input.practitioner_id)
    if (!booking || booking.status !== 'confirmed' || booking.booking_source !== 'mediumia') return { status: 409, body: { error: 'booking_not_cancellable' } }
    const preview = buildBookingCancelPreview(booking)
    const payload = buildBookingCancelPayload(booking)
    const idempotencyKey = newBookingCancelIdempotencyKey()
    const created = await db.rpc('lumia_create_action_intent', {
      p_owner_id: userId,
      p_agent_id: conversation.agent_id,
      p_conversation_id: conversation.id,
      p_practitioner_id: booking.practitioner_id,
      p_action_type: LUMIA_BOOKING_CANCEL_ACTION,
      p_target_source: 'mediumia_booking',
      p_target_id: booking.id,
      p_expected_version: null,
      p_expected_target_updated_at: booking.updated_at,
      p_target_google_etag: null,
      p_canonical_payload: payload,
      p_preview: preview,
      p_preview_expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      p_idempotency_key: idempotencyKey,
    })
    if (created.error) return { status: 503, body: { error: 'preview_unavailable' } }
    return { status: 201, body: created.data }
  }

  if (op === 'approve') {
    const intent = await ownedBookingCancelIntent(db, userId, conversation.id, input.intent_id)
    if (!intent) return { status: 404, body: { error: 'booking_cancel_intent_not_found' } }
    const result = await db.rpc('lumia_approve_action_intent', {
      p_owner_id: userId, p_conversation_id: conversation.id, p_intent_id: intent.id,
    })
    return result.error ? { status: 409, body: { error: 'approval_refused' } } : { status: 200, body: result.data }
  }

  if (op === 'execute') {
    const intent = await ownedBookingCancelIntent(db, userId, conversation.id, input.intent_id)
    if (!intent) return { status: 404, body: { error: 'booking_cancel_intent_not_found' } }
    const gate = authorizeLumiaAction(LUMIA_BOOKING_CANCEL_ACTION, {
      idempotencyKey: intent.idempotency_key, maxPerRun: 1, validatedBy: userId,
    })
    if (!gate.allowed) return { status: 403, body: { error: gate.reason } }
    const claimed = await db.rpc('lumia_claim_action_execution', {
      p_owner_id: userId,
      p_conversation_id: conversation.id,
      p_intent_id: intent.id,
      p_executor_name: LUMIA_BOOKING_CANCEL_EXECUTOR,
    })
    if (claimed.error || !['executing', 'succeeded'].includes(claimed.data?.status)) return { status: 409, body: claimed.data || { error: 'claim_refused' } }
    const executed = await db.rpc('lumia_execute_mediumia_booking_cancel', {
      p_owner_id: userId, p_conversation_id: conversation.id, p_intent_id: intent.id,
    })
    if (executed.error) return { status: 503, body: { error: 'execution_unavailable' } }

    let body = executed.data
    if (body?.status === 'succeeded' && body?.google_sync && body.google_sync !== 'not_required') {
      const google = await processLumiaCalendarSyncJob({ supabase: db, bookingId: body.booking_id })
      body = { ...body, google_sync: google.status, google_sync_error: google.error || null }
    }
    return { status: 200, body }
  }

  return { status: 400, body: { error: 'invalid_request' } }
}
