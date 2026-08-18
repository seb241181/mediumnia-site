import PractitionerCard from './PractitionerCard'
import { consultationPractitioners } from '../data/consultationServices'
import '../styles/consultation.css'

/**
 * Module Consulter autonome.
 *
 * La réservation reste désactivée par défaut. Une intégration future pourra
 * fournir onBookingRequest(practitioner, service) et bookingEnabled=true.
 */
export default function ConsultationSection({
  practitioners = consultationPractitioners,
  onBookingRequest,
  bookingEnabled = false,
  onOpenRdv,
  id = 'consulter',
}) {
  return (
    <section className="consultation-module" id={id} aria-labelledby={`${id}-title`}>
      <header className="consultation-module__header">
        <p className="consultation-eyebrow">Consulter chez MediumIA</p>
        <h2 id={`${id}-title`}>Rencontrer, ressentir,<br /><em>être accompagné.</em></h2>
        <p>MediumIA est aussi né de pratiques humaines réelles. Deux univers complémentaires, deux manières d’écouter et d’accompagner ce qui demande de l’attention.</p>
      </header>

      <div className="consultation-module__practitioners">
        {practitioners.map((practitioner) => (
          <PractitionerCard
            key={practitioner.id}
            practitioner={practitioner}
            bookingEnabled={bookingEnabled}
            onBookingRequest={onBookingRequest}
            onOpenRdv={onOpenRdv}
          />
        ))}
      </div>

      <aside className="consultation-module__booking-note" aria-label="Information sur la prise de rendez-vous">
        <span aria-hidden="true">✦</span>
        <div>
          <p className="consultation-eyebrow">MediumIA Rendez-vous</p>
          <h3>La rencontre commence toujours par une présence.</h3>
          <p>La prise de rendez-vous en ligne sera proposée ultérieurement. Aucun créneau, paiement ou réservation n’est actif dans cette maquette.</p>
        </div>
        <button type="button" disabled>Prendre rendez-vous · bientôt</button>
      </aside>
    </section>
  )
}
