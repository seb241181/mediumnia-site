import { useRef } from 'react'
import '../styles/cosmic-library-home.css'

export const COSMIC_HOME_CONFIG = Object.freeze({
  title: 'Comprendre. Apprendre. Rencontrer.',
  emphasis: 'Exercer autrement.',
  description: "MediumIA rassemble celles et ceux qui explorent, transmettent et accompagnent dans l'univers de la médiumnité, du spirituel et du bien-être — avec des outils modernes qui respectent l'humain.",
  primaryAction: "Découvrir l'accompagnement",
})

const LIGHT_PARTICLES = [
  { x: 9, y: 18, size: 3, delay: -2, duration: 9 },
  { x: 16, y: 51, size: 2, delay: -5, duration: 11 },
  { x: 25, y: 28, size: 4, delay: -7, duration: 13 },
  { x: 34, y: 67, size: 2, delay: -1, duration: 10 },
  { x: 42, y: 13, size: 2, delay: -8, duration: 12 },
  { x: 51, y: 39, size: 3, delay: -4, duration: 14 },
  { x: 59, y: 16, size: 2, delay: -6, duration: 9 },
  { x: 67, y: 64, size: 4, delay: -3, duration: 12 },
  { x: 74, y: 25, size: 2, delay: -9, duration: 15 },
  { x: 82, y: 56, size: 3, delay: -2, duration: 11 },
  { x: 89, y: 20, size: 2, delay: -6, duration: 13 },
  { x: 94, y: 70, size: 3, delay: -4, duration: 10 },
]

function DockIcon({ type }) {
  const commonProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  if (type === 'formation') {
    return (
      <svg {...commonProps}>
        <path d="M4 5.5c2.5-.8 5.2-.35 8 1.35v12c-2.8-1.7-5.5-2.15-8-1.35z" />
        <path d="M20 5.5c-2.5-.8-5.2-.35-8 1.35v12c2.8-1.7 5.5-2.15 8-1.35z" />
      </svg>
    )
  }

  if (type === 'oracle') {
    return (
      <svg {...commonProps}>
        <path d="m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55z" />
        <path d="M18.5 3.5v3M20 5h-3M5.5 17.5v3M7 19H4" />
      </svg>
    )
  }

  if (type === 'chronosphere') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3.4" />
        <ellipse cx="12" cy="12" rx="9" ry="4.5" />
        <ellipse cx="12" cy="12" rx="4.5" ry="9" transform="rotate(35 12 12)" />
      </svg>
    )
  }

  if (type === 'agents') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="6" r="2" />
        <circle cx="6" cy="16.5" r="2" />
        <circle cx="18" cy="16.5" r="2" />
        <path d="m10.9 7.8-3.8 6.8M13.1 7.8l3.8 6.8M8 16.5h8" />
      </svg>
    )
  }

  if (type === 'conferences') {
    return (
      <svg {...commonProps}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" />
      </svg>
    )
  }

  return (
    <svg {...commonProps}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3.5 20c.4-4.1 2.2-6.1 5.5-6.1s5.1 2 5.5 6.1M14 14.7c3.8-.55 5.9 1.2 6.5 4.8" />
    </svg>
  )
}

function CosmicSphereAtmosphere() {
  return (
    <div className="cosmic-sphere-stage cosmic-reveal cosmic-reveal--sphere" aria-hidden="true">
      <div className="cosmic-sphere-stage__halo" />
      <div className="cosmic-sphere-stage__texture" />
      <div className="cosmic-orbit cosmic-orbit--outer"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--middle"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--inner"><span /></div>
    </div>
  )
}

function CosmicDock({ items }) {
  const dockRef = useRef(null)

  const setDockInfluence = (pointerX) => {
    const elements = dockRef.current?.querySelectorAll('.cosmic-dock__item') || []
    elements.forEach((element) => {
      const bounds = element.getBoundingClientRect()
      const distance = Math.abs(pointerX - (bounds.left + bounds.width / 2))
      const influence = Math.max(0, 1 - distance / 170)
      const easedInfluence = influence * influence
      element.style.setProperty('--dock-scale', String(0.94 + easedInfluence * 0.24))
      element.style.setProperty('--dock-lift', `${easedInfluence * -15}px`)
      element.style.setProperty('--dock-glow', String(influence))
    })
  }

  const resetDock = () => {
    dockRef.current?.querySelectorAll('.cosmic-dock__item').forEach((element) => {
      element.style.removeProperty('--dock-scale')
      element.style.removeProperty('--dock-lift')
      element.style.removeProperty('--dock-glow')
    })
  }

  const focusDockItem = (index) => {
    const elements = dockRef.current?.querySelectorAll('.cosmic-dock__item') || []
    elements.forEach((element, itemIndex) => {
      const distance = Math.abs(itemIndex - index)
      const scale = distance === 0 ? 1.18 : distance === 1 ? 1.03 : 0.94
      element.style.setProperty('--dock-scale', String(scale))
      element.style.setProperty('--dock-lift', distance === 0 ? '-15px' : distance === 1 ? '-5px' : '0px')
      element.style.setProperty('--dock-glow', distance === 0 ? '1' : distance === 1 ? '0.38' : '0')
    })
  }

  return (
    <nav
      ref={dockRef}
      className="cosmic-dock cosmic-reveal cosmic-reveal--dock"
      aria-label="Explorer les univers MediumIA"
      onPointerMove={(event) => {
        if (!window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) {
          setDockInfluence(event.clientX)
        }
      }}
      onPointerLeave={resetDock}
    >
      <div className="cosmic-dock__items">
        {items.map((item, index) => (
          <a
            key={item.label}
            href={item.href}
            className="cosmic-dock__item"
            onClick={item.onSelect ? (event) => { event.preventDefault(); item.onSelect() } : undefined}
            onFocus={() => focusDockItem(index)}
            onBlur={resetDock}
          >
            <span className="cosmic-dock__icon"><DockIcon type={item.icon} /></span>
            <span className="cosmic-dock__copy">
              <span className="cosmic-dock__label">{item.label}</span>
              <span className="cosmic-dock__detail">{item.detail}</span>
            </span>
          </a>
        ))}
      </div>
    </nav>
  )
}

export default function CosmicLibraryHero({ onOpenPro, onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenReseauDir }) {
  const heroRef = useRef(null)

  const categories = [
    { label: 'Formation', detail: 'Apprendre et pratiquer', icon: 'formation', href: '/formation', onSelect: onOpenFormation },
    { label: 'Oracle', detail: 'Éclairer une question', icon: 'oracle', href: '/oracle', onSelect: onOpenOracle },
    { label: 'Chronosphère', detail: 'Explorer le temps', icon: 'chronosphere', href: '/chronosphere', onSelect: onOpenChronosphere },
    { label: 'Agents', detail: 'Amplifier sa pratique', icon: 'agents', href: '/agents', onSelect: onOpenPro },
    { label: 'Conférences', detail: 'Partager les savoirs', icon: 'conferences', href: '/conferences' },
    { label: 'Réseau', detail: 'Rencontrer un praticien', icon: 'reseau', href: '/reseau', onSelect: onOpenReseauDir },
  ]

  const handlePointerMove = (event) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) - 0.5
    const y = ((event.clientY - bounds.top) / bounds.height) - 0.5
    event.currentTarget.style.setProperty('--scene-x', `${x * -5}px`)
    event.currentTarget.style.setProperty('--scene-y', `${y * -3}px`)
    event.currentTarget.style.setProperty('--sphere-x', `${x * 8}px`)
    event.currentTarget.style.setProperty('--sphere-y', `${y * 5}px`)
    event.currentTarget.style.setProperty('--particle-x', `${x * 12}px`)
    event.currentTarget.style.setProperty('--particle-y', `${y * 8}px`)
  }

  const resetParallax = () => {
    for (const property of ['--scene-x', '--scene-y', '--sphere-x', '--sphere-y', '--particle-x', '--particle-y']) {
      heroRef.current?.style.setProperty(property, '0px')
    }
  }

  return (
    <section
      ref={heroRef}
      className="cosmic-library"
      aria-labelledby="cosmic-home-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
    >
      <div className="cosmic-library__scene" aria-hidden="true">
        <picture>
          <source media="(max-width: 760px)" srcSet="/images/home/mediumia-cosmic-library-hero-mobile.webp" />
          <img
            src="/images/home/mediumia-cosmic-library-hero.webp"
            alt=""
            width="1672"
            height="941"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      </div>
      <div className="cosmic-library__depth" aria-hidden="true" />
      <CosmicSphereAtmosphere />
      <div className="cosmic-library__particles" aria-hidden="true">
        {LIGHT_PARTICLES.map((particle) => (
          <span
            key={`${particle.x}-${particle.y}`}
            style={{
              '--particle-left': `${particle.x}%`,
              '--particle-top': `${particle.y}%`,
              '--particle-size': `${particle.size}px`,
              '--particle-delay': `${particle.delay}s`,
              '--particle-duration': `${particle.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="cosmic-library__content">
        <div className="cosmic-library__centerpiece">
          <div className="cosmic-library__brand cosmic-reveal cosmic-reveal--brand">
            <span className="cosmic-library__brand-aura" aria-hidden="true" />
            <img
              src="/images/brand/MEDIUMIA_logo_officiel_transparent_2026-09-12.png"
              alt="MediumIA, le monde spirituel, relié autrement"
              width="1015"
              height="696"
              fetchPriority="high"
              decoding="async"
            />
            <span className="cosmic-library__eye-blink" aria-hidden="true">
              <svg viewBox="0 0 220 108" focusable="false">
                <path className="cosmic-library__eyelid cosmic-library__eyelid--upper" d="M4 54 Q110 -3 216 54 Q110 55 4 54Z" />
                <path className="cosmic-library__eyelid cosmic-library__eyelid--lower" d="M4 54 Q110 111 216 54 Q110 53 4 54Z" />
                <path className="cosmic-library__blink-seam" d="M5 54 Q110 49 215 54" />
              </svg>
            </span>
          </div>

          <div className="cosmic-library__message cosmic-reveal cosmic-reveal--message">
            <h1 id="cosmic-home-title">
              {COSMIC_HOME_CONFIG.title}
              <span>{COSMIC_HOME_CONFIG.emphasis}</span>
            </h1>
            <p>{COSMIC_HOME_CONFIG.description}</p>
          </div>

          <div className="cosmic-library__actions cosmic-reveal cosmic-reveal--actions">
            <a
              className="cosmic-library__primary"
              href="/formation"
              onClick={(event) => { event.preventDefault(); onOpenFormation() }}
            >
              {COSMIC_HOME_CONFIG.primaryAction}<span aria-hidden="true">→</span>
            </a>
          </div>
        </div>

        <CosmicDock items={categories} />
      </div>
    </section>
  )
}
