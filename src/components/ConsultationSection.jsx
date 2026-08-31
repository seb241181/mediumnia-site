import PractitionerCard from './PractitionerCard'
import { consultationPractitioners } from '../data/consultationServices'
import '../styles/consultation.css'

/**
 * Module Consulter autonome.
 */
export default function ConsultationSection({
  practitioners = consultationPractitioners,
  onBookingRequest,
  bookingEnabled = false,
  onOpenRdv,
  id = 'consulter',
}) {
  const visiblePractitioners = practitioners.filter(p => p.publicVisible !== false)
  const bookablePractitioner = visiblePractitioners.find(p => p.rdvSlug)

  return (
    <section className="consultation-module" id={id} aria-labelledby={`${id}-title`}>
      <header className="consultation-module__header">
        <p className="consultation-eyebrow">Consulter chez MediumIA</p>
        <h2 id={`${id}-title`}>Rencontrer, ressentir,<br /><em>être accompagné.</em></h2>
        <p>MediumIA est aussi né de pratiques humaines réelles — une écoute attentive et un accompagnement ancré dans l’expérience.</p>
      </header>

      <div className={`consultation-module__practitioners${visiblePractitioners.length === 1 ? ' consultation-module__practitioners--single' : ''}`}>
        {visiblePractitioners.map((practitioner) => (
          <PractitionerCard
            key={practitioner.id}
            practitioner={practitioner}
            bookingEnabled={bookingEnabled}
            onBookingRequest={onBookingRequest}
            onOpenRdv={onOpenRdv}
          />
        ))}
      </div>

      <aside className="consultation-module__booking-note" aria-label="Prise de rendez-vous MediumIA">
        <span aria-hidden="true">✦</span>
        <div>
          <p className="consultation-eyebrow">MediumIA Rendez-vous</p>
          <h3>La rencontre commence toujours par une présence.</h3>
          <p>Consultez les disponibilités en temps réel et réservez directement votre créneau dans l’agenda MediumIA.</p>
        </div>
        <button
          type="button"
          disabled={!bookablePractitioner || !onOpenRdv}
          onClick={() => bookablePractitioner && onOpenRdv?.(bookablePractitioner.rdvSlug)}
        >
          Prendre rendez-vous →
        </button>
      </aside>
    </section>
  )
}
