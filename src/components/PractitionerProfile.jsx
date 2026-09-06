import LegalFooter from './LegalFooter'
import { reseauPractitioners } from '../data/reseauPractitioners'

function withPreviewShareToken(src) {
  if (typeof window === 'undefined' || !src?.startsWith('/')) return src
  const token = new URLSearchParams(window.location.search).get('_vercel_share')
  if (!token) return src
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}_vercel_share=${encodeURIComponent(token)}`
}

function Portrait({ practitioner }) {
  if (practitioner.portrait) {
    return (
      <img
        src={withPreviewShareToken(practitioner.portrait)}
        alt={practitioner.portraitAlt}
        className="aspect-[4/5] h-full w-full object-cover object-center"
      />
    )
  }

  return (
    <div className="flex aspect-[4/5] h-full w-full flex-col items-center justify-center bg-gradient-to-br from-deep via-[#241d42] to-[#0d1730] px-8 text-center">
      <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="mb-6 w-28 opacity-80" />
      <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Membre Fondateur MediumIA</p>
      <p className="mt-3 font-georgia text-2xl text-cream">{practitioner.name}</p>
      <p className="mt-3 font-georgia text-xs leading-relaxed text-cream/55">Photo du praticien à venir</p>
    </div>
  )
}

function PracticalCard({ label, value }) {
  if (!value) return null
  return (
    <div className="rounded-2xl border border-gold/20 bg-white/70 px-5 py-4">
      <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">{label}</p>
      <p className="mt-2 font-georgia text-sm leading-relaxed text-deep">{value}</p>
    </div>
  )
}

export default function PractitionerProfile({ practitionerId, onBack, onNavigate }) {
  const practitioner = reseauPractitioners.find((item) => item.id === practitionerId)

  if (!practitioner) {
    return (
      <div className="min-h-screen bg-cream text-deep">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <p className="font-georgia text-xs uppercase tracking-[0.22em] text-gold">Réseau MediumIA</p>
          <h1 className="mt-4 font-georgia text-3xl font-medium">Ce profil n’est pas disponible.</h1>
          <button onClick={onBack} className="mt-8 rounded-xl border border-gold/40 px-6 py-3 font-georgia text-sm font-semibold text-deep">
            ← Retour au réseau
          </button>
        </div>
      </div>
    )
  }

  const practical = practitioner.practical || {}
  const practicalItems = [
    { label: 'Public accompagné', value: practical.audience },
    { label: 'Modalités', value: Array.isArray(practical.modalities) ? practical.modalities.join(' · ') : practical.modalities },
    { label: 'Tarif indicatif', value: practical.startingPrice },
    { label: 'Durée', value: practical.duration },
  ].filter((item) => Boolean(item.value))

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← Tous les praticiens</button>
        </div>
      </header>

      <main>
        <section className="border-b border-gold/15 bg-white/35 px-6 py-14 md:py-20">
          <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[320px_1fr] md:items-center">
            <div className="overflow-hidden rounded-3xl border border-gold/30 bg-deep/5 shadow-sm">
              <Portrait practitioner={practitioner} />
            </div>

            <div>
              <p className="font-georgia text-[10px] uppercase tracking-[0.22em] text-gold">
                {practitioner.founder
                  ? `Membre Fondateur MediumIA — N°${String(practitioner.founderNumber).padStart(3, '0')}`
                  : 'Membre du Réseau MediumIA'}
              </p>
              <h1 className="mt-4 font-georgia text-4xl font-medium leading-tight md:text-6xl">{practitioner.name}</h1>
              <p className="mt-3 font-georgia text-lg text-mist">
                {practitioner.role}{practitioner.city ? ` · ${practitioner.city}` : ''}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {(practical.audience || practitioner.audience) && (
                  <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 font-georgia text-xs text-deep">
                    {practical.audience || practitioner.audience}
                  </span>
                )}
                <span className="rounded-full border border-deep/10 bg-deep/5 px-3 py-1.5 font-georgia text-xs text-mist">{practitioner.membership}</span>
              </div>
              <p className="mt-7 max-w-2xl font-georgia text-base leading-relaxed text-deep/80 md:text-lg">{practitioner.introduction}</p>

              {practicalItems.length > 0 && (
                <div className="mt-8">
                  <p className="mb-3 font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Repères pratiques</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {practicalItems.map((item) => (
                      <PracticalCard key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                  {practical.sourceUrl && practical.sourceLabel && (
                    <a
                      href={practical.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex font-georgia text-xs font-semibold text-mist underline decoration-gold/40 underline-offset-4 transition-colors hover:text-deep"
                    >
                      {practical.sourceLabel} ↗
                    </a>
                  )}
                </div>
              )}

              <a
                href={practitioner.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex rounded-xl bg-deep px-7 py-4 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90"
              >
                {practitioner.externalLabel || 'Voir ses disponibilités'} →
              </a>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-6 py-14 md:grid-cols-2 md:py-20">
          <article className="rounded-3xl border border-gold/20 bg-white/65 p-7 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Son approche</p>
            <h2 className="mt-3 font-georgia text-2xl font-medium">{practitioner.approachTitle || 'Un accompagnement à son rythme'}</h2>
            <p className="mt-4 font-georgia text-sm leading-relaxed text-mist">{practitioner.approach}</p>
          </article>
          <article className="rounded-3xl border border-gold/20 bg-white/65 p-7 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Sa sensibilité</p>
            <h2 className="mt-3 font-georgia text-2xl font-medium">{practitioner.spiritualityTitle || 'Accueillir la personne dans sa globalité'}</h2>
            <p className="mt-4 font-georgia text-sm leading-relaxed text-mist">{practitioner.spirituality}</p>
          </article>
        </section>

        {Array.isArray(practitioner.services) && practitioner.services.length > 0 && (
          <section className="mx-auto max-w-5xl px-6 pb-14 md:pb-20">
            <div className="rounded-3xl border border-gold/25 bg-white/70 p-7 md:p-9">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Prestations publiées</p>
                  <h2 className="mt-2 font-georgia text-2xl font-medium md:text-3xl">Quelques repères avant de réserver</h2>
                </div>
                <p className="max-w-md font-georgia text-xs leading-relaxed text-mist">
                  Les tarifs ci-dessous proviennent du site public du praticien et peuvent évoluer. Vérifiez-les au moment de réserver.
                </p>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {practitioner.services.map((service) => (
                  <div key={service.name} className="flex items-start justify-between gap-5 rounded-2xl border border-gold/20 bg-cream/55 px-5 py-4">
                    <div>
                      <p className="font-georgia text-sm font-semibold text-deep">{service.name}</p>
                      {service.duration && <p className="mt-1 font-georgia text-xs text-mist">{service.duration}</p>}
                    </div>
                    {service.price && <p className="shrink-0 font-georgia text-sm font-semibold text-gold">{service.price}</p>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto max-w-5xl px-6 pb-16 md:pb-20">
          <div className="rounded-3xl border border-gold/25 bg-deep px-7 py-9 text-cream md:px-10 md:py-10">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Motifs d’accompagnement</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {practitioner.specialties.map((specialty) => (
                <span key={specialty} className="rounded-full border border-gold/25 bg-white/5 px-3 py-2 font-georgia text-xs text-cream/75">
                  {specialty}
                </span>
              ))}
            </div>
            <div className="mt-8 border-t border-gold/20 pt-7">
              <p className="font-georgia text-xs leading-relaxed text-cream/55">
                MediumIA fournit un espace de présentation et de visibilité professionnelle. La présence dans le Réseau ne constitue ni une certification ni une garantie de résultat.
              </p>
            </div>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
