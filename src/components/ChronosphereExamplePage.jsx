import LegalFooter from './LegalFooter'

const DEMO_CARDS = [
  {
    number: '17',
    role: 'FRÉQUENCE PRINCIPALE',
    name: 'L’Ouverture',
    meta: 'Expansion · mouvement',
    text: 'Une dynamique commence à sortir de l’attente. Le potentiel n’est pas encore totalement stabilisé, mais quelque chose demande à être accueilli plutôt qu’analysé indéfiniment.',
  },
  {
    number: '31',
    role: 'RÉSONANCE I',
    name: 'La Bifurcation',
    meta: 'Choix · repositionnement',
    text: 'Cette résonance introduit un choix réel : continuer selon l’ancien réflexe de sécurité, ou tester une voie plus alignée avec ce qui cherche à émerger.',
  },
  {
    number: '44',
    role: 'RÉSONANCE II',
    name: 'L’Alignement',
    meta: 'Cohérence · incarnation',
    text: 'La seconde résonance rappelle que la bonne direction n’est pas forcément la plus spectaculaire : elle est celle que les actes quotidiens peuvent réellement soutenir.',
  },
]

const TIMELINE = [
  { label: 'Maintenant', date: 'Aujourd’hui', note: 'Observer ce qui insiste sans forcer une réponse.' },
  { label: 'Préparation', date: '8 → 18 octobre', note: 'Clarifier, structurer, préparer une demande ou une décision.' },
  { label: 'Fenêtre secondaire', date: '24 → 31 octobre', note: 'Tester, échanger, présenter une première version.' },
  { label: 'Fenêtre prioritaire', date: '7 → 17 novembre', note: 'Période la plus fluide de l’exemple pour avancer concrètement.' },
  { label: 'Vigilance', date: '21 → 26 novembre', note: 'Éviter les décisions prises uniquement sous pression.' },
]

function Section({ eyebrow, title, children, dark = false }) {
  return (
    <article className={`rounded-3xl border p-6 md:p-8 ${dark ? 'border-deep bg-deep text-cream' : 'border-gold/25 bg-white/75 text-deep'}`}>
      <p className={`font-georgia text-[10px] uppercase tracking-[0.18em] ${dark ? 'text-gold' : 'text-gold'}`}>{eyebrow}</p>
      <h2 className={`mt-2 font-georgia text-2xl font-medium leading-tight md:text-3xl ${dark ? 'text-cream' : 'text-deep'}`}>{title}</h2>
      <div className={`mt-4 font-georgia text-[15px] leading-[1.85] md:text-base ${dark ? 'text-cream/80' : 'text-deep/80'}`}>
        {children}
      </div>
    </article>
  )
}

export default function ChronosphereExamplePage({ onBack, onOpenChronosphere, onNavigate }) {
  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <button onClick={onBack} className="flex items-center gap-2.5 font-georgia text-sm font-semibold tracking-[0.18em] text-deep">
            <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="" aria-hidden="true" className="h-8 w-auto" />
            MEDIUMIA
          </button>
          <button onClick={onBack} className="font-georgia text-xs text-mist transition-colors hover:text-deep">← Retour</button>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-10 pt-14 text-center md:pt-20">
          <p className="font-georgia text-xs uppercase tracking-[0.28em] text-gold">CHRONOSPHÈRE 999 · Démonstration</p>
          <h1 className="mt-4 font-georgia text-4xl font-medium leading-tight md:text-6xl">Voir avant de choisir.</h1>
          <p className="mx-auto mt-5 max-w-2xl font-bodoni text-xl italic leading-relaxed text-deep/75 md:text-2xl">
            Un exemple complet pour comprendre ce que contient réellement une lecture Chronosphère.
          </p>
          <div className="mx-auto mt-7 max-w-2xl rounded-2xl border border-gold/35 bg-white/75 px-5 py-4">
            <p className="font-georgia text-sm leading-relaxed text-deep/75">
              <strong className="text-deep">Exemple fictif.</strong> Le prénom, les cartes, les données astrologiques et les dates ci-dessous sont créés uniquement pour illustrer la forme et la profondeur d’un tirage. Aucune personne réelle n’est utilisée.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl space-y-5 px-6 pb-20">
          <article className="overflow-hidden rounded-3xl border-2 border-gold bg-gradient-to-br from-gold/[.15] via-white to-white p-6 shadow-md md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold">Votre tirage en 30 secondes</p>
            <p className="mt-3 font-georgia text-2xl font-medium leading-snug md:text-3xl">Une ouverture réelle se présente, mais elle demande un choix clair plutôt qu’un simple espoir.</p>
            <p className="mt-4 font-georgia text-base leading-relaxed text-deep/75">
              La dynamique est <strong className="text-deep">favorable mais en construction</strong>. Le mouvement devient plus porteur lorsque tu cesses d’attendre un signe supplémentaire et que tu transformes ton intuition en une action vérifiable.
            </p>
          </article>

          <Section eyebrow="01" title="La photographie de l’instant">
            <p>
              Tu es dans une phase où une possibilité prend de la place, mais où l’ancien besoin de certitude peut ralentir le passage à l’action. L’enjeu principal n’est pas de savoir si tout est déjà sécurisé : il est de vérifier si ce que tu envisages peut devenir concret sans te demander de te trahir.
            </p>
            <p className="mt-4">
              Dans cet exemple, le ciel de naissance met symboliquement l’accent sur la manière de décider et de rendre visible un projet. Le contexte actuel soutient davantage la clarification et la présentation que la précipitation.
            </p>
          </Section>

          <section className="grid gap-4 md:grid-cols-3">
            {DEMO_CARDS.map((card, index) => (
              <article key={card.number} className={`rounded-2xl border-2 p-5 ${index === 0 ? 'border-gold bg-gold/[.09]' : 'border-gold/30 bg-white/80'}`}>
                <p className="font-georgia text-[10px] uppercase tracking-[0.13em] text-mist">{card.role} · N°{card.number}</p>
                <h2 className="mt-2 font-georgia text-xl font-medium">{card.name}</h2>
                <p className="mt-1 font-georgia text-xs text-gold">{card.meta}</p>
                <p className="mt-4 font-georgia text-sm leading-relaxed text-deep/70">{card.text}</p>
              </article>
            ))}
          </section>

          <Section eyebrow="02" title="La fréquence principale">
            <p>
              <strong>L’Ouverture</strong> est l’axe de ce tirage fictif. Elle ne dit pas que « tout va arriver » : elle indique qu’une porte cesse d’être purement théorique. Ce qui était encore une idée ou une envie peut maintenant être confronté au réel.
            </p>
            <p className="mt-4">
              Sa lumière : remettre du mouvement là où l’analyse tournait en boucle. Sa vigilance : confondre ouverture et obligation. Une possibilité peut être bonne sans devoir être acceptée immédiatement.
            </p>
          </Section>

          <Section eyebrow="03" title="Les deux résonances">
            <p>
              <strong>La Bifurcation</strong> déplace la question vers le choix : qu’est-ce que tu acceptes de changer pour que cette ouverture devienne réellement possible ? <strong>L’Alignement</strong> resserre ensuite le critère : la bonne direction doit pouvoir être tenue dans tes actes, ton temps et tes limites.
            </p>
          </Section>

          <Section eyebrow="04" title="Ce que racontent les trois fréquences ensemble">
            <p>
              Ensemble, elles décrivent moins une promesse qu’un passage : une possibilité apparaît, elle oblige à choisir, puis elle demande de vérifier si ce choix est vivable. Le triangle complet devient donc : <strong>ouvrir → choisir → incarner</strong>.
            </p>
          </Section>

          <Section eyebrow="05" title="Le ciel de naissance et le contexte astrologique">
            <p>
              Dans cette démonstration, Chronosphère ne récite pas un thème astral complet. Elle retient seulement les éléments utiles au sujet : un climat favorable à la clarification, un appui pour rendre une idée plus visible, et une zone de tension qui invite à ne pas prendre une décision uniquement pour faire cesser l’inconfort.
            </p>
            <p className="mt-4 text-sm text-mist">
              Les positions, aspects et maisons d’un vrai tirage sont calculés côté serveur à partir des données de naissance fournies. Leur lecture reste symbolique et introspective.
            </p>
          </Section>

          <article className="rounded-3xl border border-gold/30 bg-white/75 p-6 md:p-8">
            <p className="font-georgia text-[10px] uppercase tracking-[0.18em] text-gold">06 · La ligne de temps</p>
            <h2 className="mt-2 font-georgia text-2xl font-medium md:text-3xl">Quand préparer, avancer et ralentir.</h2>
            <div className="mt-6 grid gap-3 md:grid-cols-5">
              {TIMELINE.map((step, index) => (
                <div key={step.label} className={`rounded-2xl border p-4 ${index === 3 ? 'border-gold bg-gold/[.1]' : 'border-gold/20 bg-cream/60'}`}>
                  <p className="font-georgia text-xs font-medium text-deep">{step.label}</p>
                  <p className="mt-1 font-georgia text-xs text-gold">{step.date}</p>
                  <p className="mt-3 font-georgia text-[11px] leading-relaxed text-mist">{step.note}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 font-georgia text-xs leading-relaxed text-mist">Ces périodes sont présentées comme des fenêtres de climat symbolique, jamais comme des dates où un événement serait garanti.</p>
          </article>

          <Section eyebrow="07" title="Les deux chemins possibles">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gold/20 bg-cream/70 p-5">
                <p className="font-georgia text-sm font-medium text-deep">Si tu maintiens la dynamique actuelle…</p>
                <p className="mt-3">La possibilité reste ouverte, mais le risque est de prolonger l’entre-deux : beaucoup de réflexion, peu de confrontation au réel, puis une fatigue qui finit par faire choisir à ta place.</p>
              </div>
              <div className="rounded-2xl border border-gold/45 bg-gold/[.08] p-5">
                <p className="font-georgia text-sm font-medium text-deep">Si tu modifies cet élément…</p>
                <p className="mt-3">En transformant la question « est-ce certain ? » en « quel petit test concret puis-je faire ? », la trajectoire devient plus lisible. Tu récupères une information réelle au lieu d’attendre une certitude intérieure parfaite.</p>
              </div>
            </div>
          </Section>

          <Section eyebrow="08" title="Vos leviers concrets">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-cream/70 p-5"><strong>À faire maintenant</strong><p className="mt-2">Écrire le prochain geste observable : appel, proposition, dossier, conversation ou test.</p></div>
              <div className="rounded-2xl bg-cream/70 p-5"><strong>À préparer</strong><p className="mt-2">Les conditions minimales qui rendent le choix soutenable : temps, budget, limites et plan B.</p></div>
              <div className="rounded-2xl bg-cream/70 p-5"><strong>À ne pas forcer</strong><p className="mt-2">Une réponse définitive avant d’avoir obtenu les informations que seul le réel peut fournir.</p></div>
            </div>
          </Section>

          <Section eyebrow="09" title="La question que Chronosphère vous renvoie">
            <p className="font-bodoni text-2xl italic leading-relaxed text-deep">
              « Qu’est-ce que j’attends encore de savoir avant d’oser tester ce que je sais déjà suffisamment pour commencer ? »
            </p>
          </Section>

          <Section eyebrow="10" title="Acte de réalignement" dark>
            <p><strong className="text-cream">Geste :</strong> écris sur une feuille l’action la plus petite qui permettrait de vérifier cette possibilité dans le réel, puis donne-lui une date.</p>
            <p className="mt-4 font-bodoni text-xl italic text-gold">« Je n’ai pas besoin de tout connaître pour poser un acte juste. »</p>
          </Section>

          <article className="rounded-3xl border-2 border-gold bg-white p-7 text-center shadow-md md:p-10">
            <p className="font-georgia text-xs uppercase tracking-[0.2em] text-gold">Votre lecture sera personnelle</p>
            <h2 className="mt-3 font-georgia text-3xl font-medium md:text-4xl">Votre ciel. Vos trois nombres. Votre question.</h2>
            <p className="mx-auto mt-4 max-w-2xl font-georgia text-base leading-relaxed text-mist">
              L’exemple montre la structure. Votre vrai tirage utilise vos données de naissance, les trois fréquences choisies et votre thème pour produire une lecture différente.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <button onClick={onOpenChronosphere} className="rounded-xl bg-gold px-7 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90">Faire mon tirage — dès 5 € →</button>
              <button onClick={onBack} className="rounded-xl border border-gold/45 px-7 py-4 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/[.08]">Retour à MediumIA</button>
            </div>
          </article>

          <p className="text-center font-georgia text-xs leading-relaxed text-mist/70">
            Chronosphère propose une lecture symbolique et introspective. Il n’établit pas de certitude sur l’avenir et ne remplace aucun conseil médical, juridique ou financier.
          </p>
        </section>
      </main>

      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
