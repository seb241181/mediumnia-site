// « Tirages & ChronoSphère » : les expériences de MediumIA. ChronoSphère est mise
// en avant avec son principe (socle, passage, oracle) pour donner envie d'entrer ;
// l'Oracle offert et le Défi Intuition l'accompagnent. Les détails vivent sur
// leur page (Oracle, ChronoSphère).

function openWith(onOpen) {
  return (event) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
}

function DiscoverCard({ eyebrow, title, children, action, href, onOpen, extra }) {
  return (
    <article className="flex flex-col rounded-3xl border border-gold/30 bg-white/80 p-7 shadow-[0_10px_28px_rgba(26,21,53,.05)]">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
      <h3 className="mt-3 font-georgia text-2xl font-medium leading-tight text-deep">{title}</h3>
      <p className="mt-3 flex-1 font-georgia leading-relaxed text-mist">{children}</p>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a href={href} onClick={openWith(onOpen)} className="font-georgia text-sm font-bold text-deep transition-colors hover:text-gold">{action} →</a>
        {extra}
      </div>
    </article>
  )
}

// Les trois temps d'une lecture, repris de la page ChronoSphère.
const CHRONO_STEPS = [
  { step: '1 · Socle', title: 'Empreinte de naissance', text: 'Date, heure et lieu posent la base de votre lecture.' },
  { step: '2 · Passage', title: 'Énergie actuelle', text: 'La dynamique du moment et vos fenêtres temporelles.' },
  { step: '3 · Oracle', title: 'Résonances chiffrées', text: 'Trois nombres ouvrent une lecture symbolique.' },
]

function ChronosphereFeature({ onOpen }) {
  return (
    <article className="relative overflow-hidden rounded-3xl border border-gold/40 bg-white/85 p-7 shadow-[0_18px_45px_rgba(26,21,53,.08)] md:p-10 lg:col-span-2">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
      <div className="relative">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">ChronoSphère 999 · cycles et lignes de temps</p>
        <h3 className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Où en êtes-vous dans votre cycle&nbsp;?</h3>
        <p className="mt-3 max-w-2xl font-georgia text-lg italic leading-relaxed text-mist">« Votre naissance pose le socle ; le moment présent ouvre la fenêtre. »</p>
        <ol className="mt-7 grid gap-3 md:grid-cols-3">
          {CHRONO_STEPS.map((item) => (
            <li key={item.step} className="rounded-2xl border border-gold/20 bg-cream/70 px-4 py-4">
              <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">{item.step}</p>
              <p className="mt-1 font-georgia font-medium text-deep">{item.title}</p>
              <p className="mt-1 font-georgia text-sm leading-relaxed text-mist">{item.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
          <a href="/chronosphere" onClick={openWith(onOpen)} className="inline-flex min-h-[48px] items-center rounded-full bg-gold px-7 font-georgia text-base font-bold text-deep transition-colors hover:bg-gold/90">
            Entrer dans ChronoSphère →
          </a>
          <a href="/chronosphere/exemple" className="font-georgia text-sm text-mist underline decoration-gold/40 underline-offset-4 hover:text-deep">Voir un exemple de lecture</a>
        </div>
        <p className="mt-4 font-georgia text-xs text-mist">Pack conseillé : 9,90 € TTC pour 3 tirages.</p>
      </div>
    </article>
  )
}

export default function DiscoverSection({ id = 'decouvrir', onOpenOracle, onOpenChronosphere, children }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-28 px-6 py-16" aria-labelledby={`${id}-title`}>
      <div className="mb-10 max-w-2xl">
        <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Tirages &amp; ChronoSphère</p>
        <h2 id={`${id}-title`} className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Éclairer le moment que vous traversez</h2>
        <p className="mt-3 font-georgia text-lg leading-relaxed text-mist">Des lectures guidées pour mettre des mots sur ce que vous vivez, à votre rythme, avant ou pendant la formation.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ChronosphereFeature onOpen={onOpenChronosphere} />
        <div className="grid gap-5">
          <DiscoverCard eyebrow="Oracle Au-delà de l’Âme" title="Tirage test offert" action="Faire un tirage offert" href="/oracle" onOpen={onOpenOracle}>
            Tirez une carte et recevez une première lecture guidée par Lumïa, gratuitement.
          </DiscoverCard>
          <DiscoverCard eyebrow="Défi Intuition · 2 minutes" title="Exercice d’intuition du jour" action="Faire l’exercice" href="/defi-intuition">
            Cinq cartes, une seule cache l’Étoile. Respirez, écoutez votre premier ressenti : un exercice de perception, renouvelé chaque jour.
          </DiscoverCard>
        </div>
        {children}
      </div>
    </section>
  )
}
