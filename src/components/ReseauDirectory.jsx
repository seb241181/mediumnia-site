export default function ReseauDirectory({ onBack }) {
  const disciplines = [
    'Tous', 'Médiumnité', 'Guidance', 'Bien-être', 'EFT',
    'Réflexologie', 'Naturopathie', 'Accompagnement intérieur',
  ]

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

        {/* Hero */}
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
            Chaque profil est étudié et validé avant publication — pour un réseau cohérent, humain et identifiable.
          </p>
        </section>

        {/* Filtres — structure future */}
        <section className="px-6 pb-10 max-w-6xl mx-auto">
          <div className="flex flex-wrap gap-2 justify-center">
            {disciplines.map((d, i) => (
              <button
                key={d}
                disabled
                className={`font-georgia text-xs tracking-wide px-4 py-2 rounded-full border transition-colors cursor-default ${
                  i === 0
                    ? 'border-gold bg-gold/10 text-deep font-semibold'
                    : 'border-gold/25 text-mist'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </section>

        {/* État vide — réseau en constitution */}
        <section className="px-6 pb-24 max-w-6xl mx-auto">

          {/* Aperçu de la structure future (cartes fantômes) */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-14 opacity-30 pointer-events-none select-none">
            {[1, 2, 3].map(n => (
              <div key={n} className="rounded-3xl border border-gold/25 bg-white/40 p-6 flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gold/20 shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-deep/15 rounded w-3/4" />
                    <div className="h-2.5 bg-deep/10 rounded w-1/2" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="h-2 bg-deep/10 rounded w-full" />
                  <div className="h-2 bg-deep/10 rounded w-5/6" />
                  <div className="h-2 bg-deep/10 rounded w-4/6" />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <div className="h-5 w-16 rounded-full bg-gold/20" />
                  <div className="h-5 w-20 rounded-full bg-gold/20" />
                </div>
                <div className="pt-2 border-t border-gold/15">
                  <div className="h-7 rounded-lg bg-deep/10 w-full" />
                </div>
              </div>
            ))}
          </div>

          {/* Message principal */}
          <div className="max-w-xl mx-auto text-center rounded-3xl border-2 border-gold/30 px-10 py-12"
            style={{ background: 'linear-gradient(135deg,rgba(201,168,76,.07),rgba(201,168,76,.02))' }}>
            <p className="text-gold text-4xl mb-5">◈</p>
            <p className="font-georgia text-gold tracking-[0.22em] text-[11px] uppercase mb-4">
              Réseau en constitution
            </p>
            <h2 className="font-georgia font-medium text-2xl text-deep leading-tight mb-4">
              Les premiers profils arrivent bientôt
            </h2>
            <p className="font-georgia text-mist leading-relaxed">
              Le réseau MediumIA est en cours de construction. Les praticiens sélectionnés
              seront présentés ici avec leur photo, leur activité, leur ville et une présentation
              de leur approche, pour vous permettre de trouver l'accompagnement qui vous correspond vraiment.
            </p>
          </div>

        </section>

      </main>

      <footer className="border-t border-gold/20 px-6 py-8 text-center">
        <img
          src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png"
          alt="MediumIA"
          className="w-32 md:w-40 mx-auto mb-4"
        />
        <p className="font-georgia text-mist text-xs">
          Réseau MediumIA · Praticiens du spirituel et du bien-être
        </p>
      </footer>

    </div>
  )
}
