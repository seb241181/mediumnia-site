// Dashboard working list only. Never changes or cancels a booking.
export function pendingVisioBookings(bookings = [], balances = {}) {
  return bookings.filter(booking => {
    const payment = balances[booking.id]
    return booking.modality === 'video'
      && booking.status === 'confirmed'
      && payment?.total_cents > 0
      && payment?.remaining_cents > 0
  })
}
