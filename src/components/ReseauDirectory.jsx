import { useMemo, useState } from 'react'
import LegalFooter from './LegalFooter'
import { reseauPractitioners } from '../data/reseauPractitioners'

const filters = ['Tous', 'Médiumnité', 'Voyance', 'Cartomancie', 'Magnétisme', 'Reiki', 'Deuil', 'Transitions de vie', 'Burn-out', 'Accompagnement intérieur']

function withPreviewShareToken(src) {
  if (typeof window === 'undefined' || !src?.startsWith('/')) return src
  const token = new URLSearchParams(window.location.search).get('_vercel_share')
  if (!token) return src
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}_vercel_share=${encodeURIComponent(token)}`
}

function PractitionerPortrait({ practitioner }) {
  if (practitioner.portrait) {
    return (
      <img
        src={withPreviewShareToken(practitioner.portrait)}
        alt={practitioner.portraitAlt}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-deep via-[#241d42] to-[#0d1730] px-6 text-center">
      <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="mb-5 w-24 opacity-80" />
      <p className="font-georgia text-xl text-cream">{practitioner.name}</p>
      <p className="mt-2 font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">Photo à venir</p>
    </div>
  )
}

export default function ReseauDirectory({ onBack, onNavigate }) {
  const [activeFilter, setActiveFilter] = useState('Tous')

  const practitioners = useMemo(() => {
    if (activeFilter === 'Tous') return reseauPractitioners
    return reseauPractitioners.filter((practitioner) => practitioner.specialties.includes(activeFilter))
  }, [activeFilter])

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="font-georgia text-deep tracking-[0.18em] text-sm font-semibold">
            ✦ MEDIUMIA
          </button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep transition-colors">
            ← Retour
          </button>
        </div>
      </header>

      <main>
        <section className="px-6 pt-16 pb-12 max-w-4xl mx-auto text-center">
          <img
            src="/images/brand/MEDIUMIA_symbol_header.png"
            alt=""
            aria-hidden="true"
            className="h-10 w-auto mx-auto mb-6 opacity-50"
          />
          <p className="font-georgia text-gold tracking-[0.28em] text-[11px] uppercase mb-4">
            LE RÉSEAU MEDIUMIA
          </p>
          <h1 className="font-georgia font-medium text-4xl md:text-5xl leading-tight mb-6">
            Trouver un praticien<br />qui vous correspond
          </h1>
          <p className="font-georgia text-mist text-lg leading-relaxed max-w-2xl mx-auto">
            Découvrez des professionnels du spirituel, du bien-être et de l'accompagnement.
            Chaque profil est étudié avant publication pour construire un réseau cohérent, humain et identifiable.
          </p>
        </section>

        <section className="px-6 pb-10 max-w-6xl mx-auto" aria-label="Filtrer les praticiens">
          <div className="flex flex-wrap gap-2 justify-center">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                aria-pressed={activeFilter === filter}
                className={`font-georgia text-xs tracking-wide px-4 py-2 rounded-full border transition-colors ${
                  activeFilter === filter
                    ? 'border-gold bg-gold/10 text-deep font-semibold'
                    : 'border-gold/25 text-mist hover:border-gold/60 hover:text-deep'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </section>

        <section className="px-6 pb-20 max-w-6xl mx-auto">
          {practitioners.length > 0 ? (
            <div className="grid gap-6">
              {practitioners.map((practitioner) => (
                <article
                  key={practitioner.id}
                  className="max-w-4xl w-full mx-auto overflow-hidden rounded-3xl border border-gold/30 bg-white/65 shadow-sm"
                >
                  <div className="grid md:grid-cols-[280px_1fr]">
                    <div className="relative min-h-[300px] md:min-h-full bg-deep/5">
                      <PractitionerPortrait practitioner={practitioner} />
                    </div>

                    <div className="p-7 md:p-9 flex flex-col">
                      {practitioner.founder ? (
                        <p className="font-georgia text-gold tracking-[0.2em] text-[10px] uppercase mb-3">
                          Membre Fondateur Mediumia — N°{String(practitioner.founderNumber).padStart(3, '0')}
                        </p>
                      ) : (
                        <p className="font-georgia text-gold tracking-[0.2em] text-[10px] uppercase mb-3">
                          Membre du réseau Mediumia
                        </p>
                      )}
                      <h2 className="font-georgia text-3xl md:text-4xl font-medium leading-tight mb-2">
                        {practitioner.name}
                      </h2>
                      <p className="font-georgia text-mist text-base mb-4">
                        {practitioner.role}{practitioner.city ? ` · ${practitioner.city}` : ''}
                      </p>

                      <div className="flex flex-wrap gap-2 mb-5">
                        <span className="font-georgia text-[11px] rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-deep">
                          {practitioner.audience}
                        </span>
                        <span className="font-georgia text-[11px] rounded-full border border-deep/10 bg-deep/5 px-3 py-1.5 text-mist">
                          {practitioner.membership}
                        </span>
                      </div>

                      <p className="font-georgia text-deep/80 leading-relaxed mb-5">
                        {practitioner.introduction}
                      </p>

                      <div className="flex flex-wrap gap-2 mb-6">
                        {practitioner.specialties.slice(0, 6).map((specialty) => (
                          <span
                            key={specialty}
                            className="font-georgia text-[11px] text-mist border border-gold/20 rounded-full px-3 py-1.5"
                          >
                            {specialty}
                          </span>
                        ))}
                      </div>

                      <details className="group mb-7 rounded-2xl border border-gold/20 bg-cream/55 px-5 py-4">
                        <summary className="font-georgia text-sm font-semibold cursor-pointer list-none flex items-center justify-between gap-4">
                          Découvrir son approche
                          <span className="text-gold group-open:rotate-45 transition-transform" aria-hidden="true">＋</span>
                        </summary>
                        <div className="pt-4 space-y-4 font-georgia text-sm text-mist leading-relaxed">
                          <p>{practitioner.approach}</p>
                          <p>{practitioner.spirituality}</p>
                          <div>
                            <p className="text-deep font-semibold mb-2">Motifs d'accompagnement</p>
                            <p>{practitioner.specialties.join(' · ')}</p>
                          </div>
                        </div>
                      </details>

                      <a
                        href={practitioner.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-auto inline-flex justify-center items-center rounded-xl bg-deep text-gold font-georgia font-bold px-6 py-3.5 hover:bg-deep/90 transition-colors"
                      >
                        {practitioner.externalLabel || 'Voir ses disponibilités'} →
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="max-w-xl mx-auto text-center rounded-3xl border border-gold/25 bg-white/40 px-8 py-10">
              <p className="font-georgia text-mist">Aucun profil ne correspond encore à ce filtre.</p>
            </div>
          )}

          <div className="max-w-xl mx-auto text-center mt-14 rounded-3xl border border-gold/20 px-8 py-8 bg-white/30">
            <p className="font-georgia text-gold tracking-[0.2em] text-[10px] uppercase mb-3">Réseau en développement</p>
            <p className="font-georgia text-mist leading-relaxed">
              Amandine, Willy et Gilda font partie des premiers profils du Réseau MediumIA. D'autres professionnels sélectionnés viendront progressivement enrichir l'annuaire.
            </p>
          </div>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
