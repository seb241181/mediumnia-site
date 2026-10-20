const RESCHEDULE_ERROR_MESSAGES = Object.freeze({
  outside_availability: 'Ce rendez-vous est en dehors des horaires de disponibilité. Choisissez un créneau proposé.',
  exception_closed: 'Cette journée est fermée aux rendez-vous. Choisissez une autre date.',
  slot_unavailable: 'Ce créneau n’est plus disponible. Choisissez-en un autre.',
  booking_busy: 'Ce rendez-vous est déjà en cours de modification. Actualisez l’agenda puis réessayez.',
  hold_busy: 'Ce créneau est temporairement réservé pendant une autre opération. Réessayez dans un instant.',
  offer_busy: 'Ce créneau fait l’objet d’une proposition en cours. Choisissez-en un autre.',
  booking_changed: 'Ce rendez-vous a été modifié depuis son affichage. Actualisez l’agenda avant de réessayer.',
  max_per_day: 'La capacité maximale de rendez-vous pour cette journée est atteinte.',
  daily_limit_reached: 'La capacité maximale de rendez-vous pour cette journée est atteinte.',
  min_advance: 'Ce créneau est trop proche. Choisissez une date plus éloignée.',
  outside_horizon: 'Cette date est au-delà de la période réservable.',
  outside_booking_horizon: 'Cette date est en dehors de la période autorisée pour les rendez-vous.',
  google_calendar_unavailable: 'Google Agenda est indisponible. Le déplacement n’a pas été effectué.',
  payment_busy: 'Un paiement est en cours de traitement pour ce rendez-vous. Aucun déplacement n’a été effectué; réessayez plus tard.',
  google_sync_pending: 'La synchronisation Google du déplacement précédent est encore en cours. Actualisez l’agenda avant de réessayer.',
  availability_unavailable: 'Les disponibilités n’ont pas pu être vérifiées. Le déplacement n’a pas été effectué; réessayez plus tard.',
  reschedule_unavailable: 'Le déplacement n’a pas pu être enregistré. Actualisez l’agenda avant de réessayer.',
})

export function rescheduleErrorMessage(code) {
  return typeof code === 'string' && Object.hasOwn(RESCHEDULE_ERROR_MESSAGES, code)
    ? RESCHEDULE_ERROR_MESSAGES[code]
    : 'Le déplacement n’a pas été effectué. Vérifiez les informations et réessayez.'
}
