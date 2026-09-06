import LegalFooter from './LegalFooter'
import { reseauPractitioners } from '../data/reseauPractitioners'

function withPreviewShareToken(src) {
  if (typeof window === 'undefined' || !src?.startsWith('/')) return src
  const token = new URLSearchParams(window.location.search).get('_vercel_share')
  if (!token) return src
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}_vercel_share=${encodeURIComponent(token)}`
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
              <img
                src={withPreviewShareToken(practitioner.portrait)}
                alt={practitioner.portraitAlt}
                className="aspect-[4/5] h-full w-full object-cover object-center"
              />
            </div>

            <div>
              <p className="font-georgia text-[10px] uppercase tracking-[0.22em] text-gold">
                {practitioner.founder
                  ? `Membre Fondateur MediumIA — N°${String(practitioner.founderNumber).padStart(3, '0')}`
                  : 'Membre du Réseau MediumIA'}
              </p>
              <h1 className="mt-4 font-georgia text-4xl font-medium leading-tight md:text-6xl">{practitioner.name}</h1>
              <p className="mt-3 font-georgia text-lg text-mist">{practitioner.role} · {practitioner.city}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 font-georgia text-xs text-deep">{practitioner.audience}</span>
                <span className="rounded-full border border-deep/10 bg-deep/5 px-3 py-1.5 font-georgia text-xs text-mist">{practitioner.membership}</span>
              </div>
              <p className="mt-7 max-w-2xl font-georgia text-base leading-relaxed text-deep/80 md:text-lg">{practitioner.introduction}</p>
              <a
                href={practitioner.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex rounded-xl bg-deep px-7 py-4 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90"
              >
                Voir ses disponibilités →
              </a>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-6 py-14 md:grid-cols-2 md:py-20">
          <article className="rounded-3xl border border-gold/20 bg-white/65 p-7 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Son approche</p>
            <h2 className="mt-3 font-georgia text-2xl font-medium">Un accompagnement à son rythme</h2>
            <p className="mt-4 font-georgia text-sm leading-relaxed text-mist">{practitioner.approach}</p>
          </article>
          <article className="rounded-3xl border border-gold/20 bg-white/65 p-7 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Sa sensibilité</p>
            <h2 className="mt-3 font-georgia text-2xl font-medium">Accueillir la personne dans sa globalité</h2>
            <p className="mt-4 font-georgia text-sm leading-relaxed text-mist">{practitioner.spirituality}</p>
          </article>
        </section>

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
