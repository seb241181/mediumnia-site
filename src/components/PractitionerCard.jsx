import { useState } from 'react'
import ServiceCard from './ServiceCard'

function PortraitPlaceholder({ practitioner }) {
  if (practitioner.portrait) {
    return <img src={practitioner.portrait} alt={practitioner.portraitAlt} />
  }

  return (
    <div className="consultation-practitioner__placeholder" role="img" aria-label={practitioner.portraitAlt}>
      <span aria-hidden="true">{practitioner.firstName.charAt(0)}</span>
      <small>Portrait à venir</small>
    </div>
  )
}

export default function PractitionerCard({
  practitioner,
  bookingEnabled,
  onBookingRequest,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const servicesId = `consultation-services-${practitioner.id}`

  return (
    <article className={`consultation-practitioner consultation-practitioner--${practitioner.accent}`}>
      <div className="consultation-practitioner__portrait">
        <PortraitPlaceholder practitioner={practitioner} />
        <p>{practitioner.intention}</p>
      </div>
      <div className="consultation-practitioner__content">
        <p className="consultation-eyebrow">{practitioner.eyebrow}</p>
        <h3>{practitioner.name}</h3>
        <p className="consultation-practitioner__role">{practitioner.role}</p>
        <p className="consultation-practitioner__intro">{practitioner.introduction}</p>
        <p className="consultation-practitioner__status">{practitioner.statusLabel}</p>
        <button
          type="button"
          className="consultation-practitioner__discover"
          aria-expanded={detailsOpen}
          aria-controls={servicesId}
          onClick={() => setDetailsOpen((value) => !value)}
        >
          {practitioner.detailsLabel}
          <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
        </button>
      </div>
      <div className="consultation-practitioner__services" id={servicesId} hidden={!detailsOpen}>
        {practitioner.services.map((service) => (
          <ServiceCard
            key={service.id}
            practitioner={practitioner}
            service={service}
            bookingEnabled={bookingEnabled}
            onBookingRequest={onBookingRequest}
          />
        ))}
      </div>
    </article>
  )
}
