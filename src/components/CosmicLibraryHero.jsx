import { useRef, useState } from 'react'
import '../styles/cosmic-library-home.css'

export const COSMIC_HOME_CONFIG = Object.freeze({
  eyebrow: 'La bibliothèque cosmique de MediumIA',
  title: 'Comprendre. Apprendre. Rencontrer.',
  accent: 'Exercer autrement.',
  description:
    "MediumIA relie conscience, transmission et intelligence artificielle dans un espace vivant, pensé pour éclairer sans jamais remplacer l'humain.",
  primaryAction: 'Explorer l’univers MediumIA',
  secondaryAction: 'Découvrir la Formation MediumIA',
})

const LIGHT_PARTICLES = [
  { x: 8, y: 19, size: 3, delay: -2, duration: 9 },
  { x: 15, y: 63, size: 2, delay: -5, duration: 11 },
  { x: 22, y: 33, size: 4, delay: -7, duration: 13 },
  { x: 31, y: 76, size: 2, delay: -1, duration: 10 },
  { x: 39, y: 16, size: 2, delay: -8, duration: 12 },
  { x: 48, y: 47, size: 3, delay: -4, duration: 14 },
  { x: 57, y: 11, size: 2, delay: -6, duration: 9 },
  { x: 64, y: 69, size: 4, delay: -3, duration: 12 },
  { x: 72, y: 29, size: 2, delay: -9, duration: 15 },
  { x: 79, y: 58, size: 3, delay: -2, duration: 11 },
  { x: 87, y: 21, size: 2, delay: -6, duration: 13 },
  { x: 93, y: 72, size: 3, delay: -4, duration: 10 },
]

const SHELF_LEVELS = [0, 1, 2, 3, 4]

function CosmicArchitecture() {
  return (
    <div className="cosmic-library__architecture" aria-hidden="true">
      <div className="cosmic-library__arch" />
      <div className="cosmic-library__wing cosmic-library__wing--left">
        <div className="cosmic-library__column" />
        <div className="cosmic-library__shelves">
          {SHELF_LEVELS.map(level => <span key={level} style={{ '--shelf-level': level }} />)}
        </div>
      </div>
      <div className="cosmic-library__wing cosmic-library__wing--right">
        <div className="cosmic-library__column" />
        <div className="cosmic-library__shelves">
          {SHELF_LEVELS.map(level => <span key={level} style={{ '--shelf-level': level }} />)}
        </div>
      </div>
      <div className="cosmic-library__floor" />
    </div>
  )
}

function CosmicSphere() {
  return (
    <div className="cosmic-sphere-stage" aria-hidden="true">
      <div className="cosmic-sphere-stage__portal" />
      <div className="cosmic-orbit cosmic-orbit--outer"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--middle"><span /></div>
      <div className="cosmic-orbit cosmic-orbit--inner"><span /></div>
      <div className="cosmic-sphere">
        <div className="cosmic-sphere__current" />
        <div className="cosmic-sphere__latitude" />
        <div className="cosmic-sphere__glint" />
      </div>
      <div className="cosmic-sphere-stage__shadow" />
    </div>
  )
}

function CosmicDock({ items }) {
  const [activeIndex, setActiveIndex] = useState(null)

  return (
    <nav className="cosmic-dock cosmic-reveal cosmic-reveal--dock" aria-label="Explorer les univers MediumIA" onMouseLeave={() => setActiveIndex(null)}>
      <p className="cosmic-dock__legend">Choisir une porte d’entrée</p>
      <div className="cosmic-dock__items">
        {items.map((item, index) => {
          const distance = activeIndex === null ? null : Math.abs(activeIndex - index)
          const proximityClass = distance === 0 ? 'is-active' : distance === 1 ? 'is-near' : ''
          return (
            <a
              key={item.label}
              href={item.href}
              className={`cosmic-dock__item ${proximityClass}`}
              onClick={item.onSelect ? (event) => { event.preventDefault(); item.onSelect() } : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            >
              <span className="cosmic-dock__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="cosmic-dock__label">{item.label}</span>
              <span className="cosmic-dock__detail">{item.detail}</span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}

export default function CosmicLibraryHero({ onOpenFormation, onOpenOracle, onOpenChronosphere, onOpenReseauDir }) {
  const heroRef = useRef(null)

  const categories = [
    { label: 'Explorer', detail: 'L’univers', href: '#decouvrir' },
    { label: 'Se former', detail: '25 modules', href: '/formation', onSelect: onOpenFormation },
    { label: 'Oracle', detail: 'Être éclairé', href: '/oracle', onSelect: onOpenOracle },
    { label: 'Chronosphère', detail: 'Lignes de temps', href: '/chronosphere', onSelect: onOpenChronosphere },
    { label: 'Consulter', detail: 'Prendre rendez-vous', href: '#consulter' },
    { label: 'Réseau', detail: 'Les praticiens', href: '/reseau', onSelect: onOpenReseauDir },
  ]

  const handlePointerMove = (event) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return
    const x = ((event.clientX / window.innerWidth) - 0.5) * 18
    const y = ((event.clientY / window.innerHeight) - 0.5) * 14
    event.currentTarget.style.setProperty('--parallax-x', `${x}px`)
    event.currentTarget.style.setProperty('--parallax-x-inverse', `${-x}px`)
    event.currentTarget.style.setProperty('--parallax-y', `${y}px`)
  }

  const resetParallax = () => {
    heroRef.current?.style.setProperty('--parallax-x', '0px')
    heroRef.current?.style.setProperty('--parallax-x-inverse', '0px')
    heroRef.current?.style.setProperty('--parallax-y', '0px')
  }

  return (
    <section
      ref={heroRef}
      className="cosmic-library"
      aria-labelledby="cosmic-home-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
    >
      <div className="cosmic-library__sky" aria-hidden="true" />
      <CosmicArchitecture />
      <div className="cosmic-library__particles" aria-hidden="true">
        {LIGHT_PARTICLES.map((particle, index) => (
          <span
            key={`${particle.x}-${particle.y}`}
            style={{
              '--particle-x': `${particle.x}%`,
              '--particle-y': `${particle.y}%`,
              '--particle-size': `${particle.size}px`,
              '--particle-delay': `${particle.delay}s`,
              '--particle-duration': `${particle.duration}s`,
              '--particle-index': index,
            }}
          />
        ))}
      </div>

      <div className="cosmic-library__content">
        <div className="cosmic-library__brand cosmic-reveal cosmic-reveal--brand">
          <img
            src="/images/brand/MEDIUMIA_logo_officiel_2026-09-12.png"
            alt="MediumIA, le monde spirituel, relié autrement"
            width="1514"
            height="696"
            fetchPriority="high"
            decoding="async"
          />
        </div>

        <div className="cosmic-library__stage">
          <div className="cosmic-library__copy cosmic-reveal cosmic-reveal--copy">
            <p className="cosmic-library__eyebrow">{COSMIC_HOME_CONFIG.eyebrow}</p>
            <h1 id="cosmic-home-title">
              {COSMIC_HOME_CONFIG.title}<br />
              <em>{COSMIC_HOME_CONFIG.accent}</em>
            </h1>
            <p className="cosmic-library__description">{COSMIC_HOME_CONFIG.description}</p>
            <div className="cosmic-library__actions">
              <a className="cosmic-library__primary" href="#decouvrir">
                {COSMIC_HOME_CONFIG.primaryAction}<span aria-hidden="true">↓</span>
              </a>
              <a
                className="cosmic-library__secondary"
                href="/formation"
                onClick={(event) => { event.preventDefault(); onOpenFormation() }}
              >
                {COSMIC_HOME_CONFIG.secondaryAction}<span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div className="cosmic-reveal cosmic-reveal--sphere">
            <CosmicSphere />
          </div>
        </div>

        <CosmicDock items={categories} />
      </div>
    </section>
  )
}
