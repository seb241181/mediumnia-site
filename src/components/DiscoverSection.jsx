// ChronoSphère dispose désormais de son propre encadré bleu. Les expériences
// gratuites (Oracle, Défi Intuition et quiz) sont réunies dans QuizInvite.

function openWith(onOpen) {
  return (event) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
}

// Les trois temps d'une lecture, repris de la page ChronoSphère.
const CHRONO_STEPS = [
  { step: '1 · Socle', title: 'Empreinte de naissance', text: 'Date, heure et lieu posent la base de votre lecture.' },
  { step: '2 · Passage', title: 'Énergie actuelle', text: 'La dynamique du moment et vos fenêtres temporelles.' },
  { step: '3 · Oracle', title: 'Oracle des Lignes de Temps', text: 'Vos trois nombres correspondent à trois cartes de mon Oracle des Lignes de Temps, composé de 58 cartes.' },
]

function ChronosphereFeature({ onOpen }) {
  return (
    <article
      className="on-dark relative overflow-hidden rounded-3xl border border-gold/40 p-7 shadow-[0_18px_45px_rgba(26,21,53,.18)] md:p-10"
      style={{ background: 'linear-gradient(135deg, #1A1535 0%, #243762 100%)' }}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">ChronoSphère 999 · cycles et lignes de temps</p>
        <h3 className="mt-3 font-georgia text-3xl font-medium leading-tight text-cream md:text-4xl">Où en êtes-vous dans votre cycle&nbsp;?</h3>
        <p className="mt-3 max-w-2xl font-georgia text-lg italic leading-relaxed text-cream/85">« Votre naissance pose le socle ; le moment présent ouvre la fenêtre. »</p>
        <p className="mt-4 max-w-2xl font-georgia text-sm leading-relaxed text-cream/80"><strong>Pas un tirage aléatoire du logiciel :</strong> ChronoSphère relie mon Oracle des Lignes de Temps à votre thème natal pour explorer plusieurs trajectoires possibles plutôt qu’un avenir figé.</p>
        <ol className="mt-7 grid gap-3 md:grid-cols-3">
          {CHRONO_STEPS.map((item) => (
            <li key={item.step} className="rounded-2xl border border-gold/25 px-4 py-4" style={{ background: 'rgba(255,255,255,.07)' }}>
              <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">{item.step}</p>
              <p className="mt-1 font-georgia font-medium text-cream">{item.title}</p>
              <p className="mt-1 font-georgia text-sm leading-relaxed text-cream/75">{item.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
          <a href="/chronosphere" onClick={openWith(onOpen)} className="inline-flex min-h-[48px] items-center rounded-full bg-gold px-7 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90">
            Entrer dans ChronoSphère →
          </a>
          <a href="/chronosphere/exemple" className="font-georgia text-sm text-cream/85 underline decoration-gold/60 underline-offset-4 hover:text-cream">Voir un exemple de lecture</a>
        </div>
        <p className="mt-4 font-georgia text-xs text-cream/75">Pack conseillé : 9,90 € TTC pour 3 tirages.</p>
      </div>
    </article>
  )
}

export default function DiscoverSection({ id = 'decouvrir', onOpenChronosphere }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-28 px-6 pt-12" aria-label="ChronoSphère 999">
      <ChronosphereFeature onOpen={onOpenChronosphere} />
    </section>
  )
}
