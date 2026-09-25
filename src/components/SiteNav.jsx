import { useEffect, useRef, useState } from 'react'
import '../styles/site-nav.css'

// Navigation principale de la vitrine, identique sur l'accueil et les pages clés.
// Ordre validé : Se former · Consulter · Découvrir · Conférences · Boutique ·
// Trouver un praticien. « Espace élèves » reste à droite ; « Espace Pro » n'est
// plus dans la navigation principale (bande praticiens et pied de page).
// Sur téléphone : un vrai menu (bouton « Menu »), pas de barre latérale.

export const SITE_NAV_ITEMS = [
  { id: 'formation', label: 'Se former', href: '/formation' },
  { id: 'consulter', label: 'Consulter', href: '/#consulter' },
  { id: 'decouvrir', label: 'Découvrir', href: '/#decouvrir' },
  { id: 'conferences', label: 'Conférences', href: '/conferences' },
  { id: 'boutique', label: 'Boutique', href: '/#boutique' },
  { id: 'reseau', label: 'Trouver un praticien', href: '/reseau' },
]

export default function SiteNav({ current = 'home', onOpenFormation, onOpenConferences, onOpenReseauDir, onHome }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const toggleRef = useRef(null)
  const onHomePage = current === 'home'

  // Arriving on « /#consulter » from another page: reach the section once rendered.
  useEffect(() => {
    if (!onHomePage || !window.location.hash) return undefined
    const timer = setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' }), 350)
    return () => clearTimeout(timer)
  }, [onHomePage])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    menuRef.current?.querySelector('a')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Real links everywhere; inside the single-page app the known routes open
  // without a reload, and the home sections scroll smoothly.
  const follow = (item) => (event) => {
    setOpen(false)
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    if (item.id === 'formation' && onOpenFormation) { event.preventDefault(); onOpenFormation(); return }
    if (item.id === 'conferences' && onOpenConferences) { event.preventDefault(); onOpenConferences(); return }
    if (item.id === 'reseau' && onOpenReseauDir) { event.preventDefault(); onOpenReseauDir(); return }
    if (item.href.startsWith('/#') && onHomePage) {
      const target = document.getElementById(item.href.slice(2))
      if (target) {
        event.preventDefault()
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.history.replaceState({}, '', item.href.slice(1))
      }
    }
  }

  const goHome = (event) => {
    setOpen(false)
    if (onHomePage) { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    if (onHome) { event.preventDefault(); onHome() }
  }

  return (
    <header className="cosmic-nav site-nav fixed top-0 left-0 right-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-gold/20">
      <div className="max-w-6xl mx-auto px-5 md:px-6 py-3 md:py-4 flex items-center justify-between gap-4">
        <a href="/" onClick={goHome} className="shrink-0 flex items-center gap-2.5" aria-label="MediumIA — accueil">
          <img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-9 md:h-11 w-auto" />
          <span className="font-georgia text-deep tracking-[0.2em] text-base md:text-lg font-semibold">MEDIUMIA</span>
        </a>

        <nav aria-label="Navigation principale" className="hidden min-[1041px]:flex items-center gap-6 font-georgia text-[15px] text-deep font-medium">
          {SITE_NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={follow(item)}
              aria-current={current === item.id ? 'page' : undefined}
              className="site-nav__link transition-colors hover:text-gold"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="shrink-0 flex items-center gap-2">
          <a
            href="https://espace.mediumia.fr"
            className="font-georgia text-xs md:text-sm tracking-wide px-3 py-2.5 md:px-4 rounded-lg border border-gold/60 text-deep font-bold whitespace-nowrap hover:bg-gold/10 transition-colors"
          >
            Espace élèves
          </a>
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-nav-menu"
            className="site-nav__toggle font-georgia text-xs md:text-sm font-bold px-3 py-2.5 rounded-lg bg-deep text-gold items-center gap-2"
          >
            <span aria-hidden="true" className="flex flex-col gap-[3px]">
              <span className={`block h-[1.5px] w-4 bg-current transition-transform ${open ? 'translate-y-[4.5px] rotate-45' : ''}`} />
              <span className={`block h-[1.5px] w-4 bg-current transition-opacity ${open ? 'opacity-0' : ''}`} />
              <span className={`block h-[1.5px] w-4 bg-current transition-transform ${open ? '-translate-y-[4.5px] -rotate-45' : ''}`} />
            </span>
            {open ? 'Fermer' : 'Menu'}
          </button>
        </div>
      </div>

      {open && (
        <div id="site-nav-menu" ref={menuRef} role="navigation" aria-label="Menu" className="site-nav__panel">
          <ul className="flex flex-col">
            {SITE_NAV_ITEMS.map((item) => (
              <li key={item.id} className="border-b border-gold/15 last:border-0">
                <a
                  href={item.href}
                  onClick={follow(item)}
                  aria-current={current === item.id ? 'page' : undefined}
                  className={`flex items-center justify-between py-4 font-georgia text-lg ${current === item.id ? 'text-gold' : 'text-deep'}`}
                >
                  {item.label}
                  <span aria-hidden="true" className="text-gold">→</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}
