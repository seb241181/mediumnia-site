/**
 * Owner-only consultation confirmation. Never moves, cancels or charges a booking.
 * Writes are atomic/audited by the service-role-only database RPC.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OUTCOMES = new Set(['completed', 'to_reschedule', 'pending'])

export async function setAgendaSessionOutcome({ supabase, userId, input = {} }) {
  const bookingId = String(input.booking_id || '')
  const outcome = String(input.outcome || '')
  const expectedUpdatedAt = String(input.expected_updated_at || '')
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(String(userId || ''))
      || !OUTCOMES.has(outcome) || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { status: 400, body: { error: 'invalid_request' } }
  }
  const { data, error } = await supabase.rpc('rdv_set_session_outcome', {
    p_owner_id: userId,
    p_booking_id: bookingId,
    p_outcome: outcome,
    p_expected_updated_at: expectedUpdatedAt,
  })
  if (error) return { status: 503, body: { error: error.code === 'PGRST202' ? 'migration_pending' : 'session_outcome_unavailable' } }
  if (!data?.ok) {
    const reason = data?.error || 'session_outcome_unavailable'
    return {
      status: reason === 'booking_not_found' ? 404
        : reason === 'invalid_request' ? 400 : 409,
      body: { error: reason },
    }
  }
  return {
    status: 200,
    body: { ok: true, outcome: data.outcome, already: Boolean(data.already), client_email_sent: false, payment_changed: false },
  }
}
