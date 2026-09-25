import { useEffect, useState } from 'react'

// « Sur cette page » : sommaire latéral discret des pages longues, sur grand
// écran uniquement (à partir de 1360 px, là où il ne réduit pas le contenu).
// La section en cours est surlignée. Sur téléphone, rien : le menu suffit.
export default function PageRail({ items = [], label = 'Sur cette page', cta = null }) {
  const [active, setActive] = useState('')
  // Hidden over the opening screen (hero), shown once the visitor scrolls on.
  const [shown, setShown] = useState(false)

  // The current section is the last one whose top has passed a third of the screen.
  useEffect(() => {
    const onScroll = () => {
      setShown(window.scrollY > window.innerHeight * 0.75)
      const line = window.innerHeight * 0.33
      let current = ''
      for (const item of items) {
        const el = document.getElementById(item.id)
        if (el && el.getBoundingClientRect().top <= line) current = item.id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [items])

  const go = (id) => (event) => {
    const target = document.getElementById(id)
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav aria-label={label} aria-hidden={!shown} className={`page-rail hidden min-[1360px]:block fixed left-5 top-1/2 -translate-y-1/2 z-40 w-28 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <p className="font-georgia text-[10px] uppercase tracking-[0.2em] text-gold mb-3">{label}</p>
      <ol className="border-l border-gold/25">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={go(item.id)}
              tabIndex={shown ? undefined : -1}
              aria-current={active === item.id ? 'location' : undefined}
              className={`-ml-px block border-l-2 py-1.5 pl-3 font-georgia text-[13px] leading-snug transition-colors ${active === item.id ? 'border-gold text-deep' : 'border-transparent text-mist hover:text-deep'}`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
      {cta && (
        <a href={`#${cta.target}`} onClick={go(cta.target)} tabIndex={shown ? undefined : -1} className="mt-5 block rounded-lg bg-deep px-3 py-2 text-center font-georgia text-xs font-bold text-gold">
          {cta.label}
        </a>
      )}
    </nav>
  )
}
