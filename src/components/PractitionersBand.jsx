// Bande « praticiens » en bas de l'accueil : trouver un praticien, rejoindre le
// réseau, et l'Espace Pro (sorti de la navigation principale).
export default function PractitionersBand({ onOpenReseauDir, onOpenReseauForm, onOpenPro }) {
  const links = [
    { label: 'Trouver un praticien', href: '/reseau', onOpen: onOpenReseauDir },
    { label: 'Rejoindre le réseau', href: '/reseau/rejoindre', onOpen: onOpenReseauForm },
    { label: 'Espace Pro', href: '/pro', onOpen: onOpenPro },
  ]
  const follow = (onOpen) => (event) => {
    if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpen()
  }
  return (
    <section id="praticiens" className="mx-auto max-w-6xl scroll-mt-28 px-6 pb-16" aria-labelledby="praticiens-title">
      <div className="flex flex-col gap-6 rounded-3xl border border-gold/30 bg-white/70 px-7 py-8 md:flex-row md:items-center md:justify-between md:px-10">
        <div className="max-w-xl">
          <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Réseau MediumIA</p>
          <h2 id="praticiens-title" className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep">Praticiens de l’accompagnement</h2>
          <p className="mt-2 font-georgia leading-relaxed text-mist">Trouvez un praticien près de chez vous, ou présentez votre pratique.</p>
        </div>
        <ul className="flex flex-col gap-3 sm:flex-row sm:flex-wrap md:justify-end">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href} onClick={follow(link.onOpen)} className="inline-flex rounded-lg border border-gold/50 px-4 py-2.5 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/10">
                {link.label} →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
