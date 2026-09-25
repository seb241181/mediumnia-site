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
  compact = false,
}) {
  const visiblePractitioners = practitioners.filter(p => p.publicVisible !== false)
  const bookablePractitioner = visiblePractitioners.find(p => p.rdvSlug)

  // Accueil : version resserrée (photo plus petite, texte court, réservation directe).
  if (compact) {
    return (
      <section className="mx-auto max-w-6xl scroll-mt-28 px-6 py-16" id={id} aria-labelledby={`${id}-title`}>
        <div className="mb-8 max-w-2xl">
          <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Consulter</p>
          <h2 id={`${id}-title`} className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">{visiblePractitioners.length > 1 ? 'Consulter un praticien MediumIA' : 'Une consultation avec un médium'}</h2>
        </div>
        <div className="grid gap-5">
          {visiblePractitioners.map((practitioner) => (
            <article key={practitioner.id} className="grid overflow-hidden rounded-3xl border border-gold/30 bg-white/80 shadow-[0_10px_28px_rgba(26,21,53,.05)] md:grid-cols-[240px_1fr]">
              {practitioner.portrait ? (
                <img src={practitioner.portrait} alt={practitioner.portraitAlt} loading="lazy" decoding="async" className="h-64 w-full object-cover object-top md:h-full" />
              ) : null}
              <div className="flex flex-col p-7 md:p-9">
                <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">{practitioner.eyebrow}</p>
                <h3 className="mt-2 font-georgia text-2xl font-medium text-deep md:text-3xl">{practitioner.name}</h3>
                <p className="mt-1 font-georgia text-sm text-gold">{practitioner.role}</p>
                <p className="mt-4 max-w-2xl font-georgia leading-relaxed text-mist">{practitioner.introduction}</p>
                <div className="mt-6">
                  <button
                    type="button"
                    disabled={!practitioner.rdvSlug || !onOpenRdv}
                    onClick={() => practitioner.rdvSlug && onOpenRdv?.(practitioner.rdvSlug)}
                    className="rounded-lg bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50"
                  >
                    Prendre rendez-vous →
                  </button>
                  <p className="mt-3 font-georgia text-xs text-mist">Disponibilités en temps réel dans l’agenda MediumIA.</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    )
  }

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
