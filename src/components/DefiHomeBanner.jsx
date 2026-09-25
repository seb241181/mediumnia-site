// Accueil : entrée vers le jeu gratuit du jour.
export default function DefiHomeBanner() {
  return (
    <section className="px-6 pt-10 max-w-6xl mx-auto" aria-label="Jeu gratuit du jour">
      <a
        href="/defi-intuition"
        className="group flex items-center gap-5 rounded-3xl border border-gold/40 bg-[linear-gradient(120deg,#1a1535,#2a2150)] px-6 py-5 text-cream shadow-[0_14px_34px_rgba(26,21,53,.18)] transition hover:border-gold md:px-8"
      >
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`flex h-12 w-8 items-center justify-center rounded-md border text-sm ${i === 1 ? 'border-gold bg-[radial-gradient(circle,#fff6d8,#e4c77a_60%,#b8923f)] text-[#1a1535]' : 'border-gold/50 text-gold/80'}`}>{i === 1 ? '★' : '✦'}</span>
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Défi Intuition · jeu gratuit du jour</span>
          <span className="mt-1 block font-georgia text-lg leading-snug md:text-xl"><span className="whitespace-nowrap">Trouverez-vous</span> l’Étoile&nbsp;?</span>
        </span>
        <span aria-hidden="true" className="hidden font-georgia text-sm text-gold transition group-hover:translate-x-1 sm:block">Jouer →</span>
      </a>
    </section>
  )
}
