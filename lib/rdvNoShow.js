/**
 * Mark a completed MediumIA booking as "no show" without changing the
 * original captured payment or writing a second income entry.
 * Ownership and settlement checks are repeated atomically in PostgreSQL.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function markAgendaNoShow({ supabase, userId, input = {} }) {
  const bookingId = String(input.booking_id || '')
  const practitionerId = String(input.practitioner_id || '')
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(practitionerId) || !UUID_RE.test(String(userId || ''))) {
    return { status: 400, body: { error: 'invalid_request' } }
  }
  const { data, error } = await supabase.rpc('mark_rdv_booking_no_show', {
    p_booking_id: bookingId,
    p_practitioner_id: practitionerId,
    p_actor: userId,
  })
  if (error) return {
    status: 503,
    body: { error: error.code === 'PGRST202' ? 'migration_pending' : 'no_show_unavailable' },
  }
  if (!data?.ok) {
    const reason = data?.error || 'no_show_unavailable'
    const status = reason === 'forbidden' ? 403 : reason === 'booking_not_found' ? 404 : 409
    return { status, body: { error: reason } }
  }
  return { status: 200, body: {
    ok: true, status: 'no_show', retained_cents: Number(data.retained_cents || 0),
    already: !!data.already, accounting_entry_created: false, client_email_sent: false,
  } }
}
