export const REQUEST_STATUSES = [
  ['pending', 'En attente'], ['contacted', 'Contacté'], ['scheduled', 'Planifié'],
]

export function isFullySettled(booking) {
  return booking.status === 'confirmed'
    && Number.isSafeInteger(booking.total_cents) && booking.total_cents > 0
    && booking.paid_cents === booking.total_cents && booking.remaining_cents === 0
}

export function partitionBookings(bookings, balances = null) {
  const result = { main: [], settled: [] }
  for (const booking of bookings) {
    const summary = balances ? { ...booking, ...balances[booking.id] } : booking
    result[isFullySettled(summary) ? 'settled' : 'main'].push(booking)
  }
  return result
}

export function filterRequests(requests, status) {
  return status === 'all' ? requests : requests.filter(request => request.status === status)
}
