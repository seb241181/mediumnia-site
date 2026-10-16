const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildManualCancellationPreview(booking, { entries, payments, balances, refunds, transfers }) {
  const netCents = entries.reduce((sum, entry) => sum
    + (entry.direction === 'refund' ? -1 : 1) * Number(entry.gross_cents), 0)
  const unsettledPayment = [...payments, ...balances].some(payment =>
    !['captured', 'failed', 'expired', 'cancelled'].includes(payment.status))
  const blockers = []
  if (booking.status !== 'confirmed') blockers.push('booking_not_confirmed')
  if (booking.booking_source !== 'mediumia') blockers.push('external_booking_requires_review')
  if (unsettledPayment) blockers.push('payment_state_uncertain')
  if (refunds.some(refund => !['completed', 'failed'].includes(refund.status))) blockers.push('refund_in_progress')
  if (transfers.some(transfer => transfer.status !== 'completed')) blockers.push('transfer_requires_review')
  const hasHistory = entries.length > 0 || payments.length > 0 || balances.length > 0 || refunds.length > 0 || transfers.length > 0
  return {
    booking_id: booking.id,
    starts_at: booking.starts_at,
    status: booking.status,
    execution_enabled: false,
    requires_explicit_confirmation: true,
    blockers,
    requires_financial_review: hasHistory,
    finance: {
      net_recorded_cents: netCents,
      entries: entries.length,
      payments: payments.length + balances.length,
      refunds: refunds.length,
      transfers: transfers.length,
      provider_verification: 'not_performed',
      history_policy: 'preserve_all',
      automatic_refund: false,
    },
    google: {
      required: Boolean(booking.google_event_id),
      status: booking.google_event_id ? 'not_executed' : 'not_required',
      strategy: 'atomic_booking_transition_and_durable_projection_job',
    },
    customer_notification: 'disabled',
  }
}

// Preparation only. No mutation method, capture, refund, email or Google call.
// A future executor must recheck ownership/payment state in the same DB transaction
// as cancellation and its durable Google job, not trust this read-only snapshot.
export async function getManualCancellationPreview({ db, userId, method, practitionerId, bookingId }) {
  if (method !== 'GET') return { status: 405, body: { error: 'manual_cancellation_execution_disabled' } }
  if (!userId) return { status: 401, body: { error: 'unauthorized' } }
  if (!UUID.test(String(practitionerId)) || !UUID.test(String(bookingId))) {
    return { status: 400, body: { error: 'invalid_booking' } }
  }
  const owner = await db.from('booking_practitioners').select('id')
    .eq('id', practitionerId).eq('owner_id', userId).maybeSingle()
  if (owner.error) return { status: 503, body: { error: 'owner_lookup_unavailable' } }
  if (!owner.data) return { status: 403, body: { error: 'forbidden' } }
  const booking = await db.from('bookings')
    .select('id, practitioner_id, starts_at, status, booking_source, google_event_id')
    .eq('id', bookingId).eq('practitioner_id', practitionerId).maybeSingle()
  if (booking.error) return { status: 503, body: { error: 'booking_lookup_unavailable' } }
  if (!booking.data) return { status: 404, body: { error: 'booking_not_found' } }
  const holds = await db.from('rdv_booking_holds').select('id')
    .eq('converted_booking_id', bookingId).eq('practitioner_id', practitionerId)
  if (holds.error) return { status: 503, body: { error: 'payment_lookup_unavailable' } }
  const holdIds = (holds.data || []).map(hold => hold.id)
  const entries = await db.from('rdv_financial_entries').select('id, direction, gross_cents')
    .eq('booking_id', bookingId).eq('practitioner_id', practitionerId)
  const payments = holdIds.length
    ? await db.from('rdv_paypal_payments').select('id, status').in('hold_id', holdIds)
    : { data: [], error: null }
  const balances = await db.from('rdv_balance_payments').select('id, status').eq('booking_id', bookingId)
  const refunds = await db.from('rdv_payment_refunds').select('id, status')
    .eq('booking_id', bookingId).eq('practitioner_id', practitionerId)
  const transfers = await db.from('rdv_deposit_transfers').select('id, status')
    .eq('practitioner_id', practitionerId).or(`source_booking_id.eq.${bookingId},target_booking_id.eq.${bookingId}`)
  const results = { entries, payments, balances, refunds, transfers }
  if (Object.values(results).some(result => result.error || !Array.isArray(result.data))) {
    return { status: 503, body: { error: 'financial_review_unavailable' } }
  }
  if (entries.data.some(entry => !Number.isSafeInteger(entry.gross_cents) || !['income', 'refund'].includes(entry.direction))) {
    return { status: 503, body: { error: 'financial_review_unavailable' } }
  }
  return { status: 200, body: buildManualCancellationPreview(booking.data,
    Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.data]))) }
}
