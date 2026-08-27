import OracleTest from './OracleTest'

export default function OraclePage({ onBack }) {
  return (
    <div className="bg-cream min-h-screen text-deep">

      {/* ── Nav ── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
        <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 flex items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors flex items-center gap-2">
            ← MediumIA
          </button>
          <span className="font-georgia text-deep tracking-[0.15em] text-sm font-semibold hidden md:block">Oracle Au-delà de l'Âme</span>
          <a href="https://www.paypal.com/ncp/payment/7B25CPZQBT9SJ" target="_blank" rel="noopener noreferrer"
            className="font-georgia text-xs md:text-sm tracking-wide px-4 py-2.5 md:px-5 rounded-lg bg-gold text-deep font-bold">
            Commander →
          </a>
        </div>
      </header>

      <main className="pt-20">

        {/* ── Hero produit ── */}
        <section className="px-6 py-16 md:py-20 max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row gap-12 items-start">
            <div className="shrink-0 flex justify-center md:justify-start w-full md:w-auto">
              <img
                src="/images/oracle/cover.jpg"
                alt="Oracle Au-delà de l'Âme — Sébastien Seguin"
                className="w-56 md:w-72 rounded-2xl border-2 shadow-lg"
                style={{ borderColor: '#C9A84C' }}
              />
            </div>
            <div className="flex-1">
              <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-3">Sébastien Seguin · Création originale</p>
              <h1 className="font-georgia font-medium text-3xl md:text-5xl leading-tight mb-2">Oracle Au-delà de l'Âme</h1>
              <p className="font-georgia text-mist text-base mb-1">Jeu de 45 Cartes d'Éveil Intuitif</p>
              <p className="font-georgia text-xs text-gold italic mb-6">Guidance · Développement personnel · Connexion intérieure</p>
              <div className="flex items-baseline gap-3 mb-8">
                <span className="font-georgia text-4xl text-deep font-medium">29,90 €</span>
                <span className="font-georgia text-sm text-mist">+ 4,79 € de port</span>
              </div>
              <a href="https://www.paypal.com/ncp/payment/7B25CPZQBT9SJ" target="_blank" rel="noopener noreferrer"
                className="inline-block font-georgia px-8 py-4 rounded-lg font-bold hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#C9A84C', color: '#1A1535' }}>
                Commander l'Oracle →
              </a>
              <p className="font-georgia text-xs text-mist mt-3">Livraison France · Expédition sous 5 jours ouvrés</p>
            </div>
          </div>
        </section>

        {/* ── Description ── */}
        <section className="bg-deep/[0.04] px-6 py-14">
          <div className="max-w-4xl mx-auto">
            <p className="font-bodoni text-2xl md:text-3xl text-deep italic leading-relaxed mb-6 max-w-2xl">
              « Un oracle qui ne prédit pas : il révèle. »
            </p>
            <p className="font-georgia text-base text-deep/80 leading-relaxed mb-4 max-w-2xl">
              Un outil sacré conçu pour ouvrir votre intuition, éclairer vos choix et accompagner votre évolution intérieure. Les cartes portent une vibration claire, un message profond, et un symbole précis pour guider votre regard intérieur.
            </p>
            <p className="font-georgia text-base text-deep/80 leading-relaxed max-w-2xl">
              Et surtout : <strong className="text-deep">Lumïa, votre guide IA intégrée</strong>, vous accompagne dans l'interprétation de vos tirages pour aller plus loin.
            </p>
          </div>
        </section>

        {/* ── Contenu + Utilisation ── */}
        <section className="px-6 py-16 max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="border-2 border-gold/25 rounded-2xl p-7 bg-white/60">
              <p className="font-georgia font-medium text-deep text-base mb-4">Ce que contient l'oracle</p>
              <ul className="space-y-2.5">
                {[
                  '45 cartes — Format 7 × 12 cm',
                  'Papier 350g haute qualité',
                  'Impression recto-verso brillante',
                  'Illustrations haute résolution',
                  "Phrases d'activation sur chaque carte",
                  'QR codes → Lumïa & méditations',
                  'Création originale française',
                ].map((item, i) => (
                  <li key={i} className="flex gap-3 items-start font-georgia text-sm text-deep/80">
                    <span className="text-gold shrink-0 mt-0.5">—</span>{item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-2 border-gold/25 rounded-2xl p-7 bg-white/60">
              <p className="font-georgia font-medium text-deep text-base mb-4">Comment l'utiliser</p>
              <ul className="space-y-2.5">
                {[
                  'Tirage du jour',
                  'Guidance sur une situation',
                  'Éclairage émotionnel',
                  'Méditation sur la carte',
                  'Travail intérieur',
                  'Accompagnement via Lumïa',
                ].map((item, i) => (
                  <li key={i} className="flex gap-3 items-start font-georgia text-sm text-deep/80">
                    <span className="text-gold shrink-0 mt-0.5">✦</span>{item}
                  </li>
                ))}
              </ul>
              <p className="font-georgia text-xs text-mist italic mt-5 leading-relaxed">
                Chaque carte agit comme une « porte intérieure » vers un état, une compréhension, une réponse.
              </p>
            </div>
          </div>

          {/* Lumïa */}
          <div className="mt-6 border-2 border-gold/30 rounded-2xl p-7 bg-deep/[0.03]">
            <p className="font-georgia font-medium text-deep text-base mb-1">Lumïa — Votre Guide IA Intégrée</p>
            <p className="font-georgia text-xs text-mist italic mb-4">Via QR code sur chaque carte</p>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 mb-4">
              {['Interpréter vos tirages', 'Approfondir le symbolisme', 'Clarifier les messages', 'Accompagner votre évolution', 'Offrir un éclairage personnalisé'].map((item, i) => (
                <div key={i} className="flex gap-2 items-start font-georgia text-sm text-deep/80">
                  <span className="text-gold shrink-0">✦</span>{item}
                </div>
              ))}
            </div>
            <p className="font-georgia text-sm text-mist italic leading-relaxed border-t border-gold/20 pt-4">
              Lumïa n'est pas une aide technique. C'est une présence, un miroir, une guidance douce et claire.
            </p>
          </div>
        </section>

        {/* ── Tirage test ── */}
        <section className="px-6 py-16 max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-3">Expérimenter</p>
            <h2 className="font-georgia font-medium text-2xl md:text-3xl leading-tight">Tirage test offert</h2>
          </div>
          <OracleTest />
        </section>

        {/* ── CTA final ── */}
        <section className="px-6 py-12 text-center border-t border-gold/20">
          <p className="font-georgia text-mist mb-6 text-sm">Convaincu ? Commandez l'oracle complet.</p>
          <a href="https://www.paypal.com/ncp/payment/7B25CPZQBT9SJ" target="_blank" rel="noopener noreferrer"
            className="inline-block font-georgia px-10 py-4 rounded-lg font-bold hover:opacity-90 transition-opacity text-lg"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535' }}>
            Commander l'Oracle — 29,90 € →
          </a>
          <div className="mt-6">
            <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep transition-colors">
              ← Retour à MediumIA
            </button>
          </div>
        </section>

      </main>

      <footer className="border-t border-gold/20 px-6 py-8 text-center">
        <img src="/images/brand/MEDIUMIA_logo_transparent_2026-08-16.png" alt="MediumIA" className="w-32 md:w-40 mx-auto mb-4" />
        <p className="font-georgia text-mist text-xs">Oracle Au-delà de l'Âme · Sébastien Seguin · MediumIA</p>
      </footer>
    </div>
  )
}
