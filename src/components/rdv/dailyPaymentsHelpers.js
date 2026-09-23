// On-site payments are dated at the end of the appointment when it is over,
// otherwise now — the real day the money was received.
export function defaultPaymentDate(booking, now = new Date()) {
  const end = new Date(booking.ends_at || booking.starts_at)
  return end < now ? end : now
}

// Accepts "50", "50,5", "1 250,00" or "50.5"; returns cents or null.
export function parseAmount(value) {
  const cents = Math.round(Number(String(value).replace(/\s/g, '').replace(',', '.')) * 100)
  return Number.isInteger(cents) && cents > 0 ? cents : null
}
