// Navigation automatique du calendrier public : ne dépasse jamais l'horizon
// et ne saute jamais un mois qui contient un créneau disponible.
export function nextCalendarMonth(viewDate, maxDate, hasAvailability, automatic = true) {
  if (!automatic || hasAvailability) return null
  const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
  return next <= maxDate ? next : null
}
