// The caisse suggests finished-time sessions first, but never auto-selects a
// booking for a financial entry. Keep the future appointments available too.
export function groupPaymentBookings(bookings, now = new Date()) {
  const time = now.getTime()
  const unique = new Map()
  for (const booking of Array.isArray(bookings) ? bookings : []) {
    const at = Date.parse(booking?.starts_at || '')
    if (booking?.id && Number.isFinite(at) && !unique.has(booking.id)) {
      unique.set(booking.id, { ...booking, time: at })
    }
  }
  const sorted = [...unique.values()]
  return {
    recent: sorted.filter(b => b.time < time).sort((a, b) => b.time - a.time),
    upcoming: sorted.filter(b => b.time >= time).sort((a, b) => a.time - b.time),
  }
}
