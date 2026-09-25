import SiteNav from './SiteNav'

// En-tête commun des pages publiques : la navigation principale (SiteNav), un
// espace pour ne pas passer sous la barre fixe, puis, si la page en a besoin,
// une ligne de contexte (retour vers une liste, bouton de commande…).
// Aucune logique métier : chaque page garde ses propres actions.
export default function PublicPageNav({ current, onHome, children }) {
  return (
    <>
      <SiteNav current={current} onHome={onHome} />
      <div aria-hidden="true" className="h-[84px] md:h-[100px]" />
      {children && (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pb-2 md:px-6">
          {children}
        </div>
      )}
    </>
  )
}
