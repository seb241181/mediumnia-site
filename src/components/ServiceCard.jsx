export default function ServiceCard({
  practitioner,
  service,
  bookingEnabled = false,
  onBookingRequest,
}) {
  const requestBooking = () => {
    if (bookingEnabled) onBookingRequest?.(practitioner, service)
  }

  return (
    <article className="consultation-service">
      <div className="consultation-service__heading">
        <span aria-hidden="true">◇</span>
        {service.provisional && <small>Intitulé provisoire</small>}
      </div>
      <h4>{service.title}</h4>
      <p>{service.description}</p>
      <button
        type="button"
        disabled={!bookingEnabled}
        aria-disabled={!bookingEnabled}
        onClick={requestBooking}
        title={!bookingEnabled ? 'La prise de rendez-vous sera disponible prochainement' : undefined}
      >
        Prendre rendez-vous
        {!bookingEnabled && <span> · bientôt</span>}
      </button>
    </article>
  )
}
