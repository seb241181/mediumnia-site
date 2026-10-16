const STATUSES = ['pending', 'contacted', 'scheduled']

// Called only with practitioner IDs already selected by authenticated owner_id.
// Exact HEAD counts are independent of the capped list returned by action=me.
export async function getRequestCounts(db, practitionerId) {
  const counts = {}
  for (const status of STATUSES) {
    const result = await db.from('booking_requests').select('id', { head: true, count: 'exact' })
      .eq('practitioner_id', practitionerId).eq('status', status)
    counts[status] = result.error || !Number.isSafeInteger(result.count) ? null : result.count
  }
  return counts
}
