const PATHS = {
  home: [
    {
      key: 'oracle',
      eyebrow: 'Je veux essayer gratuitement',
      title: "Oracle Au-delà de l'Âme",
      body: 'Commencez par un tirage test offert pour expérimenter l’univers MediumIA sans engagement.',
      action: 'Faire le tirage offert',
      handler: 'onOpenOracle',
      icon: '✦',
    },
    {
      key: 'chronosphere',
      eyebrow: 'J’ai besoin d’un éclairage maintenant',
      title: 'Chronosphère 999',
      body: 'Une lecture personnalisée de vos dynamiques présentes et de vos fenêtres temporelles.',
      action: 'Explorer ma ligne de temps',
      handler: 'onOpenChronosphere',
      icon: '✺',
    },
    {
      key: 'reseau',
      eyebrow: 'Je veux parler à quelqu’un',
      title: 'Trouver un praticien',
      body: 'Découvrez les membres du Réseau MediumIA et choisissez librement la personne qui vous correspond.',
      action: 'Découvrir le réseau',
      handler: 'onOpenReseau',
      icon: '◇',
    },
    {
      key: 'formation',
      eyebrow: 'Je veux apprendre',
      title: 'Médiumnité Consciente',
      body: 'Un parcours structuré pour développer votre pratique, votre discernement et votre autonomie.',
      action: 'Découvrir l’accompagnement',
      handler: 'onOpenFormation',
      icon: '◌',
    },
  ],
  chronosphere: [
    {
      key: 'oracle',
      eyebrow: 'Expérimenter autrement',
      title: "Oracle Au-delà de l'Âme",
      body: 'Un tirage offert pour ouvrir une autre porte symbolique, sans engagement.',
      action: 'Faire le tirage offert',
      handler: 'onOpenOracle',
      icon: '✦',
    },
    {
      key: 'reseau',
      eyebrow: 'Besoin d’un échange humain',
      title: 'Trouver un praticien',
      body: 'Découvrez les membres du Réseau MediumIA et choisissez librement la personne qui vous correspond.',
      action: 'Découvrir le réseau',
      handler: 'onOpenReseau',
      icon: '◇',
    },
    {
      key: 'formation',
      eyebrow: 'Développer votre pratique',
      title: 'Médiumnité Consciente',
      body: 'Un parcours structuré pour apprendre à ressentir, discerner et pratiquer avec davantage de conscience.',
      action: 'Découvrir l’accompagnement',
      handler: 'onOpenFormation',
      icon: '◌',
    },
  ],
  oracle: [
    {
      key: 'chronosphere',
      eyebrow: 'Aller plus loin dans le temps',
      title: 'Chronosphère 999',
      body: 'Croisez trois fréquences, votre ciel de naissance et des fenêtres temporelles dans une lecture personnalisée.',
      action: 'Explorer ma ligne de temps',
      handler: 'onOpenChronosphere',
      icon: '✺',
    },
    {
      key: 'reseau',
      eyebrow: 'Besoin d’un échange humain',
      title: 'Trouver un praticien',
      body: 'Parcourez le Réseau MediumIA et découvrez les approches, spécialités et modalités de chaque praticien.',
      action: 'Découvrir le réseau',
      handler: 'onOpenReseau',
      icon: '◇',
    },
    {
      key: 'formation',
      eyebrow: 'Apprendre par vous-même',
      title: 'Médiumnité Consciente',
      body: '25 modules et 84 exercices pour construire progressivement votre pratique et votre discernement.',
      action: 'Découvrir l’accompagnement',
      handler: 'onOpenFormation',
      icon: '◌',
    },
  ],
}

export default function EcosystemNextSteps({
  context = 'chronosphere',
  onOpenOracle,
  onOpenChronosphere,
  onOpenReseau,
  onOpenFormation,
  className = '',
}) {
  const handlers = { onOpenOracle, onOpenChronosphere, onOpenReseau, onOpenFormation }
  const paths = (PATHS[context] || PATHS.chronosphere).filter((path) => typeof handlers[path.handler] === 'function')

  if (!paths.length) return null

  const gridClass = paths.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'

  return (
    <section className={`rounded-3xl border border-gold/25 bg-deep px-6 py-8 text-cream shadow-lg md:px-8 md:py-10 ${className}`}>
      <div className="max-w-2xl">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">
          {context === 'home' ? 'Par où commencer ?' : 'Continuer votre chemin'}
        </p>
        <h2 className="mt-2 font-georgia text-2xl font-medium leading-tight md:text-3xl">
          {context === 'home' ? 'Choisissez simplement ce dont vous avez besoin aujourd’hui.' : 'Une porte peut naturellement en ouvrir une autre.'}
        </h2>
        <p className="mt-3 font-georgia text-sm leading-relaxed text-cream/65">
          MediumIA relie les expériences sans vous imposer de parcours. Choisissez simplement ce qui vous serait utile maintenant.
        </p>
      </div>

      <div className={`mt-7 grid gap-3 ${gridClass}`}>
        {paths.map((path) => (
          <button
            key={path.key}
            type="button"
            onClick={handlers[path.handler]}
            className="group rounded-2xl border border-gold/25 bg-white/[.06] p-5 text-left transition-colors hover:border-gold/60 hover:bg-white/[.09]"
          >
            <span className="text-xl text-gold">{path.icon}</span>
            <span className="mt-4 block font-georgia text-[10px] uppercase tracking-[0.14em] text-gold/70">{path.eyebrow}</span>
            <strong className="mt-1.5 block font-georgia text-lg font-medium text-cream">{path.title}</strong>
            <span className="mt-2 block font-georgia text-xs leading-relaxed text-cream/60">{path.body}</span>
            <span className="mt-5 block font-georgia text-xs font-bold text-gold transition-transform group-hover:translate-x-1">{path.action} →</span>
          </button>
        ))}
      </div>
    </section>
  )
}
