// Blocs complémentaires de l'accueil : quiz gratuit et découverte de l'Arche.
// Les anciennes sections éditoriales restent exclues de la page d'accueil.
import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'

function openWith(onOpen, metric) {
  return (event) => {
    if (metric) trackMediumiaMetric('home_door_click', `home:${metric}`)
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
}

// Une seule porte d'entrée gratuite : trois expériences distinctes dans un même
// encadré bleu, plutôt que des rubriques concurrentes sur la page d'accueil.
export function QuizInvite({ onOpenQuiz, onOpenOracle }) {
  return (
    <section id="quiz" className="mx-auto max-w-6xl scroll-mt-28 px-6 pt-16" aria-labelledby="quiz-invite-title">
      <article
        className="on-dark relative overflow-hidden rounded-3xl border border-gold/25 p-7 shadow-lg md:p-10 lg:p-12"
        style={{ background: 'linear-gradient(135deg, #1A1535 0%, #243762 100%)' }}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <p className="font-georgia text-[11px] uppercase tracking-[0.25em] text-gold">Trois expériences gratuites · à votre rythme</p>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
            <div className="flex flex-col items-start justify-center">
              <p className="font-georgia text-xs uppercase tracking-[0.2em] text-gold">Quiz · 2 minutes</p>
              <h2 id="quiz-invite-title" className="mt-3 font-georgia text-3xl font-medium leading-tight text-cream md:text-4xl">
                Quel est votre canal de perception&nbsp;?
              </h2>
              <p className="mt-4 max-w-xl font-georgia text-base leading-relaxed text-cream/80 md:text-lg">
                Vous sentez, vous voyez, vous entendez ou vous savez&nbsp;? Huit questions pour découvrir votre manière naturelle de percevoir.
              </p>
              <a
                href="/quiz-sensibilite"
                onClick={openWith(onOpenQuiz, 'quiz')}
                className="mt-6 inline-flex min-h-[48px] items-center rounded-full bg-gold px-7 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/90"
              >
                Découvrir mon canal →
              </a>
              <p className="mt-3 font-georgia text-xs text-cream/70">Sans inscription · résultat immédiat</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="flex flex-col rounded-2xl border border-gold/25 p-5" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Oracle Au-delà de l’Âme</p>
                <h3 className="mt-2 font-georgia text-xl font-medium text-cream">Tirage test offert</h3>
                <p className="mt-2 flex-1 font-georgia text-sm leading-relaxed text-cream/80">
                  Tirez une carte et découvrez une première lecture guidée gratuitement.
                </p>
                <a href="/oracle" onClick={openWith(onOpenOracle, 'oracle')} className="mt-4 inline-flex min-h-[44px] items-center self-start font-georgia text-sm font-bold text-gold underline decoration-gold/40 underline-offset-4 hover:text-cream">
                  Faire un tirage offert →
                </a>
              </div>
              <div className="flex flex-col rounded-2xl border border-gold/25 p-5" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Défi Intuition · 2 minutes</p>
                <h3 className="mt-2 font-georgia text-xl font-medium text-cream">Exercice d’intuition du jour</h3>
                <p className="mt-2 flex-1 font-georgia text-sm leading-relaxed text-cream/80">
                  Cinq cartes, une étoile à retrouver. Écoutez votre premier ressenti.
                </p>
                <a href="/defi-intuition" className="mt-4 inline-flex min-h-[44px] items-center self-start font-georgia text-sm font-bold text-gold underline decoration-gold/40 underline-offset-4 hover:text-cream">
                  Faire l’exercice →
                </a>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  )
}

export function PathLadder({ onOpenQuiz, onOpenFormation, onOpenReseauForm }) {
  const steps = [
    {
      label: 'Explorer', price: 'Gratuit', title: 'Découvrir votre sensibilité',
      text: 'Quiz, Défi Intuition ou tirage offert.',
      links: [
        { label: 'Le quiz', href: '/quiz-sensibilite', onOpen: onOpenQuiz, metric: 'quiz' },
        { label: 'Défi Intuition', href: '/defi-intuition' },
        { label: 'Tirage offert', href: '/oracle#tirage-gratuit' },
      ],
    },
    {
      label: 'Pratiquer', price: 'Gratuit', title: '3 exercices par e-mail',
      text: 'Trois exercices issus de la Formation.',
      links: [{ label: 'Recevoir les exercices', href: '/formation#formation-exercices-gratuits' }],
    },
    {
      label: 'Commencer', price: '29 €', title: 'La Découverte',
      text: 'Module 1, exercices et 30 jours avec MediumIA.',
      links: [{ label: 'Voir la Découverte', href: '/formation', onOpen: onOpenFormation, metric: 'formation' }],
    },
    {
      label: 'Se former', price: 'Formation complète', title: '25 modules · 84 exercices',
      text: '4 niveaux pour aller jusqu’à une pratique autonome.',
      links: [{ label: 'Découvrir la Formation', href: '/formation', onOpen: onOpenFormation, metric: 'formation' }],
    },
    {
      label: 'Transmettre', price: 'Praticiens', title: 'Rejoindre le Réseau',
      text: 'Présenter votre pratique dans le Réseau MediumIA.',
      links: [{ label: 'Rejoindre le réseau', href: '/reseau/rejoindre', onOpen: onOpenReseauForm, metric: 'reseau' }],
    },
  ]

  return (
    <section id="chemin" className="mx-auto max-w-6xl scroll-mt-28 px-6 pt-16" aria-labelledby="chemin-title">
      <div className="max-w-2xl">
        <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Votre chemin</p>
        <h2 id="chemin-title" className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Avancez simplement, à votre rythme.</h2>
      </div>
      <ol className="mt-10 grid gap-4 md:grid-cols-5">
        {steps.map((step, index) => {
          const paid = step.label === 'Commencer' || step.label === 'Se former'
          return (
          <li
            key={step.label}
            className={`flex flex-col rounded-3xl border border-gold/30 p-6 shadow-[0_10px_28px_rgba(26,21,53,.09)] ${paid ? 'on-dark' : 'bg-white/80'}`}
            style={paid ? { background: 'linear-gradient(145deg,#1A1535,#243762)' } : undefined}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">{index + 1} · {step.label}</p>
            </div>
            <p className={`mt-1 font-georgia text-xs ${paid ? 'text-cream/75' : 'text-mist'}`}>{step.price}</p>
            <h3 className={`mt-3 font-georgia text-lg font-medium leading-snug ${paid ? 'text-cream' : 'text-deep'}`}>{step.title}</h3>
            <p className={`mt-2 flex-1 font-georgia text-sm leading-relaxed ${paid ? 'text-cream/80' : 'text-mist'}`}>{step.text}</p>
            <ul className="mt-4 space-y-1.5">
              {step.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href} onClick={openWith(link.onOpen, link.metric)} className={`font-georgia text-sm font-bold transition-colors ${paid ? 'text-gold hover:text-cream' : 'text-deep hover:text-gold'}`}>
                    {link.label} →
                  </a>
                </li>
              ))}
            </ul>
          </li>
          )
        })}
      </ol>
    </section>
  )
}
