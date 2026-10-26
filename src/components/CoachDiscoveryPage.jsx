import TrialChat from './TrialChat'
import SiteNav from './SiteNav'
import LegalFooter from './LegalFooter'

const EXAMPLES = [
  'Parler de vos ressentis sans jugement',
  'Découvrir un exercice simple d’attention et de perception',
  'Apprendre à distinguer observation et interprétation',
]

export default function CoachDiscoveryPage({ onBack, onOpenFormation, onNavigate }) {
  return (
    <div id="top" className="min-h-screen min-w-0 overflow-x-hidden bg-cream text-deep">
      <SiteNav current="coach" onOpenFormation={onOpenFormation} />

      <main className="mx-auto max-w-6xl min-w-0 px-4 pb-20 pt-28 sm:px-6 sm:pt-36">
        <button type="button" onClick={onBack}
          className="mb-8 font-georgia text-sm text-mist underline decoration-gold/50 underline-offset-4 hover:text-deep">
          ← Retour à l’accueil
        </button>

        <header className="mb-9 rounded-3xl border border-gold/25 px-6 py-9 sm:px-10 sm:py-12"
          style={{ background: 'linear-gradient(130deg, #1A1535, #2B224A)' }}>
          <p className="font-georgia text-xs uppercase tracking-[0.25em] text-gold">Découverte gratuite · sans inscription</p>
          <h1 className="mt-4 font-georgia text-3xl leading-tight text-cream sm:text-5xl">
            Faites connaissance avec MediumIA
          </h1>
          <p className="mt-4 max-w-2xl font-georgia text-base leading-relaxed text-cream/80 sm:text-lg">
            Un coach IA pour poser vos questions, explorer vos ressentis et découvrir des pistes de pratique à votre rythme.
            Rien à acheter pour commencer.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 font-georgia text-xs text-cream/80">
            <span className="rounded-full border border-gold/35 px-3 py-2">5 messages offerts</span>
            <span className="rounded-full border border-gold/35 px-3 py-2">Sans carte bancaire</span>
            <span className="rounded-full border border-gold/35 px-3 py-2">Vous gardez votre libre arbitre</span>
          </div>
        </header>

        <div className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <aside className="space-y-5">
            <div className="rounded-2xl border border-gold/25 bg-white/70 p-6">
              <h2 className="font-georgia text-xl text-deep">Comment MediumIA peut vous aider</h2>
              <ul className="mt-4 space-y-3">
                {EXAMPLES.map((example) => (
                  <li key={example} className="flex items-start gap-3 font-georgia text-sm leading-relaxed text-mist">
                    <span className="mt-0.5 text-gold" aria-hidden="true">✦</span>{example}
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-gold/15 pt-4 font-georgia text-sm leading-relaxed text-mist">
                MediumIA est une intelligence artificielle, pas un médium. Elle ne vérifie pas les perceptions spirituelles,
                ne prédit pas l’avenir et ne remplace pas un accompagnement humain.
              </p>
            </div>
            <div className="rounded-2xl border border-gold/20 bg-gold/10 p-6">
              <p className="font-georgia text-xs uppercase tracking-widest text-mist">Pour aller plus loin, seulement si vous le souhaitez</p>
              <h2 className="mt-2 font-georgia text-lg text-deep">La formation MediumIA</h2>
              <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
                Un parcours structuré de 25 modules et 84 exercices conçu par Sébastien Seguin.
                Votre échange gratuit ne vous engage à rien.
              </p>
              <button type="button" onClick={onOpenFormation}
                className="mt-4 rounded-xl border border-gold/50 bg-white px-4 py-3 font-georgia text-sm font-semibold text-deep hover:bg-cream">
                Découvrir la formation →
              </button>
            </div>
          </aside>

          <section aria-labelledby="coach-discovery-heading" className="min-w-0">
            <h2 id="coach-discovery-heading" className="mb-3 font-georgia text-xl text-deep">Discutez avec MediumIA</h2>
            <TrialChat variant="coach" />
            <p className="mt-3 font-georgia text-xs leading-relaxed text-mist">
              Ne partagez pas d’informations personnelles sensibles. Les messages sont envoyés au service d’IA
              pour générer une réponse ; l’essai gratuit est limité et protégé contre les abus.
            </p>
          </section>
        </div>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
