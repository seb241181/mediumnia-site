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

const CHANNEL_TEASERS = [
  ['ClairSensation', 'Je sens avant de savoir'],
  ['Clairvision', 'Je vois en dedans'],
  ['Clairaudience', 'Je reçois une intention formulée'],
  ['Clairconnaissance', 'L’évidence apparaît sans raisonnement'],
]

export function QuizInvite({ onOpenQuiz }) {
  return (
    <section id="quiz" className="mx-auto max-w-6xl scroll-mt-28 px-6 pt-16" aria-labelledby="quiz-invite-title">
      <article
        className="on-dark relative overflow-hidden rounded-3xl border border-gold/25 p-8 shadow-lg md:p-12"
        style={{ background: 'linear-gradient(135deg, #1A1535 0%, #221C45 100%)' }}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <p className="font-georgia text-[11px] uppercase tracking-[0.28em] text-gold">Quiz gratuit · 2 minutes</p>
            <h2 id="quiz-invite-title" className="mt-3 font-georgia text-3xl font-medium leading-tight text-cream md:text-4xl">
              Quel est votre canal de perception&nbsp;?
            </h2>
            <p className="mt-4 max-w-xl font-georgia text-base leading-relaxed text-cream/70 md:text-lg">
              Vous sentez, vous voyez, vous entendez ou vous savez&nbsp;? Huit questions pour découvrir le canal qui s’ouvre le plus naturellement chez vous, et un premier exercice pour l’entraîner.
            </p>
            <a
              href="/quiz-sensibilite"
              onClick={openWith(onOpenQuiz, 'quiz')}
              className="mt-7 inline-flex min-h-[52px] items-center rounded-full bg-gold px-8 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90"
            >
              Découvrir mon canal →
            </a>
            <p className="mt-3 font-georgia text-xs text-cream/50">Sans inscription · résultat immédiat</p>
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {CHANNEL_TEASERS.map(([name, motto]) => (
              <li key={name} className="rounded-2xl border border-gold/20 p-4" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <p className="font-georgia text-sm font-medium text-cream">{name}</p>
                <p className="mt-1 font-georgia text-xs italic leading-snug" style={{ color: 'rgba(250,250,247,0.55)' }}>« {motto} »</p>
              </li>
            ))}
          </ul>
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

export const CODEX_AMAZON_URL = 'https://www.amazon.fr/dp/B0HJY4CFFD'

export function ArcheSection() {
  return (
    <section id="arche" className="mx-auto max-w-6xl scroll-mt-28 px-6 py-16" aria-labelledby="arche-title">
      <div className="max-w-2xl">
        <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">L’œuvre · L’Octave de l’Âme</p>
        <h2 id="arche-title" className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">L’Arche</h2>
        <p className="mt-3 font-georgia text-lg leading-relaxed text-mist">
          Au-delà de la pratique, une lecture de ce que nous sommes. J’ai écrit L’Arche comme une œuvre en mouvements.
        </p>
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <article className="on-dark flex flex-col gap-6 rounded-3xl border border-gold/40 p-7 shadow-[0_18px_45px_rgba(26,21,53,.16)] sm:flex-row md:p-9" style={{ background: 'linear-gradient(135deg,#1A1535,#243762)' }}> 
          <img
            src="/images/boutique/codex-cover.jpg"
            alt="Couverture du livre CODEX — Le Livre de l’Arche, de Sébastien Seguin"
            loading="lazy"
            decoding="async"
            className="mx-auto w-40 shrink-0 self-start rounded-lg shadow-[0_14px_30px_rgba(26,21,53,.25)] sm:mx-0"
          />
          <div className="flex flex-col">
            <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Disponible · broché et Kindle</p>
            <h3 className="mt-2 font-georgia text-2xl font-medium leading-tight text-cream">CODEX — Le Livre de l’Arche</h3>
            <p className="mt-1 font-georgia text-sm italic text-cream/75">L’Octave entière, de l’Un au Neuf</p>
            <p className="mt-4 flex-1 font-georgia leading-relaxed text-cream/80">
              Une approche philosophique de ce qui concerne l’humain : de l’Un qui s’ignore au Souverain qui se sait. Un livre de lecture, de réflexion et d’exploration symbolique.
            </p>
            <p className="mt-4 font-georgia text-base italic text-cream/85">« Je suis dans la matière, mais je ne suis pas seulement matière. »</p>
            <a
              href={CODEX_AMAZON_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackMediumiaMetric('home_door_click', 'home:codex')}
              className="mt-6 inline-flex min-h-[48px] w-fit items-center rounded-full bg-gold px-7 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90"
            >
              Acheter le livre sur Amazon <span className="ml-1" aria-hidden="true">↗</span>
            </a>
          </div>
        </article>
        <article
          className="on-dark flex flex-col rounded-3xl border border-gold/25 p-7 shadow-lg md:p-9"
          style={{ background: 'linear-gradient(160deg, #1A1535 0%, #2A2152 100%)' }}
        >
          <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Troisième mouvement · en cours</p>
          <h3 className="mt-2 font-georgia text-3xl font-medium leading-tight text-cream">La Kénose</h3>
          <p className="mt-1 font-georgia text-sm italic text-gold/85">le réveil qui sort du sommeil dans l’oubli</p>
          <p className="mt-4 flex-1 font-georgia leading-relaxed text-cream/70">
            Le Codex s’achève sur ces mots&nbsp;: « L’expérience humaine est l’expérience de l’oubli. Ne l’oublie pas. » La Kénose commence exactement là. Le mouvement est en train de s’écrire.
          </p>
          <p className="mt-6 font-georgia text-xs text-cream/50">Pour être prêt à le recevoir, commencez par le Codex.</p>
        </article>
      </div>
    </section>
  )
}
