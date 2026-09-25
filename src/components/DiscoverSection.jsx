// « Découvrir et expérimenter » : les expériences libres de MediumIA, en cartes
// égales et compactes. Les détails vivent sur leur page (Oracle, ChronoSphère).

function DiscoverCard({ eyebrow, title, children, action, href, onOpen, extra }) {
  const open = (event) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
  return (
    <article className="flex flex-col rounded-3xl border border-gold/30 bg-white/80 p-7 shadow-[0_10px_28px_rgba(26,21,53,.05)]">
      <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
      <h3 className="mt-3 font-georgia text-2xl font-medium leading-tight text-deep">{title}</h3>
      <p className="mt-3 flex-1 font-georgia leading-relaxed text-mist">{children}</p>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <a href={href} onClick={open} className="font-georgia text-sm font-bold text-deep transition-colors hover:text-gold">{action} →</a>
        {extra}
      </div>
    </article>
  )
}

export default function DiscoverSection({ id = 'decouvrir', onOpenOracle, onOpenChronosphere, children }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-28 px-6 py-16" aria-labelledby={`${id}-title`}>
      <div className="mb-10 max-w-2xl">
        <p className="font-georgia text-xs uppercase tracking-[0.24em] text-gold">Découvrir et expérimenter</p>
        <h2 id={`${id}-title`} className="mt-3 font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Commencer par une expérience</h2>
        <p className="mt-3 font-georgia text-lg leading-relaxed text-mist">Des outils libres pour explorer à votre rythme, avant ou pendant la formation.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <DiscoverCard eyebrow="Oracle Au-delà de l’Âme" title="Tirage test offert" action="Faire un tirage offert" href="/oracle" onOpen={onOpenOracle}>
          Tirez une carte et recevez une première lecture guidée par Lumïa, gratuitement.
        </DiscoverCard>
        <DiscoverCard
          eyebrow="ChronoSphère"
          title="Vos cycles et lignes de temps"
          action="Entrer dans ChronoSphère"
          href="/chronosphere"
          onOpen={onOpenChronosphere}
          extra={<a href="/chronosphere/exemple" className="font-georgia text-sm text-mist underline decoration-gold/40 underline-offset-4 hover:text-deep">Voir un exemple</a>}
        >
          À partir de votre naissance, une lecture de l’énergie actuelle et de vos fenêtres temporelles. Pack conseillé : 9,90 € TTC pour 3 tirages.
        </DiscoverCard>
        {children}
      </div>
    </section>
  )
}
